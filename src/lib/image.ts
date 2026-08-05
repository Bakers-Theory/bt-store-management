import { createClient } from "@/utils/supabase/client";

export const MAX_IMAGE_DIM = 512;
export const IMAGE_QUALITY = 0.8;
// Generous cap: we always downscale to 512px WebP before upload, so this only
// guards against pathologically large files. iOS converts HEIC → full-res JPEG
// when handing a photo to the browser, which can be 2–3× the size shown in
// Photos, so a 10 MB cap rejected normal phone pictures.
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const BUCKET = "product-images";

/** Scale (w,h) so the longest side is at most `max`, preserving aspect ratio. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const scale = max / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Rectangular crop region in source-image pixels (matches react-easy-crop's croppedAreaPixels). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Load an image element from any src URL (object URL, data URL, remote). */
function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}

/** Load a Blob/File into an HTMLImageElement via a short-lived object URL. */
async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageEl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Crop `src` to `area` (source-pixel rectangle) and return a WebP blob at the
 * crop's own resolution. compressImage() then downscales + re-encodes it.
 */
export async function getCroppedBlob(src: string, area: CropArea): Promise<Blob> {
  const img = await loadImageEl(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop image");
  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0, 0, canvas.width, canvas.height,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.92),
  );
  if (!blob) throw new Error("Could not crop image");
  return blob;
}

/**
 * Resize to <= MAX_IMAGE_DIM on the longest side and re-encode as WebP.
 * Throws on non-image or oversize input.
 */
export async function compressImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image must be under 30 MB");

  const img = await loadImage(file);
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_IMAGE_DIM);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", IMAGE_QUALITY),
  );
  if (!blob) throw new Error("Could not compress image");
  return blob;
}

/** Upload a compressed blob and return its public URL. */
export async function uploadProductImage(blob: Blob): Promise<string> {
  const supabase = createClient();
  const path = `${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort delete of the object behind a public URL (used on replace/remove). */
export async function deleteProductImage(url: string): Promise<void> {
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([path]);
}

// ─── Asset files (#91 §2.2) ─────────────────────────────────────────────────

const ASSET_IMAGE_BUCKET = "asset-images";
const ASSET_DOC_BUCKET = "asset-docs";

/** Cap for a document upload. Manuals are the big ones; 15 MB covers a scan. */
export const MAX_DOC_BYTES = 15 * 1024 * 1024;

/**
 * An asset photo. Public bucket, so the returned URL can be stored on the asset
 * and rendered directly — a picture of a machine is not confidential (see
 * migration 0064 note 1).
 */
export async function uploadAssetImage(blob: Blob): Promise<string> {
  const supabase = createClient();
  const path = `${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from(ASSET_IMAGE_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(ASSET_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deleteAssetImage(url: string): Promise<void> {
  const marker = `/${ASSET_IMAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const supabase = createClient();
  await supabase.storage.from(ASSET_IMAGE_BUCKET).remove([url.slice(idx + marker.length)]);
}

/** Strip anything that would make a storage key awkward, keep it recognisable. */
export const safeFileName = (name: string): string =>
  name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "file";

/**
 * A purchase document: invoice, manual, warranty card. The bucket is PRIVATE, so
 * this returns the object **path**, not a URL — `asset.documents` stores that and
 * `signedDocUrl` mints a short-lived link when someone opens the file. A stored
 * public URL would be a permanent unguarded link to a document carrying prices.
 */
export async function uploadAssetDoc(
  file: File,
): Promise<{ name: string; url: string }> {
  if (file.size > MAX_DOC_BYTES) {
    throw new Error("That file is too large — 15 MB is the limit");
  }
  const supabase = createClient();
  const path = `${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(ASSET_DOC_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw new Error(error.message);
  // `url` carries the path for a private object. The reader is `signedDocUrl`.
  return { name: file.name, url: path };
}

/**
 * A link valid for five minutes — long enough to open or download, short enough
 * that a copied URL is not a lasting leak.
 *
 * Tolerates a stored *public* URL as well as a path, so a document attached
 * before this split (or pasted in by hand) still opens.
 */
export async function signedDocUrl(pathOrUrl: string): Promise<string> {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(ASSET_DOC_BUCKET)
    .createSignedUrl(pathOrUrl, 300);
  if (error || !data) throw new Error(error?.message ?? "Could not open that file");
  return data.signedUrl;
}

export async function deleteAssetDoc(pathOrUrl: string): Promise<void> {
  if (/^https?:\/\//.test(pathOrUrl)) return; // not ours to remove
  const supabase = createClient();
  await supabase.storage.from(ASSET_DOC_BUCKET).remove([pathOrUrl]);
}
