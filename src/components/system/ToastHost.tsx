"use client";

import { useEffect, useState } from "react";
import { useUIStore } from "@/lib/ui-store";

export function ToastHost() {
  const message = useUIStore((s) => s.toastMessage);
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
  return (
    <div className="toast" style={{ opacity: visible ? 1 : 0 }}>
      {message}
    </div>
  );
}
