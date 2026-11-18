import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FloatingWindow, type Geom } from "./FloatingWindow";
import { useIdentity, useOwlbearTheme } from "./identity";
// Loaded on demand so that if the PDF engine fails to load here, it shows up as an error in the
// window instead of taking down the whole host page.
const Viewer = lazy(() => import("./Viewer").then((m) => ({ default: m.Viewer })));
import { closeHost, getHostMode, listenForOpen } from "./windows";
import { inObr } from "./identity";

interface Win {
  sheetId: string;
  title: string;
  geom: Geom;
  z: number;
  maximized: boolean;
}

const geomKey = (sheetId: string) => `hs-geom:${sheetId}`;

/** The iframe can report a 0×0 size for an instant while Owlbear is laying the modal out. */
function viewport() {
  return {
    vw: window.innerWidth > 200 ? window.innerWidth : 1280,
    vh: window.innerHeight > 200 ? window.innerHeight : 800,
  };
}

const sane = (g: Geom, vw: number, vh: number) =>
  [g.x, g.y, g.w, g.h].every(Number.isFinite) &&
  g.w >= 320 &&
  g.h >= 240 &&
  g.x + g.w > 80 &&
  g.x < vw - 80 &&
  g.y >= 0 &&
  g.y < vh - 32;

function readGeom(sheetId: string, index: number): Geom {
  const { vw, vh } = viewport();
  try {
    const raw = localStorage.getItem(geomKey(sheetId));
    if (raw) {
      const stored = JSON.parse(raw) as Geom;
      if (sane(stored, vw, vh)) return stored;
    }
  } catch {
    /* fall through to default */
  }
  const w = Math.max(320, Math.min(780, vw - 40));
  const h = Math.max(240, Math.min(940, vh - 40));
  const offset = (index % 8) * 28;
  return { x: 20 + offset, y: 20 + offset, w, h };
}

/** Shows what went wrong instead of silently rendering nothing. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Hero Stable window crashed", error);
  }
  render() {
    return this.state.error ? (
      <div className="banner error" style={{ pointerEvents: "auto" }}>
        Hero Stable hit an error: {this.state.error.message}
      </div>
    ) : (
      this.props.children
    );
  }
}

/** Full-screen transparent page that hosts the floating sheet windows. */
export function Host() {
  const identity = useIdentity();
  useOwlbearTheme();

  // The app is running: drop the pre-boot "loading…" notice from host.html.
  useEffect(() => {
    document.getElementById("boot")?.remove();
  }, []);

  const [wins, setWins] = useState<Win[]>([]);
  const zRef = useRef(10);
  const flushers = useRef(new Map<string, { current: (() => Promise<boolean>) | null }>());

  const flusherFor = (sheetId: string) => {
    let ref = flushers.current.get(sheetId);
    if (!ref) {
      ref = { current: null };
      flushers.current.set(sheetId, ref);
    }
    return ref;
  };

  const open = useCallback((sheetId: string) => {
    setWins((prev) => {
      const z = ++zRef.current;
      if (prev.some((w) => w.sheetId === sheetId)) {
        return prev.map((w) => (w.sheetId === sheetId ? { ...w, z } : w));
      }
      return [...prev, { sheetId, title: "Loading…", geom: readGeom(sheetId, prev.length), z, maximized: false }];
    });
  }, []);

  useEffect(() => {
    const initial = new URLSearchParams(location.search).get("open");
    if (initial) open(initial);
    return listenForOpen(open);
  }, [open]);

  const update = (sheetId: string, patch: Partial<Win>) =>
    setWins((prev) => prev.map((w) => (w.sheetId === sheetId ? { ...w, ...patch } : w)));

  async function close(sheetId: string) {
    const ok = (await flusherFor(sheetId).current?.()) ?? true;
    if (!ok) return; // unsaved changes couldn't be saved; keep the window so nothing is lost
    flushers.current.delete(sheetId);
    setWins((prev) => {
      const next = prev.filter((w) => w.sheetId !== sheetId);
      if (next.length === 0) closeHost();
      return next;
    });
  }

  // Visible while waiting on Owlbear, so a stalled connection doesn't look like a blank screen.
  if (!identity) return <div className="host-status">Hero Stable: connecting to Owlbear…</div>;

  return (
    <div className={`host-root ${getHostMode() === "floating" || !inObr ? "click-through" : ""}`}>
      {wins.map((w) => (
        <FloatingWindow
          key={w.sheetId}
          title={w.title}
          geom={w.geom}
          z={w.z}
          maximized={w.maximized}
          onGeom={(geom) => {
            update(w.sheetId, { geom });
            try {
              localStorage.setItem(geomKey(w.sheetId), JSON.stringify(geom));
            } catch {
              /* not persisted */
            }
          }}
          onFocus={() => update(w.sheetId, { z: ++zRef.current })}
          onClose={() => close(w.sheetId)}
          onToggleMaximize={() => update(w.sheetId, { maximized: !w.maximized })}
        >
          <Boundary>
            <Suspense fallback={<div className="muted pad">Loading the PDF viewer…</div>}>
              <Viewer
                sheetId={w.sheetId}
                identity={identity}
                onTitle={(title) => update(w.sheetId, { title })}
                flushRef={flusherFor(w.sheetId)}
              />
            </Suspense>
          </Boundary>
        </FloatingWindow>
      ))}
    </div>
  );
}
