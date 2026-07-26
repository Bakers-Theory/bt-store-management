"use client";

import { create } from "zustand";
import type { Bill } from "./types";
import type { PrintReport } from "./report";
import type { Payslip } from "./payslip";

/** Either printable A4 document. */
export type PrintDoc = PrintReport | Payslip;

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
}));

/** Convenience accessor for firing a toast outside of React render. */
export const toast = (message: string, variant?: ToastVariant) =>
  useUIStore.getState().toast(message, variant);
