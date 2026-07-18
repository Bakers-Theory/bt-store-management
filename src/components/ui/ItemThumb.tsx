"use client";

import { useState } from "react";

/**
 * Single source of truth for the product-icon precedence: image → emoji → 📦.
 * `size` is the square edge in px; the emoji is scaled to ~55% of it.
 */
export function ItemThumb({
  src,
  emoji,
  size,
  className = "",
}: {
  src?: string | null;
  emoji?: string | null;
  size: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;

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
