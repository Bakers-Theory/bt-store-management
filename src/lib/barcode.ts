/**
 * Code 39, as bar widths — enough to draw a scannable label in inline SVG with
 * no dependency and no canvas.
 *
 * #91 §2.4 wants a printable label for an asset. Code 39 is the right symbology
 * here for three reasons: its charset (digits, A–Z, `-`, `.`, space, `$/+%`)
 * covers an asset code like `AST-0007` exactly; it is self-checking, so no check
 * digit has to be computed and kept consistent with the server; and it encodes as
 * two bar widths, which is what makes it drawable as plain rectangles.
 *
 * Each character is nine alternating elements — bar, space, bar, … starting and
 * ending on a bar — of which exactly three are wide. `*` is the start/stop
 * character and is not part of the data. Those invariants are asserted in
 * `barcode.test.ts`, which is what guards the table below against a typo: a
 * mistyped pattern would almost certainly break "nine elements, three wide,
 * every pattern distinct".
 */

/** `n` = narrow, `w` = wide. Odd positions are bars, even ones spaces. */
const PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  /** Start/stop only. Never data. */
  "*": "nwnnwnwnn",
};

export const CODE39_CHARS = Object.keys(PATTERNS).filter((c) => c !== "*");

export const code39Pattern = (char: string): string | undefined =>
  PATTERNS[char];

/** True if every character of `value` can be encoded. Case-insensitive. */
export const canEncode = (value: string): boolean =>
  value.toUpperCase().split("").every((c) => c in PATTERNS && c !== "*");

/** One drawable element: a bar or a gap, `units` narrow-widths across. */
export interface BarcodeElement {
  bar: boolean;
  units: number;
}

export interface Barcode {
  /** The encoded text, upper-cased — what a scanner will read back. */
  text: string;
  elements: BarcodeElement[];
  /** Total width in narrow units, for the SVG viewBox. */
  units: number;
}

/**
 * Encodes `value` between start/stop characters, with the one-narrow-unit gap
 * Code 39 requires between characters. `wide` is the wide:narrow ratio — 2 is
 * within spec (2–3) and keeps a label compact.
 *
 * Throws on an unencodable character rather than silently dropping it: a label
 * that scans as the wrong asset is worse than no label.
 */
export function encodeCode39(value: string, wide = 2): Barcode {
  const text = value.trim().toUpperCase();
  if (text === "") throw new Error("nothing to encode");
  if (!canEncode(text)) {
    throw new Error(`"${value}" has characters a Code 39 label cannot carry`);
  }

  const elements: BarcodeElement[] = [];
  const chars = ["*", ...text.split(""), "*"];

  chars.forEach((char, i) => {
    const pattern = PATTERNS[char];
    for (let p = 0; p < pattern.length; p++) {
      elements.push({
        // Odd positions (0-indexed even) are bars.
        bar: p % 2 === 0,
        units: pattern[p] === "w" ? wide : 1,
      });
    }
    // The inter-character gap, on every character but the last.
    if (i < chars.length - 1) elements.push({ bar: false, units: 1 });
  });

  return {
    text,
    elements,
    units: elements.reduce((sum, e) => sum + e.units, 0),
  };
}
