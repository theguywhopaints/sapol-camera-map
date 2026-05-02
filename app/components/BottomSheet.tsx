'use client';

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type SnapState = 'peek' | 'half' | 'full';

interface Props {
  snapState: SnapState;
  onSnapChange: (s: SnapState) => void;
  children: ReactNode;
}

const PEEK_H = 96;
const HALF_RATIO = 0.46;
const FULL_RATIO = 0.88;

function snapHeights() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return {
    peek: PEEK_H,
    half: Math.round(vh * HALF_RATIO),
    full: Math.round(vh * FULL_RATIO),
  } as Record<SnapState, number>;
}

function nearestSnap(h: number): SnapState {
  const snaps = snapHeights();
  let best: SnapState = 'peek';
  let bestDist = Infinity;
  for (const [k, v] of Object.entries(snaps) as [SnapState, number][]) {
    const d = Math.abs(v - h);
    if (d < bestDist) { bestDist = d; best = k; }
  }
  return best;
}

export function BottomSheet({ snapState, onSnapChange, children }: Props) {
  const [height, setHeight] = useState<number>(PEEK_H);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const handleRef = useRef<HTMLDivElement>(null);

  // Sync external snap state → height
  useEffect(() => {
    setHeight(snapHeights()[snapState]);
  }, [snapState]);

  // Recalculate on resize (keyboard pop-up, orientation change)
  useEffect(() => {
    const vv = window.visualViewport;
    const handler = () => {
      setHeight(snapHeights()[snapState]);
    };
    vv?.addEventListener('resize', handler);
    return () => vv?.removeEventListener('resize', handler);
  }, [snapState]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    startY.current = e.clientY;
    startH.current = height;
  }, [height]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dy = startY.current - e.clientY;
    const snaps = snapHeights();
    const next = Math.max(PEEK_H, Math.min(snaps.full, startH.current + dy));
    setHeight(next);
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    onSnapChange(nearestSnap(height));
  }, [dragging, height, onSnapChange]);

  return (
    <div
      className={`fixed bottom-0 inset-x-0 bg-slate-900 rounded-t-3xl z-40 flex flex-col overflow-hidden border-t border-slate-700/40 shadow-[0_-8px_40px_rgba(0,0,0,0.7)] ${dragging ? '' : 'sheet-spring'}`}
      style={{
        height,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Drag handle */}
      <div
        ref={handleRef}
        className="flex justify-center items-center py-3 shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="w-9 h-1 rounded-full bg-slate-600" />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar">
        {children}
      </div>
    </div>
  );
}
