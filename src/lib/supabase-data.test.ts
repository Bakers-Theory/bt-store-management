import { describe, it, expect } from "vitest";
import { groupLists } from "./supabase-data";

describe("groupLists", () => {
  it("buckets rows by kind and preserves input order", () => {
    expect(
      groupLists([
        { kind: "category", value: "Breads" },
        { kind: "category", value: "Cakes" },
        { kind: "unit", value: "pcs" },
        { kind: "emoji", value: "🥐" },
        { kind: "reason", value: "Sold" },
      ]),
    ).toEqual({
      categories: ["Breads", "Cakes"],
      units: ["pcs"],
      emojis: ["🥐"],
      reasons: ["Sold"],
    });
  });

  it("yields empty arrays for absent kinds", () => {
    expect(groupLists([])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
    });
  });

  it("ignores unknown kinds", () => {
    expect(groupLists([{ kind: "bogus", value: "x" }])).toEqual({
      categories: [], emojis: [], units: [], reasons: [],
    });
  });
});
