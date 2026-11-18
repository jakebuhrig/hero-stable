import { canEdit, canManage } from "./perms.js";
import type { ApiReq, ApiRes, Ctx, Editor, Sheet } from "./types.js";

/** Thrown by `putSheet` when another write already created that version of the sheet. */
export class ConflictError extends Error {}

export interface Store {
  listSheets(roomId: string): Promise<Sheet[]>;
  getSheet(roomId: string, id: string): Promise<Sheet | null>;
  /**
   * Save a sheet record. Each save is a new `sheet.version`; if that version already exists
   * (someone else saved first) this throws ConflictError instead of overwriting.
   */
  putSheet(sheet: Sheet): Promise<void>;
  deleteSheet(sheet: Sheet): Promise<void>;
  /** Remove a stored PDF. Must not throw if it is already gone. */
  deleteFile(url: string): Promise<void>;
}

const MAX_NAME = 80;
const MAX_EDITORS = 50;

const ok = (body: unknown, status = 200): ApiRes => ({ status, body });
const fail = (status: number, error: string, extra?: object): ApiRes => ({
  status,
  body: { error, ...extra },
});

function readCtx(req: ApiReq): Ctx | null {
  const h = req.headers;
  const roomId = h["x-hs-room"];
  const playerId = h["x-hs-player"];
  const role = h["x-hs-role"];
  const rawName = h["x-hs-name"];
  if (!roomId || !playerId || (role !== "GM" && role !== "PLAYER")) return null;
  let playerName = "Unknown";
  try {
    playerName = rawName ? decodeURIComponent(rawName) : playerName;
  } catch {
    /* keep default */
  }
  return { roomId, playerId, role, playerName: playerName.slice(0, MAX_NAME) };
}

/** Only accept PDFs that we stored ourselves (Vercel Blob or the local dev store). */
function isAllowedFileUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.startsWith("/api/local-file/")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, MAX_NAME);
  return name.length > 0 ? name : null;
}

function cleanEditors(value: unknown): Editor[] | null {
  if (!Array.isArray(value) || value.length > MAX_EDITORS) return null;
  const out: Editor[] = [];
  for (const e of value) {
    if (!e || typeof e.id !== "string" || typeof e.name !== "string") return null;
    out.push({ id: e.id, name: e.name.slice(0, MAX_NAME) });
  }
  return out;
}

export function createHandlers(store: Store) {
  /** /api/sheets */
  async function sheets(req: ApiReq): Promise<ApiRes> {
    const ctx = readCtx(req);
    if (!ctx) return fail(401, "Missing player identity");

    if (req.method === "GET") {
      const list = await store.listSheets(ctx.roomId);
      list.sort(
        (a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name),
      );
      return ok(list);
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = cleanName(body.name);
      if (!name) return fail(400, "A sheet name is required");
      if (!isAllowedFileUrl(body.fileUrl)) return fail(400, "Invalid file");
      const sheet: Sheet = {
        id: crypto.randomUUID(),
        roomId: ctx.roomId,
        name,
        ownerId: ctx.playerId,
        ownerName: ctx.playerName,
        editors: [],
        fileUrl: body.fileUrl,
        version: 1,
        updatedAt: Date.now(),
        updatedBy: ctx.playerName,
      };
      await store.putSheet(sheet);
      return ok(sheet, 201);
    }

    return fail(405, "Method not allowed");
  }

  /** /api/sheets/:id */
  async function sheet(req: ApiReq): Promise<ApiRes> {
    const ctx = readCtx(req);
    if (!ctx) return fail(401, "Missing player identity");
    const id = req.query.id;
    if (!id) return fail(400, "Missing id");

    // Sheets are stored per room, so other rooms' sheets simply don't exist here.
    const current = await store.getSheet(ctx.roomId, id);
    if (!current) return fail(404, "Sheet not found");

    if (req.method === "GET") return ok(current);

    if (req.method === "DELETE") {
      if (!canManage(current, ctx)) return fail(403, "Only the owner or GM can delete");
      await store.deleteSheet(current);
      await store.deleteFile(current.fileUrl);
      if (current.prevFileUrl) await store.deleteFile(current.prevFileUrl);
      return ok({ deleted: true });
    }

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const next: Sheet = { ...current };
      const staleFiles: string[] = [];

      const touchesManaged =
        body.name !== undefined ||
        body.editors !== undefined ||
        body.restore === true ||
        (body.fileUrl !== undefined && body.mode === "replace");
      if (touchesManaged && !canManage(current, ctx)) {
        return fail(403, "Only the owner or GM can do that");
      }

      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name) return fail(400, "Invalid name");
        next.name = name;
      }

      if (body.editors !== undefined) {
        const editors = cleanEditors(body.editors);
        if (!editors) return fail(400, "Invalid editors");
        next.editors = editors;
      }

      if (body.restore === true) {
        if (!current.prevFileUrl) return fail(400, "Nothing to restore");
        staleFiles.push(current.fileUrl);
        next.fileUrl = current.prevFileUrl;
        next.prevFileUrl = undefined;
      } else if (body.fileUrl !== undefined) {
        if (!isAllowedFileUrl(body.fileUrl)) return fail(400, "Invalid file");
        if (body.mode === "replace") {
          if (current.prevFileUrl) staleFiles.push(current.prevFileUrl);
          next.prevFileUrl = current.fileUrl;
        } else {
          // A normal save of edited field values.
          if (!canEdit(current, ctx)) return fail(403, "You can't edit this sheet");
          if (
            typeof body.baseVersion === "number" &&
            body.baseVersion !== current.version &&
            body.force !== true
          ) {
            // Someone else saved since this client loaded the sheet.
            if (isAllowedFileUrl(body.fileUrl)) await store.deleteFile(body.fileUrl);
            return fail(409, "Sheet was updated by someone else", { sheet: current });
          }
          staleFiles.push(current.fileUrl);
        }
        next.fileUrl = body.fileUrl;
      }

      next.version = current.version + 1;
      next.updatedAt = Date.now();
      next.updatedBy = ctx.playerName;
      try {
        await store.putSheet(next);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        // Lost a race with another save: drop the file we just received and report the winner.
        if (next.fileUrl !== current.fileUrl && next.fileUrl !== current.prevFileUrl) {
          await store.deleteFile(next.fileUrl);
        }
        const latest = await store.getSheet(ctx.roomId, id);
        return fail(409, "Sheet was updated by someone else", { sheet: latest });
      }
      for (const url of staleFiles) await store.deleteFile(url);
      return ok(next);
    }

    return fail(405, "Method not allowed");
  }

  return { sheets, sheet };
}
