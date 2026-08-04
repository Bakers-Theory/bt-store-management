import { describe, expect, it } from "vitest";
import {
  applyBump,
  compareTags,
  deriveBump,
  latestStableTag,
  latestTag,
  nextRcTag,
  parseTag,
  promote,
} from "./version.mjs";

describe("parseTag", () => {
  it("parses a stable tag", () => {
    expect(parseTag("v0.7.5")).toEqual({ major: 0, minor: 7, patch: 5, rc: null });
  });

  it("treats a plain -rc suffix as rc 1", () => {
    expect(parseTag("v0.8.0-rc")).toEqual({ major: 0, minor: 8, patch: 0, rc: 1 });
  });

  it("parses a numbered rc", () => {
    expect(parseTag("v0.8.0-rc.2")).toEqual({ major: 0, minor: 8, patch: 0, rc: 2 });
  });

  it("returns null for junk", () => {
    expect(parseTag("nightly")).toBeNull();
    expect(parseTag("v1.2")).toBeNull();
    expect(parseTag("")).toBeNull();
    expect(parseTag(undefined)).toBeNull();
  });
});

describe("compareTags", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareTags("v1.0.0", "v0.9.9")).toBeGreaterThan(0);
    expect(compareTags("v0.8.0", "v0.9.0")).toBeLessThan(0);
    expect(compareTags("v0.8.1", "v0.8.0")).toBeGreaterThan(0);
  });

  it("ranks a stable release above any rc of the same version", () => {
    expect(compareTags("v0.9.1", "v0.9.1-rc")).toBeGreaterThan(0);
    expect(compareTags("v0.9.1-rc.9", "v0.9.1")).toBeLessThan(0);
  });

  it("orders rc numbers", () => {
    expect(compareTags("v0.8.0-rc.2", "v0.8.0-rc")).toBeGreaterThan(0);
    expect(compareTags("v0.8.0-rc", "v0.8.0-rc")).toBe(0);
  });
});

describe("latestTag", () => {
  it("picks the highest tag including rcs, ignoring unparseable ones", () => {
    const tags = ["v0.7.5", "v0.8.0-rc", "v0.8.1-rc", "nightly", "v0.7.4"];
    expect(latestTag(tags)).toBe("v0.8.1-rc");
  });

  it("prefers the stable release over its own rc", () => {
    expect(latestTag(["v0.9.1-rc", "v0.9.1"])).toBe("v0.9.1");
  });

  it("returns an empty string when nothing parses", () => {
    expect(latestTag(["nightly", "junk"])).toBe("");
    expect(latestTag([])).toBe("");
  });
});

describe("latestStableTag", () => {
  it("ignores rc tags", () => {
    expect(latestStableTag(["v0.7.5", "v0.8.0-rc", "v0.9.0-rc"])).toBe("v0.7.5");
  });

  it("returns an empty string when there is no stable tag", () => {
    expect(latestStableTag(["v0.1.0-rc"])).toBe("");
  });
});

describe("deriveBump", () => {
  it("returns null when there is nothing to release", () => {
    expect(deriveBump([], 0)).toBeNull();
  });

  it("treats feat as a minor bump", () => {
    expect(deriveBump(["feat: add cashbook"], 0)).toBe("minor");
    expect(deriveBump(["feat(bills): add discount"], 0)).toBe("minor");
  });

  it("treats fix, chore, and unrecognised types as a patch bump", () => {
    expect(deriveBump(["fix: correct total"], 0)).toBe("patch");
    expect(deriveBump(["chore: bump deps"], 0)).toBe("patch");
    expect(deriveBump(["refactor: tidy store"], 0)).toBe("patch");
    expect(deriveBump(["no conventional prefix at all"], 0)).toBe("patch");
  });

  it("keeps a breaking change at minor while the major is 0", () => {
    expect(deriveBump(["feat!: drop legacy bills"], 0)).toBe("minor");
    expect(deriveBump(["fix!: change rpc shape"], 0)).toBe("minor");
    expect(deriveBump(["feat: x\n\nBREAKING CHANGE: rpc renamed"], 0)).toBe("minor");
  });

  it("escalates a breaking change to major once past 1.0", () => {
    expect(deriveBump(["feat!: drop legacy bills"], 1)).toBe("major");
    expect(deriveBump(["feat: x\n\nBREAKING CHANGE: rpc renamed"], 2)).toBe("major");
  });

  it("takes the highest-precedence type in a multi-commit push", () => {
    expect(deriveBump(["chore: tidy", "feat: add report", "fix: typo"], 0)).toBe("minor");
    expect(deriveBump(["fix: typo", "feat!: breaking"], 1)).toBe("major");
  });

  it("does not mistake a body mention of feat for a feature", () => {
    expect(deriveBump(["chore: notes\n\nmentions feat: nothing"], 0)).toBe("patch");
  });
});

describe("applyBump", () => {
  it("bumps each component", () => {
    expect(applyBump("v0.7.5", "patch")).toBe("v0.7.6");
    expect(applyBump("v0.7.5", "minor")).toBe("v0.8.0");
    expect(applyBump("v0.7.5", "major")).toBe("v1.0.0");
  });

  it("strips an rc suffix before bumping", () => {
    expect(applyBump("v0.8.0-rc", "patch")).toBe("v0.8.1");
    expect(applyBump("v0.8.0-rc.3", "minor")).toBe("v0.9.0");
  });

  it("treats an empty tag as v0.0.0", () => {
    expect(applyBump("", "minor")).toBe("v0.1.0");
  });

  it("rejects an unknown bump", () => {
    expect(() => applyBump("v0.7.5", "sideways")).toThrow(/Unknown bump/);
  });
});

describe("nextRcTag", () => {
  it("appends a plain -rc suffix", () => {
    expect(nextRcTag("v0.7.5", "minor")).toBe("v0.8.0-rc");
    expect(nextRcTag("v0.8.0-rc", "patch")).toBe("v0.8.1-rc");
    expect(nextRcTag("v0.8.1-rc", "minor")).toBe("v0.9.0-rc");
  });

  it("falls back to a numbered rc when the tag already exists", () => {
    expect(nextRcTag("v0.7.5", "minor", ["v0.8.0-rc"])).toBe("v0.8.0-rc.2");
    expect(nextRcTag("v0.7.5", "minor", ["v0.8.0-rc", "v0.8.0-rc.2"])).toBe("v0.8.0-rc.3");
  });
});

describe("promote", () => {
  it("strips the rc suffix", () => {
    expect(promote("v0.9.1-rc")).toBe("v0.9.1");
    expect(promote("v0.9.1-rc.4")).toBe("v0.9.1");
  });

  it("rejects a stable tag", () => {
    expect(() => promote("v0.9.1")).toThrow(/Not an rc tag/);
    expect(() => promote("junk")).toThrow(/Not an rc tag/);
  });
});
