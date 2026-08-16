import { useCallback, useEffect, useState } from "react";

/**
 * Simple windowed virtualization for tables with a fixed row height.
 * Renders only the visible slice plus overscan, preserving a spacer
 * that keeps the scrollbar proportional to the full dataset.
 */
export function useVirtualRows({
  count,
  rowHeight,
  overscan = 8,
  containerRef,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
  containerRef: React.RefObject<HTMLElement>;
}) {
  const [range, setRange] = useState({ start: 0, end: 40 });

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewport = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(
      count,
      Math.ceil((scrollTop + viewport) / rowHeight) + overscan,
    );
    setRange({ start, end });
  }, [containerRef, rowHeight, overscan, count]);

  useEffect(() => {
    onScroll();
  }, [onScroll, count]);

  return { ...range, onScroll };
}
