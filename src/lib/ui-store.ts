"use client";

import { create } from "zustand";
import type { Bill } from "./types";

interface OwnerAuthRequest {
  label: string;
  onConfirm: () => void;
}

interface UIState {
  // Toasts
  toastMessage: string | null;
  toastNonce: number;
  toast: (message: string) => void;
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
  toastNonce: 0,
  toast: (message) =>
    set((s) => ({ toastMessage: message, toastNonce: s.toastNonce + 1 })),
  clearToast: () => set({ toastMessage: null }),

  ownerAuth: null,
  requireOwnerAuth: (label, onConfirm) => set({ ownerAuth: { label, onConfirm } }),
  closeOwnerAuth: () => set({ ownerAuth: null }),

  printTarget: null,
  requestPrint: (bill) => set({ printTarget: bill }),
  clearPrint: () => set({ printTarget: null }),
}));

/** Convenience accessor for firing a toast outside of React render. */
export const toast = (message: string) => useUIStore.getState().toast(message);
