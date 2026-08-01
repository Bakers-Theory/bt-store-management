"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { clampHeightLevelIndex, snapSpan } from "@/lib/dashboard-layout";
import type { DashboardWidgetSlot } from "@/lib/types";
import { DashboardWidget } from "./DashboardWidget";

// Vertical drag distance (px) per height-level step — unlike width (measured
// in grid columns), "how much to show" has no natural unit to divide the
// pointer delta by, so this is just a comfortable drag distance per step.
const PX_PER_HEIGHT_LEVEL = 50;

export function DashboardGrid({
  slots,
  editing,
  minSpanFor,
  mobileSpanFor,
  heightLevelCountFor,
  renderWidget,
  onReorder,
  onRemove,
  onResize,
  onResizeHeight,
}: {
  slots: DashboardWidgetSlot[];
  editing: boolean;
  minSpanFor: (id: string) => number;
  mobileSpanFor: (id: string) => 1 | 2;
  /** Number of height levels a widget supports; undefined = no height control. */
  heightLevelCountFor: (id: string) => number | undefined;
  renderWidget: (id: string) => ReactNode;
  onReorder: (activeId: string, overId: string) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, span: number) => void;
  onResizeHeight: (id: string, levelIndex: number) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startSpan: number } | null>(null);
  const [resizingHeight, setResizingHeight] = useState<{
    id: string;
    startY: number;
    startLevel: number;
  } | null>(null);
  // A small drag threshold so a plain click on the handle (or a light tap on
  // mobile while reordering) doesn't get misread as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  const handleResizeStart = (id: string, e: PointerEvent) => {
    e.preventDefault();
    const current = slots.find((s) => s.id === id);
    if (!current) return;
    setResizing({ id, startX: e.clientX, startSpan: current.span });
  };

  const handleResizeHeightStart = (id: string, e: PointerEvent) => {
    e.preventDefault();
    const current = slots.find((s) => s.id === id);
    if (!current?.heightLevel) return;
    setResizingHeight({ id, startY: e.clientY, startLevel: current.heightLevel });
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (resizing && gridRef.current) {
      const colWidth = gridRef.current.clientWidth / 4;
      const deltaCols = Math.round((e.clientX - resizing.startX) / colWidth);
      onResize(resizing.id, snapSpan(resizing.startSpan + deltaCols, minSpanFor(resizing.id)));
    }
    if (resizingHeight) {
      const levelCount = heightLevelCountFor(resizingHeight.id) ?? 1;
      const deltaLevels = Math.round((e.clientY - resizingHeight.startY) / PX_PER_HEIGHT_LEVEL);
      onResizeHeight(
        resizingHeight.id,
        clampHeightLevelIndex(resizingHeight.startLevel + deltaLevels, levelCount),
      );
    }
  };

  const endResize = () => {
    setResizing(null);
    setResizingHeight(null);
  };

  return (
    <div
      ref={gridRef}
      onPointerMove={handlePointerMove}
      onPointerUp={endResize}
      onPointerLeave={endResize}
      className="grid grid-cols-2 items-start gap-4 lg:grid-cols-4"
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={slots.map((s) => s.id)} strategy={rectSortingStrategy}>
          {slots.map((slot) => (
            <DashboardWidget
              key={slot.id}
              id={slot.id}
              span={slot.span as 1 | 2 | 3 | 4}
              mobileSpan={mobileSpanFor(slot.id)}
              editing={editing}
              onRemove={onRemove}
              onResizeStart={handleResizeStart}
              heightLevel={slot.heightLevel}
              heightLevelCount={heightLevelCountFor(slot.id)}
              onResizeHeightStart={handleResizeHeightStart}
            >
              {renderWidget(slot.id)}
            </DashboardWidget>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}