"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-t-[20px] border border-line bg-warm-white p-5 shadow-card sm:rounded-[20px]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-extrabold text-ink">{title}</h2>
          <button
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-cream text-ink-muted"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
