import { ymdToDMY } from "./excel";
import type { Asset } from "./types";

/**
 * What a printed asset label carries.
 *
 * Two codes, for two jobs, and a label normally carries BOTH:
 *   - `barcode` (Code 39, `lib/barcode.ts`) encodes the asset CODE and nothing
 *     else. It is what a handheld stock scanner reads, and it stays readable at a
 *     size that fits a small label.
 *   - `qr` carries a link to the asset's page followed by its details, so a phone
 *     camera can open the live record and someone with no signal can still read
 *     the facts off the payload.
 *
 * `both` is the default: the two readers are different pieces of hardware, and a
 * stockroom has both. Either alone stays available for narrow label stock, where
 * one code at a readable size is all that fits.
 *
 * THE PAYLOAD CARRIES ONLY DURABLE FACTS. A printed label is frozen the moment it
 * leaves the printer, so status, current holder and location are deliberately
 * absent: an asset is reassigned every few months and a sticker claiming it lives
 * with Asha would start lying immediately. What cannot change — code, name,
 * category, make, serial, purchase date, warranty — is safe to print. The URL is
 * there for everything else: it always shows the current truth.
 */
export type LabelKind = "both" | "barcode" | "qr";

export const LABEL_KINDS: LabelKind[] = ["both", "barcode", "qr"];

export function labelKindLabel(k: LabelKind): string {
  switch (k) {
    case "both":
      return "Barcode + QR";
    case "qr":
      return "QR code only";
    case "barcode":
      return "Barcode only";
  }
}

export const labelHasQr = (k: LabelKind): boolean => k === "qr" || k === "both";
export const labelHasBarcode = (k: LabelKind): boolean =>
  k === "barcode" || k === "both";

/**
 * The asset's page, addressed by code rather than by row id: a code is what is
 * printed on the label and what a person can retype if the sticker is scuffed.
 */
export function assetLabelUrl(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/assets?code=${encodeURIComponent(code.trim().toUpperCase())}`;
}

const line = (label: string, value: string | null) =>
  value && value.trim() !== "" ? `${label}: ${value.trim()}` : null;

/**
 * The QR payload: the link on the first line, then the durable details.
 *
 * The URL leads because that is what a phone camera offers to open. Everything
 * after it is plain text, so a reader with no network still gets the facts — the
 * whole reason this is not *just* a URL.
 */
export function assetQrPayload(asset: Asset, origin: string): string {
  const makeModel = [asset.brand, asset.model].filter((s) => s.trim() !== "").join(" ");

  return [
    assetLabelUrl(origin, asset.code),
    `${asset.code} — ${asset.name}`,
    line("Category", asset.category),
    line("Make", makeModel),
    line("Serial", asset.serialNumber),
    line("Bought", asset.purchaseDate ? ymdToDMY(asset.purchaseDate) : null),
    line("Warranty until", asset.warrantyExpiry ? ymdToDMY(asset.warrantyExpiry) : null),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * A QR grows in steps, and past roughly 300 bytes it needs a version dense enough
 * that a 25mm print stops scanning reliably on a phone. Nothing here is truncated
 * — the caller warns instead, because a silently shortened serial number on a
 * physical sticker is a fault nobody would ever notice.
 */
export const QR_COMFORTABLE_BYTES = 300;

export const payloadBytes = (payload: string): number =>
  new TextEncoder().encode(payload).length;
