import { describe, expect, it } from "vitest";
import {
  CODE39_CHARS,
  canEncode,
  code39Pattern,
  encodeCode39,
} from "./barcode";

/**
 * These are not decoration: the pattern table is hand-entered data, and a
 * mistyped pattern would print a label that scans as something else. Code 39's
 * structure is rigid enough that "nine elements, exactly three wide, all
 * distinct" catches essentially any single typo.
 */
describe("the Code 39 pattern table", () => {
  const all = [...CODE39_CHARS, "*"];

  it("covers the charset an asset code needs", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. ") {
      expect(code39Pattern(c), c).toBeDefined();
    }
  });

  it("gives every character nine elements", () => {
    for (const c of all) expect(code39Pattern(c)!.length, c).toBe(9);
  });

  it("gives every character exactly three wide elements", () => {
    for (const c of all) {
      const wide = code39Pattern(c)!.split("").filter((e) => e === "w").length;
      expect(wide, c).toBe(3);
    }
  });

  it("uses only n and w", () => {
    for (const c of all) expect(code39Pattern(c)!).toMatch(/^[nw]{9}$/);
  });

  it("has no two characters sharing a pattern", () => {
    const patterns = all.map((c) => code39Pattern(c)!);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  /**
   * The spec's own split: ordinary characters carry two wide BARS and one wide
   * SPACE; the four punctuation symbols `$ / + %` carry three wide spaces and no
   * wide bar. Nothing else is legal, so this pins each row to the right family.
   */
  it("splits wide elements between bars and spaces exactly as the spec does", () => {
    const spaceOnly = ["$", "/", "+", "%"];
    for (const c of all) {
      const p = code39Pattern(c)!;
      const wideBars = [0, 2, 4, 6, 8].filter((i) => p[i] === "w").length;
      const wideSpaces = [1, 3, 5, 7].filter((i) => p[i] === "w").length;
      if (spaceOnly.includes(c)) {
        expect([wideBars, wideSpaces], c).toEqual([0, 3]);
      } else {
        expect([wideBars, wideSpaces], c).toEqual([2, 1]);
      }
    }
  });
});

describe("canEncode", () => {
  it("accepts an asset code in either case", () => {
    expect(canEncode("AST-0007")).toBe(true);
    expect(canEncode("ast-0007")).toBe(true);
  });

  it("rejects characters Code 39 has no pattern for", () => {
    expect(canEncode("AST_0007")).toBe(false);
    expect(canEncode("ओवन")).toBe(false);
  });

  it("rejects the start/stop character as data", () => {
    expect(canEncode("AST*7")).toBe(false);
  });
});

describe("encodeCode39", () => {
  it("wraps the value in start/stop characters", () => {
    const bc = encodeCode39("A");
    // 3 characters × 9 elements, plus a gap after each of the first two.
    expect(bc.elements).toHaveLength(3 * 9 + 2);
    expect(bc.text).toBe("A");
  });

  it("starts and ends on a bar", () => {
    const bc = encodeCode39("AST-0007");
    expect(bc.elements[0].bar).toBe(true);
    expect(bc.elements[bc.elements.length - 1].bar).toBe(true);
  });

  it("alternates bar and space within every character", () => {
    const bc = encodeCode39("42");
    // Walk each 9-element block; the gaps between blocks are spaces too, so
    // check the blocks rather than the whole run.
    for (let start = 0; start + 9 <= bc.elements.length; start += 10) {
      for (let i = 0; i < 9; i++) {
        expect(bc.elements[start + i].bar).toBe(i % 2 === 0);
      }
    }
  });

  it("upper-cases the text a scanner will read back", () => {
    expect(encodeCode39("ast-1").text).toBe("AST-1");
  });

  it("honours the wide:narrow ratio in the total width", () => {
    // Every character contributes 6 narrow + 3 wide units, plus one-unit gaps.
    const chars = 3; // start + 1 data + stop
    expect(encodeCode39("A", 2).units).toBe(chars * (6 + 3 * 2) + (chars - 1));
    expect(encodeCode39("A", 3).units).toBe(chars * (6 + 3 * 3) + (chars - 1));
  });

  it("throws rather than silently dropping a character it cannot carry", () => {
    // A label that scans as the wrong asset is worse than no label at all.
    expect(() => encodeCode39("AST_1")).toThrow();
    expect(() => encodeCode39("   ")).toThrow();
  });
});
