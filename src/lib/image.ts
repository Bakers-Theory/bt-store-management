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
