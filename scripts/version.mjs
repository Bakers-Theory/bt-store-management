// Version arithmetic for the two-environment release flow.
// See docs/superpowers/specs/2026-08-03-two-env-deploy-design.md.
// Pure functions are exported for unit testing; the CLI at the bottom of this
// file (Task 3) does the git I/O.

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-rc(?:\.(\d+))?)?$/;
const HEADER_RE = /^(\w+)(\([^)]*\))?(!)?:/;

/**
 * @param {string|undefined} tag e.g. "v0.8.1", "v0.8.1-rc", "v0.8.1-rc.2"
 * @returns {{major:number,minor:number,patch:number,rc:number|null}|null}
 *   `rc` is null for a stable tag; a plain "-rc" counts as rc 1, which gives
 *   the same ordering semver gives it against "-rc.2".
 */
export function parseTag(tag) {
  const m = TAG_RE.exec(tag ?? "");
  if (!m) return null;
  const [, major, minor, patch, rc] = m;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    rc: tag.includes("-rc") ? Number(rc ?? 1) : null,
  };
}

/**
 * Semver precedence. A stable release outranks any rc of the same version.
 * @returns {number} negative if a < b, positive if a > b, 0 if equal
 */
export function compareTags(a, b) {
  const pa = parseTag(a);
  const pb = parseTag(b);
  if (!pa || !pb) throw new Error(`Cannot compare tags: ${a} / ${b}`);
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }
  if (pa.rc === pb.rc) return 0;
  if (pa.rc === null) return 1;
  if (pb.rc === null) return -1;
  return pa.rc - pb.rc;
}

/** @param {string[]} tags @returns {string} highest by precedence, "" if none */
export function latestTag(tags) {
  return tags
    .filter((t) => parseTag(t))
    .reduce((best, t) => (best === "" || compareTags(t, best) > 0 ? t : best), "");
}

/** @param {string[]} tags @returns {string} highest non-rc tag, "" if none */
export function latestStableTag(tags) {
  return latestTag(tags.filter((t) => parseTag(t)?.rc === null));
}

/**
 * @param {string[]} messages full commit messages (subject + body)
 * @param {number} currentMajor major of the latest tag — breaking changes stay
 *   a minor bump while it is 0
 * @returns {"major"|"minor"|"patch"|null} null when there is nothing to release
 */
export function deriveBump(messages, currentMajor) {
  if (messages.length === 0) return null;
  const RANKS = ["patch", "minor", "major"];
  let rank = 0;
  for (const message of messages) {
    const header = message.split("\n", 1)[0];
    const m = HEADER_RE.exec(header);
    const breaking = Boolean(m?.[3]) || /^BREAKING[ -]CHANGE:/m.test(message);
    if (breaking) rank = Math.max(rank, currentMajor === 0 ? 1 : 2);
    else if (m?.[1].toLowerCase() === "feat") rank = Math.max(rank, 1);
  }
  return RANKS[rank];
}

/**
 * Applies a bump, discarding any rc suffix: v0.8.0-rc + patch = v0.8.1.
 * @param {string} tag "" is treated as v0.0.0
 * @param {"major"|"minor"|"patch"} bump
 * @returns {string}
 */
export function applyBump(tag, bump) {
  const p = parseTag(tag) ?? { major: 0, minor: 0, patch: 0, rc: null };
  switch (bump) {
    case "major":
      return `v${p.major + 1}.0.0`;
    case "minor":
      return `v${p.major}.${p.minor + 1}.0`;
    case "patch":
      return `v${p.major}.${p.minor}.${p.patch + 1}`;
    default:
      throw new Error(`Unknown bump: ${bump}`);
  }
}

/**
 * @param {string} latest latest tag, rc or stable, "" for none
 * @param {"major"|"minor"|"patch"} bump
 * @param {string[]} [existingTags] used to dodge collisions on workflow re-runs
 * @returns {string} e.g. "v0.8.1-rc", or "v0.8.1-rc.2" if that already exists
 */
export function nextRcTag(latest, bump, existingTags = []) {
  const base = applyBump(latest, bump);
  let n = 1;
  let candidate = `${base}-rc`;
  while (existingTags.includes(candidate)) candidate = `${base}-rc.${++n}`;
  return candidate;
}

/** @param {string} rcTag @returns {string} the stable tag, e.g. v0.9.1-rc -> v0.9.1 */
export function promote(rcTag) {
  const p = parseTag(rcTag);
  if (!p || p.rc === null) throw new Error(`Not an rc tag: ${rcTag}`);
  return `v${p.major}.${p.minor}.${p.patch}`;
}

