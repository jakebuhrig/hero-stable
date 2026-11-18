import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingWindow, type Geom } from "./FloatingWindow";
import { useIdentity, useOwlbearTheme } from "./identity";
import { Viewer } from "./Viewer";
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

function readGeom(sheetId: string, index: number): Geom {
  try {
    const raw = localStorage.getItem(geomKey(sheetId));
    if (raw) return JSON.parse(raw) as Geom;
  } catch {
    /* fall through to default */
  }
  const w = Math.min(780, window.innerWidth - 40);
  const h = Math.min(940, window.innerHeight - 40);
  const offset = (index % 8) * 28;
  return { x: 20 + offset, y: 20 + offset, w, h };
}

/** Full-screen transparent page that hosts the floating sheet windows. */
export function Host() {
  const identity = useIdentity();
  useOwlbearTheme();

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

  if (!identity) return null;

  return (
    <div className={`host-root ${getHostMode() === "overlay" || !inObr ? "click-through" : ""}`}>
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
          <Viewer
            sheetId={w.sheetId}
            identity={identity}
            onTitle={(title) => update(w.sheetId, { title })}
            flushRef={flusherFor(w.sheetId)}
          />
        </FloatingWindow>
      ))}
    </div>
  );
}
