import * as pdfjs from "pdfjs-dist";
import { AnnotationMode } from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { canEdit } from "../api/_lib/perms";
import type { Sheet } from "../api/_lib/types";
import { ApiError, fetchPdfBytes, sheetsApi, uploadPdf } from "./api";
import type { Identity } from "./identity";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * PDF.js tints every fillable field blue. Flag fields that have a value so the tint can be
 * dropped for those (see `[data-filled]` in styles.css) and only empty fields stay highlighted.
 */
function syncFilled(root: HTMLElement) {
  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      ".annotationLayer :is(input, textarea, select)",
    )
    .forEach((el) => {
      const isToggle = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      const filled = isToggle ? el.checked : el.value !== "";
      el.toggleAttribute("data-filled", filled);
      el.closest("section")?.toggleAttribute("data-filled", filled);
    });
}

const AUTOSAVE_MS = 3000;
const POLL_MS = 8000;

type Status = "loading" | "ready" | "saving" | "saved" | "error";

interface Props {
  sheetId: string;
  identity: Identity;
  onTitle: (title: string) => void;
  /** Lets the host save pending edits before closing. Resolves false if the save failed. */
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
}

export function Viewer({ sheetId, identity, onTitle, flushRef }: Props) {
  const api = useRef(sheetsApi(identity)).current;

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editTick, setEditTick] = useState(0);
  const [newer, setNewer] = useState<Sheet | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const pdfTaskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const fitRef = useRef(true);

  // Latest values for use inside async callbacks and timers.
  const sheetRef = useRef<Sheet | null>(null);
  const loadedVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const editCountRef = useRef(0);
  const savingRef = useRef(false);

  const editable = sheet ? canEdit(sheet, identity) : false;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // The host passes a fresh onTitle on every render; keep `adopt` stable so effects don't re-run.
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const adopt = useCallback((s: Sheet) => {
    sheetRef.current = s;
    setSheet(s);
    onTitleRef.current(`${s.name} · ${s.ownerName}`);
  }, []);

  const markDirty = useCallback(() => {
    editCountRef.current++;
    dirtyRef.current = true;
    setDirty(true);
    setEditTick((t) => t + 1);
  }, []);

  // Initial fetch of the sheet record.
  useEffect(() => {
    let live = true;
    api
      .get(sheetId)
      .then((s) => {
        if (!live) return;
        loadedVersionRef.current = s.version;
        adopt(s);
        setLoadKey((k) => k + 1);
      })
      .catch((e) => {
        if (!live) return;
        setError((e as Error).message);
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [api, sheetId, adopt]);

  // (Re)load the PDF whenever loadKey changes or edit permission flips.
  useEffect(() => {
    const s = sheetRef.current;
    const scroller = scrollerRef.current;
    const viewerEl = viewerElRef.current;
    if (!s || !scroller || !viewerEl) return;

    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        const data = await fetchPdfBytes(s.fileUrl);
        const task = pdfjs.getDocument({
          data,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          iccUrl: "/pdfjs/iccs/",
          wasmUrl: "/pdfjs/wasm/",
        });
        const doc = await task.promise;
        if (cancelled) {
          task.destroy();
          return;
        }

        const eventBus = new EventBus();
        const linkService = new PDFLinkService({ eventBus });
        const viewer = new PDFViewer({
          container: scroller,
          viewer: viewerEl,
          eventBus,
          linkService,
          annotationMode: editableRef.current ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE,
        });
        linkService.setViewer(viewer);
        eventBus.on("annotationlayerrendered", () => syncFilled(scroller));
        eventBus.on("pagesinit", () => {
          viewer.currentScaleValue = "page-width";
          fitRef.current = true;
        });

        // Tear down whatever was showing before.
        pdfViewerRef.current?.cleanup();
        pdfTaskRef.current?.destroy();
        pdfViewerRef.current = viewer;
        pdfTaskRef.current = task;
        pdfDocRef.current = doc;

        // The shipped typings declare this hook as `null`; it is a callback in practice.
        (doc.annotationStorage as unknown as { onSetModified: (() => void) | null }).onSetModified = markDirty;
        viewer.setDocument(doc);
        linkService.setDocument(doc);

        dirtyRef.current = false;
        editCountRef.current = 0;
        setDirty(false);
        setNewer(null);
        setError(null);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadKey, editable, markDirty]);

  // Re-check which fields are filled whenever the user edits one.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onEdit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncFilled(scroller));
    };
    scroller.addEventListener("input", onEdit);
    scroller.addEventListener("change", onEdit);
    return () => {
      scroller.removeEventListener("input", onEdit);
      scroller.removeEventListener("change", onEdit);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the page fitted to the window width until the user zooms manually.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const v = pdfViewerRef.current;
        if (v && fitRef.current && pdfDocRef.current) v.currentScaleValue = "page-width";
      });
    });
    ro.observe(scroller);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      const doc = pdfDocRef.current;
      const s = sheetRef.current;
      if (!doc || !s || !editableRef.current || savingRef.current) return !dirtyRef.current;
      savingRef.current = true;
      setStatus("saving");
      const editsAtStart = editCountRef.current;
      try {
        const bytes = await doc.saveDocument();
        const fileUrl = await uploadPdf(identity, bytes, s.name);
        const next = await api.patch(s.id, {
          fileUrl,
          mode: "save",
          baseVersion: loadedVersionRef.current,
          force,
        });
        loadedVersionRef.current = next.version;
        adopt(next);
        if (editCountRef.current === editsAtStart) {
          dirtyRef.current = false;
          setDirty(false);
        } else {
          setEditTick((t) => t + 1); // more typing happened while saving
        }
        setNewer(null);
        setError(null);
        setStatus("saved");
        return editCountRef.current === editsAtStart;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body.sheet) {
          setNewer(e.body.sheet);
          setStatus("ready");
        } else {
          setError((e as Error).message);
          setStatus("error");
        }
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [api, identity, adopt],
  );

  flushRef.current = async () => (dirtyRef.current ? save() : true);

  // Autosave shortly after the last edit.
  useEffect(() => {
    if (editTick === 0 || !dirtyRef.current || !editable || newer) return;
    const t = setTimeout(() => save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [editTick, editable, newer, save]);

  // Pick up changes other people make (and permission or name changes).
  useEffect(() => {
    const t = setInterval(async () => {
      if (savingRef.current) return;
      try {
        const latest = await api.get(sheetId);
        const current = sheetRef.current;
        if (!current) return;
        if (latest.version === current.version) return;
        if (latest.version === loadedVersionRef.current) {
          adopt(latest);
          return;
        }
        if (dirtyRef.current) {
          setNewer(latest);
          adopt({ ...latest, fileUrl: current.fileUrl });
        } else {
          loadedVersionRef.current = latest.version;
          adopt(latest);
          setLoadKey((k) => k + 1);
        }
      } catch {
        /* transient; try again next tick */
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [api, sheetId, adopt]);

  function loadTheirs() {
    if (!newer) return;
    loadedVersionRef.current = newer.version;
    adopt(newer);
    setNewer(null);
    setLoadKey((k) => k + 1);
  }

  const zoom = (dir: 1 | -1) => {
    const v = pdfViewerRef.current;
    if (!v) return;
    fitRef.current = false;
    if (dir > 0) v.increaseScale();
    else v.decreaseScale();
  };
  const fit = () => {
    const v = pdfViewerRef.current;
    if (!v) return;
    fitRef.current = true;
    v.currentScaleValue = "page-width";
  };

  let statusText = "";
  if (status === "loading") statusText = "Loading…";
  else if (status === "saving") statusText = "Saving…";
  else if (!editable) statusText = "View only";
  else if (status === "error" && dirty) statusText = "Couldn't save";
  else if (dirty) statusText = "Saving soon…";
  else if (status === "saved") statusText = "All changes saved";

  return (
    <div className="viewer">
      <div className="vt">
        <button onClick={fit} title="Fit to width">Fit</button>
        <button onClick={() => zoom(-1)} title="Zoom out">−</button>
        <button onClick={() => zoom(1)} title="Zoom in">+</button>
        <span className="vt-status">{statusText}</span>
        {editable && dirty && status === "error" && (
          <button className="primary" onClick={() => save()}>
            Retry save
          </button>
        )}
      </div>
      {newer && (
        <div className="banner warn">
          <span>{newer.updatedBy} saved a newer version.</span>
          <button onClick={loadTheirs}>Load theirs</button>
          {editable && dirty && <button onClick={() => save(true)}>Overwrite with mine</button>}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="pdf-wrap">
        <div className="pdf-scroller" ref={scrollerRef}>
          <div className="pdfViewer" ref={viewerElRef} />
        </div>
      </div>
    </div>
  );
}
