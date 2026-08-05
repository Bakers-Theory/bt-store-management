"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileText, ImagePlus, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";
import {
  MAX_DOC_BYTES,
  MAX_UPLOAD_BYTES,
  compressImage,
  deleteAssetDoc,
  deleteAssetImage,
  signedDocUrl,
  uploadAssetDoc,
  uploadAssetImage,
} from "@/lib/image";
import type { AssetDocument } from "@/lib/types";

// The cropper pulls in react-easy-crop, only needed once a user picks an image.
// Loaded on demand, exactly as ItemModal does, so it stays out of this bundle.
const CropModal = dynamic(
  () => import("@/components/feature/stock/CropModal").then((m) => m.CropModal),
  { ssr: false },
);

const labelCls = "mb-1.5 block text-xs font-bold text-[#8a6a3c]";

/**
 * The photo and the purchase documents on an asset (#91 §2.2).
 *
 * Both are uploaded immediately and handed back to the form as a URL (photo) or
 * an object path (document); the asset row only learns about them when the form
 * is saved. That means an abandoned form can leave an orphaned object in storage
 * — the same trade `ItemModal` already makes for product images, and the cheaper
 * mistake: the alternative is a half-saved asset pointing at a file that a failed
 * save never attached.
 *
 * Documents live in a PRIVATE bucket (migration 0064), so opening one mints a
 * five-minute signed URL rather than following a stored public link.
 */
export function AssetFiles({
  imageUrl,
  documents,
  onImageChange,
  onDocumentsChange,
}: {
  imageUrl: string | null;
  documents: AssetDocument[];
  onImageChange: (url: string | null) => void;
  onDocumentsChange: (docs: AssetDocument[]) => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const imageRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const pickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file", "error");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast("Image must be under 30 MB", "error");
      return;
    }
    setCropSrc(URL.createObjectURL(file));
  };

  const closeCrop = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const onCropped = async (blob: Blob) => {
    setImgBusy(true);
    try {
      const url = await uploadAssetImage(await compressImage(blob));
      const prev = imageUrl;
      onImageChange(url);
      if (prev) void deleteAssetImage(prev); // clean up the replaced photo
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not upload the photo", "error");
    } finally {
      setImgBusy(false);
    }
  };

  const removeImage = () => {
    const prev = imageUrl;
    onImageChange(null);
    if (prev) void deleteAssetImage(prev);
  };

  const pickDocs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setDocBusy(true);
    try {
      // Sequential rather than parallel: a phone on a slow connection uploading
      // four scans at once is how you get four timeouts instead of four files.
      const added: AssetDocument[] = [];
      for (const file of files) {
        if (file.size > MAX_DOC_BYTES) {
          toast(`${file.name} is over 15 MB`, "error");
          continue;
        }
        added.push(await uploadAssetDoc(file));
      }
      if (added.length) onDocumentsChange([...documents, ...added]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not upload that file", "error");
    } finally {
      setDocBusy(false);
    }
  };

  const openDoc = async (doc: AssetDocument) => {
    setOpening(doc.url);
    try {
      window.open(await signedDocUrl(doc.url), "_blank", "noopener");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not open that file", "error");
    } finally {
      setOpening(null);
    }
  };

  const removeDoc = (doc: AssetDocument) => {
    onDocumentsChange(documents.filter((d) => d.url !== doc.url));
    void deleteAssetDoc(doc.url);
  };

  return (
    <>
      <div>
        <span className={labelCls}>Photo (optional)</span>
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-line bg-cream">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus size={20} className="text-[#c0a880]" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={imgBusy}
              onClick={() => imageRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-bold text-ink disabled:opacity-60"
            >
              {imgBusy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ImagePlus size={13} />
              )}
              {imageUrl ? "Replace" : "Add photo"}
            </button>
            {imageUrl && (
              <button
                type="button"
                disabled={imgBusy}
                onClick={removeImage}
                className="inline-flex items-center gap-1.5 rounded-[11px] border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700 disabled:opacity-60"
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          hidden
          onChange={pickImage}
        />
      </div>

      <div>
        <span className={labelCls}>Invoice, manual or warranty card (optional)</span>
        {documents.length > 0 && (
          <div className="mb-2 space-y-1">
            {documents.map((d) => (
              <div
                key={d.url}
                className="flex items-center gap-2 rounded-[11px] border border-line bg-warm-white px-2.5 py-2"
              >
                <FileText size={14} className="shrink-0 text-[#8a6a3c]" />
                <button
                  type="button"
                  onClick={() => void openDoc(d)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-ink underline"
                >
                  {d.name}
                </button>
                {opening === d.url && <Loader2 size={13} className="animate-spin" />}
                <button
                  type="button"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => removeDoc(d)}
                  className="shrink-0 text-ink-light hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={docBusy}
          onClick={() => docRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-warm-white px-2.5 py-2 text-xs font-bold text-ink disabled:opacity-60"
        >
          {docBusy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
          Attach file
        </button>
        <p className="mt-1 text-[11px] text-ink-muted">
          Kept private — a link is generated only when someone opens the file.
        </p>
        <input
          ref={docRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={pickDocs}
        />
      </div>

      {cropSrc && (
        <CropModal
          src={cropSrc}
          onCancel={closeCrop}
          onCropped={(b) => {
            closeCrop();
            void onCropped(b);
          }}
        />
      )}
    </>
  );
}
