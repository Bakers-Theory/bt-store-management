import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

/**
 * These do not re-test the library's encoder — that is its job. They pin the
 * WIRING: that the matrix comes back square and the right shape, that the finder
 * and timing patterns are where a scanner looks for them (so the orientation is
 * not transposed), and that the UTF-8 override took effect.
 */
describe("qrMatrix", () => {
  it("returns a square matrix of a legal QR size", () => {
    return qrMatrix("BT-AST-001").then((m) => {
      expect(m.length).toBeGreaterThanOrEqual(21);
      // Every QR version is 4n+17 modules across.
      expect((m.length - 17) % 4).toBe(0);
      for (const row of m) expect(row).toHaveLength(m.length);
    });
  });

  it("puts a finder pattern in the three corners a scanner reads", async () => {
    const m = await qrMatrix("BT-AST-001");
    const n = m.length;
    // A finder is a 7×7 ring: dark border, light inset, dark 3×3 core.
    const finderAt = (top: number, left: number) => {
      expect(m[top][left], "outer corner").toBe(true);
      expect(m[top + 1][left + 1], "light ring").toBe(false);
      expect(m[top + 3][left + 3], "dark core").toBe(true);
      expect(m[top + 6][left + 6], "outer corner").toBe(true);
    };
    finderAt(0, 0);
    finderAt(0, n - 7);
    finderAt(n - 7, 0);
    // …and deliberately NOT in the fourth corner, which is how orientation is read.
    expect(m[n - 1][n - 1]).toBe(false);
  });

  it("lays the timing pattern along row and column 6, alternating", async () => {
    const m = await qrMatrix("BT-AST-001");
    for (let i = 8; i < m.length - 8; i++) {
      expect(m[6][i], `row 6 col ${i}`).toBe(i % 2 === 0);
      expect(m[i][6], `col 6 row ${i}`).toBe(i % 2 === 0);
    }
  });

  it("grows with the payload rather than truncating it", async () => {
    const small = await qrMatrix("BT-AST-001");
    const big = await qrMatrix("BT-AST-001\n".repeat(30));
    expect(big.length).toBeGreaterThan(small.length);
  });

  it("encodes non-ASCII text — the Latin-1 default would mangle it", async () => {
    // Two payloads differing only outside ASCII must produce different codes; with
    // the library's own `charCodeAt & 0xff` they could collide.
    const a = await qrMatrix("ओवन");
    const b = await qrMatrix("ओवम");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("gets denser as error correction rises for the same text", async () => {
    const text = "BT-AST-001\n".repeat(12);
    const low = await qrMatrix(text, "L");
    const high = await qrMatrix(text, "H");
    expect(high.length).toBeGreaterThanOrEqual(low.length);
  });
});
