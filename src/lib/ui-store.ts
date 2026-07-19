"use client";

import { create } from "zustand";
import type { Bill } from "./types";

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
}));

/** Convenience accessor for firing a toast outside of React render. */
export const toast = (message: string, variant?: ToastVariant) =>
  useUIStore.getState().toast(message, variant);
