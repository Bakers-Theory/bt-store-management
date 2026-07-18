"use client";

import { useState } from "react";

/**
 * Single source of truth for the product-icon precedence: image → emoji → 📦.
 *
 * Two modes:
 * - fixed: pass `size` (square edge in px); emoji scales to ~55% of it.
 * - fill:  pass `fill` and place inside a `relative` sized container; the image
 *          (or emoji) fills it. Used for the large image-forward Bill cards.
 */
export function ItemThumb({
  src,
  emoji,
  size = 32,
  fill = false,
  className = "",
}: {
  src?: string | null;
  emoji?: string | null;
  size?: number;
  fill?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;

  if (fill) {
    return showImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src ?? undefined}
        alt=""
        onError={() => setBroken(true)}
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
      />
    ) : (
      <span
        className={`absolute inset-0 flex items-center justify-center text-5xl ${className}`}
      >
        {emoji || "📦"}
      </span>
    );
  }

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src ?? undefined}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className={`flex-shrink-0 rounded-[10px] object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={`inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}
    >
      {emoji || "📦"}
    </span>
  );
}
