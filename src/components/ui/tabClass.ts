/** Tailwind classes for a segmented-control tab button, per active state. */
export function tabCls(active: boolean): string {
  return `shrink-0 cursor-pointer whitespace-nowrap rounded-[9px] border-none px-3 py-2 text-[13px] font-bold transition-all sm:px-[18px] sm:text-[13.5px] ${
    active
      ? "bg-warm-white text-brown shadow-[0_1px_4px_rgba(100,60,20,.12)]"
      : "text-[#8a6a3c]"
  }`;
}
