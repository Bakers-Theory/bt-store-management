/**
 * A QR module matrix, from `qrcode-generator`.
 *
 * WHY A DEPENDENCY HERE AND NOT FOR THE BARCODE: Code 39 is a 44-row lookup table
 * whose correctness structural tests can pin down (`barcode.test.ts`). QR needs
 * Reed–Solomon error correction, version selection and mask evaluation — several
 * hundred lines whose output no test here could prove a physical scanner would
 * read. `qrcode-generator` is 30KB, has no dependencies of its own, and is
 * verified by everyone who uses it.
 *
 * It is imported DYNAMICALLY and returns a plain boolean matrix, which keeps the
 * encoder out of the app bundle and leaves `LabelPrintHost` — mounted in the root
 * layout on every page — drawing rectangles and nothing more.
 */

/** `true` = a dark module. Square: `matrix[row][col]`. */
export type QrMatrix = boolean[][];

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

/**
 * Encodes `text` and returns its modules.
 *
 * `M` (~15% recovery) is the default because these labels get scuffed in a
 * stockroom but the code also has to stay small enough to print at 25mm.
 *
 * Type number 0 lets the library pick the smallest version that fits, so a short
 * payload prints as a coarse, easily-read grid rather than a needlessly dense one.
 */
export async function qrMatrix(
  text: string,
  ec: QrErrorCorrection = "M",
): Promise<QrMatrix> {
  const { default: qrcode } = await import("qrcode-generator");

  // The library's own byte encoder is Latin-1 (`charCodeAt & 0xff`), which would
  // mangle any non-ASCII character in an asset name. Byte mode is read as UTF-8
  // by every scanner in practice, so encode it as UTF-8.
  qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

  const qr = qrcode(0, ec);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}
