/**
 * Branded splash shown while client-side auth resolves. Rendered during SSR
 * (before hydration) so it paints at first-contentful-paint instead of a blank
 * screen, and prevents a flash of the login form for already-signed-in users.
 */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[radial-gradient(circle_at_30%_12%,#fff7ec,#efdfc4)] p-6">
      <div className="flex flex-col items-center gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/android-chrome-512x512.png"
          alt="Bakers Theory"
          width={62}
          height={62}
          fetchPriority="high"
          className="h-[62px] w-[62px] rounded-[19px] object-cover shadow-[0_7px_20px_rgba(90,52,20,0.32)]"
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="wordmark text-[24px] leading-[1.1]">Bakers Theory</div>
          <div className="text-[11px] font-bold tracking-[0.08em] text-ink-light">
            STORE MANAGEMENT
          </div>
        </div>
        <div className="mt-1 h-8 w-8 animate-spin rounded-full border-[3px] border-line-soft border-t-brown" />
      </div>
    </div>
  );
}
