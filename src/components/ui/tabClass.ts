/** Tailwind classes for a segmented-control tab button, per active state. */
export function tabCls(active: boolean): string {
  return `flex-1 cursor-pointer rounded-[10px] border-none p-2 text-[13px] font-semibold transition-all ${
    active
      ? "bg-white text-brown shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
      : "bg-transparent text-ink-muted"
  }`;
}
