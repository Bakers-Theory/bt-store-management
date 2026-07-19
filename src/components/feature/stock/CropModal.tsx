"use client";

import { useState } from "react";
import Cropper from "react-easy-crop";
import { Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { getCroppedBlob, type CropArea } from "@/lib/image";

/**
 * Square-crop step shown after a file is picked. Emits the cropped region as a
 * WebP blob (still full-crop resolution — the caller compresses it).
 */
export function CropModal({
  src,
  onCancel,
  onCropped,
}: {
  src: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!area) return;
    setBusy(true);
    try {
      onCropped(await getCroppedBlob(src, area));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not crop image", "error");
      setBusy(false);
    }
  };

  return (
    <Modal title="Crop image" onClose={onCancel}>
      <div className="relative mb-4 h-[300px] w-full overflow-hidden rounded-[14px] bg-black">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-bold text-[#8a6a3c]">Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="w-full accent-brown"
        />
      </div>

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-[11px] border border-line bg-cream py-2.5 text-sm font-bold text-ink disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy || !area}
          className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Use image
        </button>
      </div>
    </Modal>
  );
}
