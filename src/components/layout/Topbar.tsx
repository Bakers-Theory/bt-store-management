"use client";

import { useRouter } from "next/navigation";
import { useBakeryStore } from "@/lib/store";

export function Topbar() {
  const router = useRouter();
  const bakery = useBakeryStore((s) => s.bakery);
  const logout = useBakeryStore((s) => s.logout);

  const doLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <div className="sticky top-0 z-[100] flex items-center gap-2.5 bg-brown px-4 py-3 text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[18px]">
        {bakery.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bakery.logo} alt="logo" className="h-full w-full object-cover" />
        ) : (
          "🧁"
        )}
      </div>
      <div className="flex-1 text-base font-bold">{bakery.name}</div>
      <button
        className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border-none bg-white/15 text-[18px] text-white"
        onClick={() => router.push("/settings")}
        aria-label="Settings"
      >
        ⚙
      </button>
      <button
        className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border-none bg-white/15 text-[15px] text-white"
        onClick={doLogout}
        title="Logout"
        aria-label="Logout"
      >
        🚪
      </button>
    </div>
  );
}
