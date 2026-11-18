import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 320;
const MIN_H = 240;
const GRAB = 80; // how much of the title bar must stay on screen

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type Dir = (typeof HANDLES)[number];

interface Props {
  title: string;
  geom: Geom;
  z: number;
  maximized: boolean;
  onGeom: (g: Geom) => void;
  onFocus: () => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  children: ReactNode;
}

/** A draggable, resizable window rendered inside the host page. */
export function FloatingWindow({
  title,
  geom,
  z,
  maximized,
  onGeom,
  onFocus,
  onClose,
  onToggleMaximize,
  children,
}: Props) {
  const drag = useRef<{ px: number; py: number; start: Geom } | null>(null);

  const clamp = (g: Geom): Geom => ({
    ...g,
    x: Math.min(Math.max(g.x, GRAB - g.w), window.innerWidth - GRAB),
    y: Math.min(Math.max(g.y, 0), window.innerHeight - 32),
  });

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (maximized || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, start: geom };
  }
  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    onGeom(clamp({ ...d.start, x: d.start.x + e.clientX - d.px, y: d.start.y + e.clientY - d.py }));
  }
  function endDrag() {
    drag.current = null;
  }

  function startResize(e: ReactPointerEvent<HTMLDivElement>, dir: Dir) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, start: geom };
    (e.currentTarget as HTMLDivElement).dataset.dir = dir;
  }
  function moveResize(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const dir = e.currentTarget.dataset.dir as Dir | undefined;
    if (!d || !dir) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    let { x, y, w, h } = d.start;
    if (dir.includes("e")) w = Math.max(MIN_W, d.start.w + dx);
    if (dir.includes("s")) h = Math.max(MIN_H, d.start.h + dy);
    if (dir.includes("w")) {
      w = Math.max(MIN_W, d.start.w - dx);
      x = d.start.x + d.start.w - w;
    }
    if (dir.includes("n")) {
      h = Math.max(MIN_H, d.start.h - dy);
      y = d.start.y + d.start.h - h;
    }
    onGeom({ x, y: Math.max(0, y), w, h });
  }

  const style = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: z }
    : { left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: z };

  return (
    <div className={`fw ${maximized ? "fw-max" : ""}`} style={style} onPointerDown={onFocus}>
      <div
        className="fw-title"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onToggleMaximize}
      >
        <span className="fw-title-text">{title}</span>
        <button className="fw-btn" title={maximized ? "Restore" : "Maximize"} onClick={onToggleMaximize}>
          {maximized ? "❐" : "▢"}
        </button>
        <button className="fw-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="fw-body">{children}</div>
      {!maximized &&
        HANDLES.map((dir) => (
          <div
            key={dir}
            className={`fw-handle fw-${dir}`}
            onPointerDown={(e) => startResize(e, dir)}
            onPointerMove={moveResize}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
    </div>
  );
}
