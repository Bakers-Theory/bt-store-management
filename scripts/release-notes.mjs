// Generates a semver tag and grouped release notes from merged PRs.
// Pure functions are exported for unit testing; main() does the git/gh I/O.

/**
 * @param {string} prevTag e.g. "v1.2.3" or "1.2.3" or "" for first release
 * @param {"patch"|"minor"|"major"} bump
 * @returns {string} next tag, e.g. "v1.2.4"
 */
export function bumpVersion(prevTag, bump) {
  const base = (prevTag || "v0.0.0").replace(/^v/, "");
  const [maj, min, pat] = base.split(".").map(Number);
  if ([maj, min, pat].some(Number.isNaN)) {
    throw new Error(`Cannot parse previous tag: ${prevTag}`);
  }
  switch (bump) {
    case "major":
      return `v${maj + 1}.0.0`;
    case "minor":
      return `v${maj}.${min + 1}.0`;
    case "patch":
      return `v${maj}.${min}.${pat + 1}`;
    default:
      throw new Error(`Unknown bump: ${bump}`);
  }
}

/** @param {string} title @returns {"features"|"fixes"|"other"} */
function categorize(title) {
  const m = title.match(/^(\w+)(\([^)]*\))?!?:/);
  const type = m ? m[1].toLowerCase() : "";
  if (type === "feat") return "features";
  if (type === "fix") return "fixes";
  return "other";
}

/**
 * @param {{ prs: Array<{number:number,title:string,author:{login:string}|null}>,
 *           prevTag: string, newTag: string, repo: string }} args
 * @returns {string} markdown release body
 */
export function buildReleaseNotes({ prs, prevTag, newTag, repo }) {
  const groups = { features: [], fixes: [], other: [] };
  for (const pr of prs) groups[categorize(pr.title)].push(pr);

  const line = (pr) => `- ${pr.title} (#${pr.number}) @${pr.author?.login ?? "unknown"}`;
  const section = (heading, items) =>
    items.length ? `### ${heading}\n\n${items.map(line).join("\n")}` : null;

  const sections = [
    section("Features", groups.features),
    section("Fixes", groups.fixes),
    section("Other", groups.other),
  ].filter(Boolean);

  let body = sections.length
    ? sections.join("\n\n")
    : "_No merged pull requests since the last release._";

  if (prevTag) {
    body += `\n\n**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`;
  }
  return body;
}

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function latestTag() {
  const out = sh("git", ["tag", "--list", "v*", "--sort=-v:refname"]);
  return out ? out.split("\n")[0].trim() : "";
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  // e.g. git@github.com:Bakers-Theory/bt-store-management.git
  const url = sh("git", ["remote", "get-url", "origin"]);
  const m = url.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot derive repo from remote: ${url}`);
  return m[1];
}

function mergedPrsSince(prevTag) {
  const raw = sh("gh", [
    "pr", "list", "--state", "merged", "--base", "main", "--limit", "200",
    "--json", "number,title,author,mergedAt,url",
  ]);
  const all = JSON.parse(raw);
  if (!prevTag) return all;
  const tagIso = sh("git", ["log", "-1", "--format=%cI", prevTag]);
  const cutoff = new Date(tagIso).getTime();
  return all.filter((pr) => new Date(pr.mergedAt).getTime() > cutoff);
}

async function main() {
  const bump = process.env.BUMP;
  if (!["patch", "minor", "major"].includes(bump)) {
    console.error(`BUMP must be patch|minor|major, got: ${bump}`);
    process.exit(1);
  }
  const repo = repoSlug();
  const prevTag = latestTag();
  const newTag = bumpVersion(prevTag, bump);
  const prs = mergedPrsSince(prevTag);
  const notes = buildReleaseNotes({ prs, prevTag, newTag, repo });

  writeFileSync("release-notes.md", notes + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${newTag}\n`);
  }
  console.log(`Previous tag: ${prevTag || "(none)"}`);
  console.log(`New tag: ${newTag}`);
  console.log(`PRs included: ${prs.length}`);
  console.log("--- release-notes.md ---");
  console.log(notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
