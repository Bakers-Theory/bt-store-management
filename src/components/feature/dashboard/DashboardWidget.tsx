"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";

// Literal class strings, not runtime-interpolated — Tailwind's build-time
// scanner only finds classes it can see verbatim in source.
const MOBILE_SPAN_CLASS: Record<1 | 2, string> = {
  1: "col-span-1",
  2: "col-span-2",
};
const DESKTOP_SPAN_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};

export function DashboardWidget({
  id,
  span,
  mobileSpan,
  editing,
  onRemove,
  onResizeStart,
  children,
}: {
  id: string;
  span: 1 | 2 | 3 | 4;
  mobileSpan: 1 | 2;
  editing: boolean;
  onRemove: (id: string) => void;
  onResizeStart: (id: string, e: React.PointerEvent) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${MOBILE_SPAN_CLASS[mobileSpan]} ${DESKTOP_SPAN_CLASS[span]} ${
        isDragging ? "z-10 opacity-70" : ""
      }`}
    >
      {editing && (
        <div className="absolute -top-2.5 left-2 right-2 z-20 flex items-center justify-between">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-line bg-warm-white text-ink-muted shadow-card active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical size={13} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(id)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-warm-white text-danger shadow-card"
            aria-label="Remove widget"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {children}

      {editing && (
        <div
          onPointerDown={(e) => onResizeStart(id, e)}
          className="absolute bottom-1 right-1 hidden h-4 w-4 cursor-ew-resize items-center justify-center rounded border border-line bg-warm-white lg:flex"
          role="slider"
          aria-label="Drag to resize width"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={span}
        >
          <div className="h-2 w-px bg-ink-muted" />
        </div>
      )}
    </div>
  );
}