// Formats grouped release notes from conventional-commit subjects.
// Pure by design — the git I/O lives in scripts/version.mjs.

/** @param {string} subject @returns {"features"|"fixes"|"other"} */
function categorize(subject) {
  const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  const type = m ? m[1].toLowerCase() : "";
  if (type === "feat") return "features";
  if (type === "fix") return "fixes";
  return "other";
}

/**
 * @param {{ subjects: string[], prevTag: string, newTag: string, repo: string }} args
 *   `subjects` are commit subjects (squash merges already carry "(#123)").
 * @returns {string} markdown release body
 */
export function buildReleaseNotes({ subjects, prevTag, newTag, repo }) {
  const groups = { features: [], fixes: [], other: [] };
  for (const subject of subjects) groups[categorize(subject)].push(subject);

  const section = (heading, items) =>
    items.length ? `### ${heading}\n\n${items.map((s) => `- ${s}`).join("\n")}` : null;

  const sections = [
    section("Features", groups.features),
    section("Fixes", groups.fixes),
    section("Other", groups.other),
  ].filter(Boolean);

  let body = sections.length ? sections.join("\n\n") : "_No changes since the last release._";

  if (prevTag) {
    body += `\n\n**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`;
  }
  return body;
}
