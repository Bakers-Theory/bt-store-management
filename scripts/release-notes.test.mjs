import { describe, expect, it } from "vitest";
import { buildReleaseNotes } from "./release-notes.mjs";

const args = (subjects, extra = {}) => ({
  subjects,
  prevTag: "v0.7.5",
  newTag: "v0.8.0-rc",
  repo: "Bakers-Theory/bt-store-management",
  ...extra,
});

describe("buildReleaseNotes", () => {
  it("groups subjects into features, fixes, and other", () => {
    const notes = buildReleaseNotes(
      args([
        "feat: add cashbook (#79)",
        "fix: bill improvements (#85)",
        "chore: UI improvements (#81)",
        "feat(bills): add discount (#88)",
      ]),
    );
    expect(notes).toContain("### Features\n\n- feat: add cashbook (#79)\n- feat(bills): add discount (#88)");
    expect(notes).toContain("### Fixes\n\n- fix: bill improvements (#85)");
    expect(notes).toContain("### Other\n\n- chore: UI improvements (#81)");
  });

  it("omits empty sections", () => {
    const notes = buildReleaseNotes(args(["fix: correct total (#90)"]));
    expect(notes).toContain("### Fixes");
    expect(notes).not.toContain("### Features");
    expect(notes).not.toContain("### Other");
  });

  it("appends a compare link when there is a previous tag", () => {
    const notes = buildReleaseNotes(args(["feat: x (#1)"]));
    expect(notes).toContain(
      "**Full Changelog**: https://github.com/Bakers-Theory/bt-store-management/compare/v0.7.5...v0.8.0-rc",
    );
  });

  it("omits the compare link on a first release", () => {
    const notes = buildReleaseNotes(args(["feat: x (#1)"], { prevTag: "" }));
    expect(notes).not.toContain("Full Changelog");
  });

  it("has a placeholder body when there are no subjects", () => {
    const notes = buildReleaseNotes(args([]));
    expect(notes).toContain("_No changes since the last release._");
  });
});
