import OBR from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canEdit, canManage } from "../api/_lib/perms";
import type { Editor, Sheet } from "../api/_lib/types";
import { fetchPdfBytes, sheetsApi, uploadPdf } from "./api";
import { inObr, useIdentity, useOwlbearTheme, type Identity } from "./identity";
import { Dropzone, hasFiles, isPdf } from "./Dropzone";
import { carryOver, listFieldNames, type CarryOverResult } from "./pdfFields";
import { notifyChanged, onChanged } from "./sync";
import { getHostMode, openSheet, setHostMode, type HostMode } from "./windows";

type Dialog =
  | { kind: "upload"; file?: File }
  | { kind: "rename"; sheet: Sheet }
  | { kind: "replace"; sheet: Sheet }
  | { kind: "permissions"; sheet: Sheet }
  | { kind: "delete"; sheet: Sheet }
  | { kind: "undo"; sheet: Sheet }
  | { kind: "settings" };

const REFRESH_MS = 60000;
const MIN_REFRESH_GAP_MS = 5000;

export function Hub() {
  const identity = useIdentity();
  useOwlbearTheme();
  if (!identity) return <div className="hub muted pad">Connecting to Owlbear Rodeo…</div>;
  return <HubInner identity={identity} />;
}

function HubInner({ identity }: { identity: Identity }) {
  const api = useMemo(() => sheetsApi(identity), [identity]);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const lastRefresh = useRef(0);
  const refresh = useCallback(
    async (force = true) => {
      // Blob calls are metered: don't re-list more than once every few seconds on focus/timer.
      if (!force && Date.now() - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
      lastRefresh.current = Date.now();
      try {
        setSheets(await api.list());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api],
  );

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh(false);
    }, REFRESH_MS);
    const onFocus = () => refresh(false);
    window.addEventListener("focus", onFocus);
    // Other players (and our own sheet windows) announce changes, so the list updates at once.
    const off = onChanged((e) => {
      const mine = e.from === identity.playerId;
      if (!e.sheetId && mine) return; // our own list change: already refreshed by the dialog
      refresh(!e.sheetId); // saves can be frequent, so rate-limit those
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      off();
    };
  }, [refresh, identity.playerId]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Sheet[]>();
    for (const s of sheets ?? []) {
      if (q && !`${s.name} ${s.ownerName}`.toLowerCase().includes(q)) continue;
      const list = map.get(s.ownerName) ?? [];
      list.push(s);
      map.set(s.ownerName, list);
    }
    return [...map.entries()];
  }, [sheets, query]);

  const done = async () => {
    setDialog(null);
    notifyChanged({ from: identity.playerId });
    await refresh();
  };

  return (
    <div
      className="hub"
      onClick={() => setMenu(null)}
      // Dropping a PDF anywhere on the panel starts an upload. Dialogs handle their own drops.
      onDragEnter={(e) => {
        if (!hasFiles(e) || dialog) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e) && !dialog) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!hasFiles(e) || dialog) return;
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files).find(isPdf);
        if (file) setDialog({ kind: "upload", file });
      }}
    >
      {dragging && <div className="drop-overlay">Drop a PDF to upload it</div>}
      <header className="hub-head">
        <h1>Hero Stable</h1>
        <button title="Settings" onClick={() => setDialog({ kind: "settings" })}>⚙</button>
        <button className="primary" onClick={() => setDialog({ kind: "upload" })}>＋ Upload sheet</button>
      </header>
      <div className="hub-search">
        <input placeholder="Search sheets or players" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="hub-list">
        {sheets === null && !error && <div className="muted pad">Loading…</div>}
        {sheets?.length === 0 && (
          <div className="muted pad">No sheets yet. Upload a PDF character sheet to get started.</div>
        )}
        {groups.map(([owner, list]) => (
          <section key={owner}>
            <h2>{owner}</h2>
            {list.map((s) => (
              <div className="row" key={s.id}>
                <button className="row-main" onClick={() => openSheet(s.id)}>
                  <span className="row-name">{s.name}</span>
                  <span className="row-sub">
                    {canEdit(s, identity) ? "" : "🔒 view only · "}
                    updated by {s.updatedBy}
                  </span>
                </button>
                {canManage(s, identity) && (
                  <div className="row-menu">
                    <button
                      title="More"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(menu === s.id ? null : s.id);
                      }}
                    >
                      ⋯
                    </button>
                    {menu === s.id && (
                      <div className="menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setMenu(null); setDialog({ kind: "rename", sheet: s }); }}>Rename</button>
                        <button onClick={() => { setMenu(null); setDialog({ kind: "permissions", sheet: s }); }}>Who can edit…</button>
                        <button onClick={() => { setMenu(null); setDialog({ kind: "replace", sheet: s }); }}>Replace PDF…</button>
                        {s.prevFileUrl && (
                          <button onClick={() => { setMenu(null); setDialog({ kind: "undo", sheet: s }); }}>Undo last replace</button>
                        )}
                        <button className="danger" onClick={() => { setMenu(null); setDialog({ kind: "delete", sheet: s }); }}>Delete</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      {dialog?.kind === "upload" && <UploadDialog identity={identity} initialFile={dialog.file} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "rename" && <RenameDialog identity={identity} sheet={dialog.sheet} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "replace" && <ReplaceDialog identity={identity} sheet={dialog.sheet} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "permissions" && <PermissionsDialog identity={identity} sheet={dialog.sheet} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete “${dialog.sheet.name}”?`}
          body="This permanently removes the sheet and its PDF for everyone. It can't be undone."
          confirmLabel="Delete"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.remove(dialog.sheet.id);
            await done();
          }}
        />
      )}
      {dialog?.kind === "undo" && (
        <ConfirmDialog
          title="Undo last replace?"
          body="Brings back the PDF this sheet had before it was replaced. Anything saved since then is lost."
          confirmLabel="Restore previous PDF"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.patch(dialog.sheet.id, { restore: true });
            await done();
          }}
        />
      )}
    </div>
  );
}

/* ---------- dialogs ---------- */

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const stripPdf = (name: string) => name.replace(/\.pdf$/i, "");

function UploadDialog({ identity, initialFile, onClose, onDone }: { identity: Identity; initialFile?: File; onClose: () => void; onDone: () => void }) {
  const api = useMemo(() => sheetsApi(identity), [identity]);
  const { busy, error, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const nameEdited = useRef(false);
  const [fields, setFields] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function pick(f: File | null) {
    setFile(f);
    setFields(null);
    setCheckError(null);
    if (!f) return;
    if (!nameEdited.current) setName(stripPdf(f.name)); // follow the file until the user types a name
    try {
      setFields((await listFieldNames(new Uint8Array(await f.arrayBuffer()))).length);
    } catch {
      setCheckError("That doesn't look like a readable PDF.");
    }
  }

  // A PDF dropped on the hub arrives pre-selected.
  useEffect(() => {
    if (initialFile) pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog title="Upload a character sheet" onClose={onClose}>
      <Dropzone file={file} onFile={pick} label="Drop a character sheet PDF here" />
      {checkError && <div className="banner error">{checkError}</div>}
      {fields === 0 && (
        <div className="banner warn">
          No fillable fields found. You can still view this PDF, but nothing can be typed into it.
        </div>
      )}
      {fields !== null && fields > 0 && <div className="muted small">{fields} fillable fields found.</div>}
      <label className="field">
        Sheet name
        <input
          value={name}
          maxLength={80}
          placeholder="e.g. Thorin, level 5"
          onChange={(e) => {
            nameEdited.current = true;
            setName(e.target.value);
          }}
        />
      </label>
      <div className="muted small">Saved under {identity.playerName}.</div>
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !file || !name.trim() || !!checkError}
          onClick={() =>
            run(async () => {
              const url = await uploadPdf(identity, file!, name);
              const sheet = await api.create(name.trim(), url);
              await onDone();
              openSheet(sheet.id);
            })
          }
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </Dialog>
  );
}

function RenameDialog({ identity, sheet, onClose, onDone }: { identity: Identity; sheet: Sheet; onClose: () => void; onDone: () => void }) {
  const api = useMemo(() => sheetsApi(identity), [identity]);
  const { busy, error, run } = useAction();
  const [name, setName] = useState(sheet.name);
  return (
    <Dialog title="Rename sheet" onClose={onClose}>
      <label className="field">
        Sheet name
        <input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={() => run(async () => { await api.patch(sheet.id, { name: name.trim() }); await onDone(); })}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

function ReplaceDialog({ identity, sheet, onClose, onDone }: { identity: Identity; sheet: Sheet; onClose: () => void; onDone: () => void }) {
  const api = useMemo(() => sheetsApi(identity), [identity]);
  const { busy, error, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const newBytes = useRef<Uint8Array | null>(null);
  const [result, setResult] = useState<CarryOverResult | null>(null);
  const [copyValues, setCopyValues] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function pick(f: File | null) {
    setFile(f);
    setResult(null);
    setCheckError(null);
    if (!f) return;
    setChecking(true);
    try {
      newBytes.current = new Uint8Array(await f.arrayBuffer());
      const oldBytes = await fetchPdfBytes(sheet.fileUrl);
      const r = await carryOver(oldBytes, newBytes.current);
      setResult(r);
      setCopyValues(r.copied > 0);
    } catch {
      setCheckError("Couldn't read that PDF to compare fields.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Dialog title={`Replace PDF for “${sheet.name}”`} onClose={onClose}>
      <div className="muted small">
        The sheet keeps its name, owner and permissions. You can undo the replace afterwards.
      </div>
      <Dropzone file={file} onFile={pick} label="Drop the new PDF here" />
      {checking && <div className="muted small">Comparing fields…</div>}
      {checkError && <div className="banner warn">{checkError} You can still replace it without copying values.</div>}
      {result && (
        <div className="compare">
          <div>{result.copied} filled-in values can be carried over.</div>
          {result.missing.length > 0 && (
            <details>
              <summary className="warn-text">{result.missing.length} filled-in fields won't carry over</summary>
              <div className="small muted">{result.missing.slice(0, 40).join(", ")}{result.missing.length > 40 ? "…" : ""}</div>
            </details>
          )}
          {result.added.length > 0 && <div className="small muted">{result.added.length} new fields in the new PDF.</div>}
          <label className="check">
            <input type="checkbox" checked={copyValues} disabled={result.copied === 0} onChange={(e) => setCopyValues(e.target.checked)} />
            Copy matching values into the new PDF
          </label>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !file || checking}
          onClick={() =>
            run(async () => {
              const bytes = result && copyValues ? result.bytes : newBytes.current!;
              const url = await uploadPdf(identity, bytes, sheet.name);
              await api.patch(sheet.id, { fileUrl: url, mode: "replace" });
              await onDone();
            })
          }
        >
          {busy ? "Replacing…" : "Replace PDF"}
        </button>
      </div>
    </Dialog>
  );
}

function PermissionsDialog({ identity, sheet, onClose, onDone }: { identity: Identity; sheet: Sheet; onClose: () => void; onDone: () => void }) {
  const api = useMemo(() => sheetsApi(identity), [identity]);
  const { busy, error, run } = useAction();
  const [candidates, setCandidates] = useState<Editor[]>(sheet.editors);
  const [selected, setSelected] = useState(new Set(sheet.editors.map((e) => e.id)));

  // Offer everyone currently in the room, plus anyone already granted access.
  useEffect(() => {
    if (!inObr) return;
    OBR.party.getPlayers().then((players) => {
      const map = new Map<string, Editor>();
      for (const e of sheet.editors) map.set(e.id, e);
      for (const p of players) if (p.id !== sheet.ownerId) map.set(p.id, { id: p.id, name: p.name });
      setCandidates([...map.values()]);
    });
  }, [sheet]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Dialog title={`Who can edit “${sheet.name}”?`} onClose={onClose}>
      <div className="muted small">
        Everyone in the room can view it. {sheet.ownerName} (owner) and the GM can always edit.
      </div>
      <div className="checks">
        {candidates.length === 0 && <div className="muted small">No other players are in the room right now.</div>}
        {candidates.map((p) => (
          <label className="check" key={p.id}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.patch(sheet.id, { editors: candidates.filter((c) => selected.has(c.id)) });
              await onDone();
            })
          }
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<HostMode>(getHostMode());
  const choose = (m: HostMode) => {
    setHostMode(m);
    setMode(m);
  };
  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="field">Sheet windows</div>
      <label className="check">
        <input type="radio" checked={mode === "overlay"} onChange={() => choose("overlay")} />
        Float over the map (you can still click the map around them)
      </label>
      <label className="check">
        <input type="radio" checked={mode === "blocking"} onChange={() => choose("blocking")} />
        Dim the map while sheets are open
      </label>
      <div className="muted small">Use the second option if floating windows don't respond to clicks in your browser. Open sheets close when you switch.</div>
      <div className="actions">
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

function ConfirmDialog({
  title, body, confirmLabel, danger, onClose, onConfirm,
}: { title: string; body: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="muted">{body}</div>
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button className={danger ? "danger-solid" : "primary"} disabled={busy} onClick={() => run(onConfirm)}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
