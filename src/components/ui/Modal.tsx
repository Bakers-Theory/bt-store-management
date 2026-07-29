"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Held in a ref so the effect below can depend on NOTHING and therefore run
  // exactly once per mount. Callers routinely pass an inline arrow for onClose,
  // whose identity changes on every parent render; with `[onClose]` as a
  // dependency the effect tore down and re-ran on each of those renders, and its
  // cleanup calls prevActive.focus() — which yanked focus out of whatever field
  // was being typed in. That only bit modals whose form state lives in the
  // PARENT, which is why it went unnoticed for so long.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape-to-close, background scroll-lock, and a focus trap that keeps Tab
  // cycling inside the dialog. Mount and unmount only.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevActive = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Initial focus belongs on the dialog's first FIELD, not on its own Close
    // button — which sits before `children` in document order and would
    // otherwise always win, leaving every form modal opening with the cursor
    // nowhere useful. The Tab trap below still cycles through Close normally.
    const focusables = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusables.find((el) => !el.hasAttribute("data-modal-close"));
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-t-[20px] border border-line bg-warm-white p-5 shadow-card outline-none sm:rounded-[20px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-extrabold text-ink">
            {title}
          </h2>
          <button
            // Marks this out of the running for INITIAL focus only; it stays in
            // the Tab cycle like any other control.
            data-modal-close
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-cream text-ink-muted"
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
