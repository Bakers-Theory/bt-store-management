"use client";

import { create } from "zustand";
import type { Bill } from "./types";
import type { PrintReport } from "./report";
import type { Payslip } from "./payslip";
import type { LabelKind } from "./asset-label";

/** Either printable A4 document. */
export type PrintDoc = PrintReport | Payslip;

/**
 * One asset's printable label (#91 §2.4). `copies` is how many pages to emit —
 * one label per page, since a scanner reads one at a time either way.
 *
 * `qrModules` arrives pre-encoded rather than as text: the QR encoder is a
 * dynamic import, and LabelPrintHost is mounted in the root layout on every page,
 * so it must stay a plain renderer with no encoder in its bundle.
 */
export interface AssetLabelTarget {
  kind: LabelKind;
  code: string;
  name: string;
  category: string;
  location: string;
  copies: number;
  /** The QR module matrix; null when the label carries no QR. */
  qrModules: boolean[][] | null;
}

interface OwnerAuthRequest {
  label: string;
  onConfirm: () => void;
}

export type ToastVariant = "info" | "success" | "error";

interface UIState {
  // Toasts
  toastMessage: string | null;
  toastVariant: ToastVariant;
  toastNonce: number;
  toast: (message: string, variant?: ToastVariant) => void;
  clearToast: () => void;

  // Owner-password gate
  ownerAuth: OwnerAuthRequest | null;
  requireOwnerAuth: (label: string, onConfirm: () => void) => void;
  closeOwnerAuth: () => void;

  // Thermal-receipt printing
  printTarget: Bill | null;
  requestPrint: (bill: Bill) => void;
  clearPrint: () => void;
  /** A built report or payslip awaiting the print dialog (ReportPrintHost). */
  reportTarget: (PrintDoc & { generatedAt: string }) | null;
  requestReport: (report: PrintDoc) => void;
  clearReport: () => void;
  /** An asset label awaiting the print dialog (LabelPrintHost). */
  labelTarget: AssetLabelTarget | null;
  requestLabel: (label: AssetLabelTarget) => void;
  clearLabel: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  toastMessage: null,
  toastVariant: "info",
  toastNonce: 0,
  toast: (message, variant = "info") =>
    set((s) => ({ toastMessage: message, toastVariant: variant, toastNonce: s.toastNonce + 1 })),
  clearToast: () => set({ toastMessage: null }),

  ownerAuth: null,
  requireOwnerAuth: (label, onConfirm) => set({ ownerAuth: { label, onConfirm } }),
  closeOwnerAuth: () => set({ ownerAuth: null }),

  printTarget: null,
  requestPrint: (bill) => set({ printTarget: bill }),
  clearPrint: () => set({ printTarget: null }),
  reportTarget: null,
  // Stamp the timestamp here rather than in render: a Date during render would
  // differ between server and client and trip hydration.
  requestReport: (report) =>
    set({
      reportTarget: {
        ...report,
        generatedAt: new Date().toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      },
    }),
  clearReport: () => set({ reportTarget: null }),

  labelTarget: null,
  requestLabel: (label) => set({ labelTarget: label }),
  clearLabel: () => set({ labelTarget: null }),
}));

/** Convenience accessor for firing a toast outside of React render. */
export const toast = (message: string, variant?: ToastVariant) =>
  useUIStore.getState().toast(message, variant);
