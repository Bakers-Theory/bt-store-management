import { Croissant } from "lucide-react";

/**
 * Placeholder shell shown while auth resolves and the Supabase-backed store
 * loads. Mirrors the real Sidebar/Topbar/dashboard layout so the chrome paints
 * immediately (early FCP) instead of a blank screen, then swaps to real content
 * once the store hydrates (LCP). The brand text (desktop sidebar) and logo image
 * (mobile topbar) guarantee a contentful paint on both breakpoints.
 */
export function AppSkeleton() {
  return (
    <div className="flex min-h-screen bg-cream">
      {/* Sidebar — matches Sidebar's w-[244px], desktop only */}
      <aside className="sticky top-0 hidden h-screen w-[244px] flex-shrink-0 flex-col gap-[5px] border-r border-line bg-warm-white p-4 lg:flex">
        <div className="flex items-center gap-[11px] px-2 pb-5 pt-1.5">
          <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-brown to-brown-dark text-warm-white shadow-[0_3px_10px_rgba(90,52,20,.3)]">
            <Croissant size={22} />
          </div>
          <div className="leading-[1.15]">
            <div className="wordmark text-xl text-ink">Bakers Theory</div>
            <div className="text-[11px] font-semibold tracking-[.03em] text-ink-light">
              STORE MANAGEMENT
            </div>
          </div>
        </div>
        <div className="px-3 pb-2 pt-1.5">
          <div className="h-2.5 w-12 animate-pulse rounded bg-cream-dark/70" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="my-0.5 h-[42px] w-full animate-pulse rounded-xl bg-cream-dark/60"
          />
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex flex-shrink-0 items-center gap-3.5 border-b border-line bg-warm-white/90 px-4 py-3.5 backdrop-blur lg:px-[22px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/android-chrome-512x512.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 flex-shrink-0 rounded-[10px] object-cover lg:hidden"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-4 w-40 animate-pulse rounded bg-cream-dark" />
            <div className="h-2.5 w-56 max-w-[70%] animate-pulse rounded bg-cream-dark/70" />
          </div>
          <div className="hidden h-10 w-28 animate-pulse rounded-[11px] bg-cream-dark lg:block" />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:px-8 lg:py-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[110px] animate-pulse rounded-2xl border border-line bg-warm-white"
                />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="h-[320px] animate-pulse rounded-2xl border border-line bg-warm-white lg:col-span-2" />
              <div className="h-[320px] animate-pulse rounded-2xl border border-line bg-warm-white" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
