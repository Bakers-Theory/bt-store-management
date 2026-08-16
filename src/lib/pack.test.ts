import { describe, it, expect } from "vitest";
import { isPacked, piecePrice, piecesAvailable, stockLabel, unitFor } from "./pack";

describe("isPacked", () => {
  it("is false for anything sold whole", () => {
    expect(isPacked(null)).toBe(false);
    // A pack of one is just the item; the SQL constraint refuses it too.
    expect(isPacked(1)).toBe(false);
  });
  it("is true above one", () => {
    expect(isPacked(100)).toBe(true);
  });
});

describe("piecePrice", () => {
  it("splits the pack price evenly", () => {
    expect(piecePrice(100, 100)).toBe(1);
    expect(piecePrice(250, 50)).toBe(5);
  });
  it("rounds to the paisa, so the parts need not re-sum to the whole", () => {
    expect(piecePrice(100, 3)).toBe(33.33);
    expect(piecePrice(100, 3) * 3).toBeCloseTo(99.99, 5);
  });
  it("leaves an unpacked price alone", () => {
    expect(piecePrice(40, null)).toBe(40);
    expect(piecePrice(40, 1)).toBe(40);
  });
});

describe("piecesAvailable", () => {
  it("counts every piece still inside a pack, plus the loose ones", () => {
    expect(piecesAvailable(2, 40, 100)).toBe(240);
  });
  it("is just the loose count when no whole packs are left", () => {
    expect(piecesAvailable(0, 7, 100)).toBe(7);
  });
  it("falls back to the plain quantity when nothing is packed", () => {
    expect(piecesAvailable(5, 0, null)).toBe(5);
  });
});

describe("stockLabel", () => {
  it("names the item's own unit when nothing is loose", () => {
    expect(stockLabel(3, 0, 100, "box")).toBe("3 box");
    expect(stockLabel(3, 0, null, "kg")).toBe("3 kg");
  });
  it("shows packs and pieces side by side", () => {
    expect(stockLabel(2, 40, 100, "box")).toBe("2 box + 40 pcs");
  });
});

describe("unitFor", () => {
  it("prints pcs on a piece line and the item's unit on a pack line", () => {
    expect(unitFor("piece", "box")).toBe("pcs");
    expect(unitFor("pack", "box")).toBe("box");
  });
});
