/** A pulsing placeholder block. Size/shape it with className (h-*, w-*, rounded-*). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-line-soft ${className}`} />;
}
