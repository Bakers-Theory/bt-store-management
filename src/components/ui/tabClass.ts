/** Tailwind classes for a segmented-control tab button, per active state. */
export function tabCls(active: boolean): string {
  return `cursor-pointer rounded-[9px] border-none px-[18px] py-2 text-[13.5px] font-bold transition-all ${
    active
      ? "bg-warm-white text-brown shadow-[0_1px_4px_rgba(100,60,20,.12)]"
      : "text-[#8a6a3c]"
  }`;
}
