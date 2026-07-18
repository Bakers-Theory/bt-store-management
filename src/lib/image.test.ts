import { describe, it, expect } from "vitest";
import { fitWithin } from "./image";

describe("fitWithin", () => {
  it("leaves an image smaller than the cap unchanged", () => {
    expect(fitWithin(300, 200, 512)).toEqual({ w: 300, h: 200 });
  });

  it("scales a wide image so its longest side equals the cap", () => {
    expect(fitWithin(1024, 512, 512)).toEqual({ w: 512, h: 256 });
  });

  it("scales a tall image so its longest side equals the cap", () => {
    expect(fitWithin(512, 1024, 512)).toEqual({ w: 256, h: 512 });
  });

  it("rounds to whole pixels", () => {
    expect(fitWithin(1000, 333, 512)).toEqual({ w: 512, h: 170 });
  });
});