import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildReleaseNotes } from "./release-notes.mjs";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function allTags() {
  const out = sh("git", ["tag", "--list", "v*"]);
  return out ? out.split("\n").map((s) => s.trim()) : [];
}

/** Full messages, NUL-separated so bodies with blank lines survive. */
function messagesIn(range) {
  const out = sh("git", ["log", range, "--format=%B%x00"]);
  return out ? out.split("\0").map((s) => s.trim()).filter(Boolean) : [];
}

function subjectsIn(range) {
  const out = sh("git", ["log", range, "--format=%s"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function commitExists(ref) {
  try {
    sh("git", ["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  // e.g. git@github.com:Bakers-Theory/bt-store-management.git
  const url = sh("git", ["remote", "get-url", "origin"]);
  const m = url.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot derive repo from remote: ${url}`);
  return m[1];
}

function out(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
}

/**
 * `github.event.before` is 40 zeros on a branch's first push and stale after a
 * force push, so it is not always a usable range endpoint — fall back to the
 * last tag in that case.
 */
function resolveRange(raw, latest) {
  if (raw && raw.includes("..")) {
    const from = raw.split("..")[0];
    if (!/^0{40}$/.test(from) && commitExists(from)) return raw;
  }
  return latest ? `${latest}..HEAD` : "HEAD";
}

function rcMode() {
  const tags = allTags();
  const latest = latestTag(tags);
  const range = resolveRange(process.env.RANGE, latest);
  const bump = deriveBump(messagesIn(range), parseTag(latest)?.major ?? 0);

  if (!bump) {
    console.log(`No commits in ${range} — nothing to release.`);
    out("skip", "true");
    return;
  }

  const tag = nextRcTag(latest, bump, tags);
  const notes = buildReleaseNotes({
    subjects: subjectsIn(range),
    prevTag: latest,
    newTag: tag,
    repo: repoSlug(),
  });
  writeFileSync("release-notes.md", `${notes}\n`);

  out("skip", "false");
  out("tag", tag);
  console.log(`Latest tag: ${latest || "(none)"} | range: ${range} | bump: ${bump}`);
  console.log("--- release-notes.md ---");
  console.log(notes);
}

function promoteMode() {
  const tags = allTags();
  const rcTag =
    process.env.RC_TAG?.trim() || latestTag(tags.filter((t) => parseTag(t)?.rc !== null));
  if (!rcTag) throw new Error("No rc tag exists to promote.");
  if (!tags.includes(rcTag)) throw new Error(`Tag does not exist: ${rcTag}`);

  const stable = promote(rcTag); // throws if rcTag is not an rc
  if (tags.includes(stable)) throw new Error(`${stable} already exists — nothing to promote.`);

  const sha = sh("git", ["rev-parse", `${rcTag}^{commit}`]);
  const mainSha = commitExists("refs/remotes/origin/main")
    ? sh("git", ["rev-parse", "refs/remotes/origin/main"])
    : "";
  if (!mainSha) {
    throw new Error(
      "Cannot resolve origin/main — refusing to promote without the backwards-deploy guard.",
    );
  }
  if (mainSha === sha) throw new Error(`${rcTag} is already what production is running.`);
  try {
    sh("git", ["merge-base", "--is-ancestor", mainSha, sha]);
  } catch {
    throw new Error(
      `${rcTag} (${sha.slice(0, 7)}) is not a descendant of main (${mainSha.slice(0, 7)}) — ` +
        "refusing to deploy backwards.",
    );
  }

  const prevStable = latestStableTag(tags);
  const range = prevStable ? `${prevStable}..${sha}` : sha;
  const notes = buildReleaseNotes({
    subjects: subjectsIn(range),
    prevTag: prevStable,
    newTag: stable,
    repo: repoSlug(),
  });
  writeFileSync("release-notes.md", `${notes}\n`);

  out("rc_tag", rcTag);
  out("tag", stable);
  out("sha", sha);
  console.log(`Promoting ${rcTag} -> ${stable} at ${sha.slice(0, 7)} | notes range: ${range}`);
  console.log("--- release-notes.md ---");
  console.log(notes);
}

function main() {
  const mode = process.env.MODE;
  if (mode === "rc") return rcMode();
  if (mode === "promote") return promoteMode();
  console.error(`MODE must be "rc" or "promote", got: ${mode}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
