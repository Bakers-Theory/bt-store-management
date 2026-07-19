"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useUIStore } from "@/lib/ui-store";

const VARIANT = {
  info: { bg: "var(--color-ink)", Icon: Info },
  success: { bg: "var(--color-success)", Icon: CheckCircle2 },
  error: { bg: "var(--color-danger)", Icon: AlertCircle },
} as const;

export function ToastHost() {
  const message = useUIStore((s) => s.toastMessage);
  const variant = useUIStore((s) => s.toastVariant);
  const nonce = useUIStore((s) => s.toastNonce);
  const clearToast = useUIStore((s) => s.clearToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const hide = setTimeout(() => setVisible(false), 2000);
    const clear = setTimeout(() => clearToast(), 2300);
    return () => {
      clearTimeout(hide);
      clearTimeout(clear);
    };
  }, [nonce, message, clearToast]);

  if (!message) return null;
  const { bg, Icon } = VARIANT[variant];
  return (
    <div
      className="toast"
      // Errors interrupt (assertive); success/info wait their turn (polite).
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      style={{ opacity: visible ? 1 : 0, background: bg }}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
