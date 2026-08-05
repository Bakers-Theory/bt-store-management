"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/lib/ui-store";
import { canEncode, encodeCode39 } from "@/lib/barcode";
import {
  LABEL_KINDS,
  QR_COMFORTABLE_BYTES,
  assetQrPayload,
  labelHasBarcode,
  labelHasQr,
  labelKindLabel,
  payloadBytes,
  type LabelKind,
} from "@/lib/asset-label";
import { qrMatrix, type QrMatrix } from "@/lib/qr";
import { barcodePayload } from "@/lib/asset";
import type { Asset } from "@/lib/types";

const BAR_HEIGHT = 40;

/**
 * Pick what goes on the label, see it, print it.
 *
 * The QR is encoded HERE rather than in the print host: the encoder is a dynamic
 * import, and the host is mounted in the root layout on every page. Encoding at
 * this point also means the preview is the artefact — the same matrix that gets
 * printed is the one on screen, so there is no way for them to disagree.
 */
export function AssetLabelModal({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const toast = useUIStore((s) => s.toast);
  const requestLabel = useUIStore((s) => s.requestLabel);

  const [kind, setKind] = useState<LabelKind>("both");
  const [copies, setCopies] = useState(1);
  const [modules, setModules] = useState<QrMatrix | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  // `window` is only readable on the client, and the origin is what makes the
  // link in the payload absolute — a relative one is useless to a camera.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const payload = assetQrPayload(asset, origin);
  const bytes = payloadBytes(payload);

  useEffect(() => {
    let alive = true;
    // Both branches set state asynchronously; nothing is set in the effect body,
    // which would cascade a render.
    qrMatrix(payload)
      .then((m) => {
        if (!alive) return;
        setModules(m);
        setQrFailed(false);
      })
      .catch(() => {
        if (!alive) return;
        setModules(null);
        setQrFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [payload]);

  const code = barcodePayload(asset.code);
  const barcodeOk = canEncode(code);
  const bars = barcodeOk ? encodeCode39(code) : null;

  // Bars carry their own x offset, accumulated rather than mutated in render.
  const placed = bars
    ? bars.elements.reduce<{ x: number; bars: { x: number; units: number }[] }>(
        (acc, el) => ({
          x: acc.x + el.units,
          bars: el.bar ? [...acc.bars, { x: acc.x, units: el.units }] : acc.bars,
        }),
        { x: 0, bars: [] },
      ).bars
    : [];

  const wantsQr = labelHasQr(kind);
  const wantsBarcode = labelHasBarcode(kind);
  const qrReady = !wantsQr || modules !== null;
  const blocked =
    (wantsBarcode && !barcodeOk) || (wantsQr && qrFailed) ? true : false;

  const print = () => {
    if (blocked || !qrReady) return;
    requestLabel({
      kind,
      code,
      name: asset.name,
      category: asset.category,
      location: asset.location,
      copies,
      qrModules: wantsQr ? modules : null,
    });
    onClose();
  };

  return (
    <Modal title={`Label — ${asset.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]" htmlFor="lb-kind">
            What to print
          </label>
          <select
            id="lb-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as LabelKind)}
            className="!py-2 !text-[13px] font-semibold"
          >
            {LABEL_KINDS.map((k) => (
              <option key={k} value={k}>
                {labelKindLabel(k)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">
            The barcode carries the asset code for a handheld scanner. The QR opens
            this asset&apos;s page, and holds its details for a phone with no signal.
          </p>
        </div>

        {/* The preview is the artefact: this is the same matrix that prints. */}
        <div className="rounded-[14px] border border-line bg-white p-3">
          <div className="mx-auto flex max-w-[320px] items-center gap-3">
            {wantsQr &&
              (modules ? (
                <svg
                  viewBox={`0 0 ${modules.length} ${modules.length}`}
                  shapeRendering="crispEdges"
                  className="h-[96px] w-[96px] shrink-0"
                  role="img"
                  aria-label={`QR code for ${asset.code}`}
                >
                  {modules.flatMap((row, r) =>
                    row.map((dark, c) =>
                      dark ? (
                        <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" />
                      ) : null,
                    ),
                  )}
                </svg>
              ) : (
                <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center">
                  {qrFailed ? (
                    <span className="text-[11px] text-red-700">QR failed</span>
                  ) : (
                    <Loader2 size={16} className="animate-spin text-[#c0a880]" />
                  )}
                </div>
              ))}

            <div className="min-w-0 flex-1 text-center">
              {wantsBarcode && bars && (
                <svg
                  viewBox={`0 0 ${bars.units} ${BAR_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="block h-[38px] w-full"
                  role="img"
                  aria-label={`Barcode for ${asset.code}`}
                >
                  {placed.map((b) => (
                    <rect key={b.x} x={b.x} y={0} width={b.units} height={BAR_HEIGHT} fill="#000" />
                  ))}
                </svg>
              )}
              <p className="mt-1 font-mono text-[13px] font-bold tracking-[0.1em] text-black">
                {asset.code}
              </p>
              <p className="truncate text-[12px] font-bold text-black">{asset.name}</p>
              <p className="truncate text-[10px] text-[#333]">
                {asset.category}
                {asset.location ? ` · ${asset.location}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-[#8a6a3c]" htmlFor="lb-copies">
            Copies
          </label>
          <input
            id="lb-copies"
            type="number"
            min="1"
            max="20"
            value={copies}
            onChange={(e) =>
              setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
            }
            className="!py-2 !text-[13px] font-semibold"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            One label per page, on 62 × 29mm stock.
          </p>
        </div>

        {wantsQr && bytes > QR_COMFORTABLE_BYTES && (
          <p className="flex gap-1.5 rounded-[10px] bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              This asset&apos;s details come to {bytes} bytes, which makes a dense QR
              — check it scans before printing a batch, or print the barcode only.
              Nothing is shortened.
            </span>
          </p>
        )}

        {wantsBarcode && !barcodeOk && (
          <p className="text-[11px] font-semibold text-red-700">
            {asset.code} has characters a Code 39 barcode cannot carry — print the QR
            only.
          </p>
        )}

        <button
          disabled={blocked || !qrReady}
          onClick={print}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-brown py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {qrReady ? <Printer size={15} /> : <Loader2 size={15} className="animate-spin" />}
          Print {copies > 1 ? `${copies} labels` : "label"}
        </button>
      </div>
    </Modal>
  );
}
