import { del, list, put } from "@vercel/blob";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ConflictError, createHandlers, type Store } from "./handlers.js";
import type { ApiReq, ApiRes, Sheet } from "./types.js";

/**
 * Sheet records live in Vercel Blob next to the PDFs, so there is a single storage service
 * and everything is durable. Each save writes a *new* immutable file:
 *
 *   sheets/<room>/<sheetId>/<version, zero-padded>.json
 *
 * The highest version is the current record. Because a version file can only be created once,
 * two people saving at the same moment can't silently overwrite each other (the loser gets a
 * ConflictError), and immutable files are safe to cache, so a read never returns stale data.
 */

const pad = (n: number) => String(n).padStart(9, "0");
const roomPrefix = (roomId: string) => `sheets/${encodeURIComponent(roomId)}/`;
const sheetPrefix = (roomId: string, id: string) => `${roomPrefix(roomId)}${id}/`;

// Keep a few recent versions around, then prune; done only every few saves to save API calls.
const PRUNE_EVERY = 4;
const KEEP_VERSIONS = 3;

interface Entry {
  url: string;
  pathname: string;
  id: string;
  version: number;
}

function parse(blob: { url: string; pathname: string }): Entry | null {
  const m = blob.pathname.match(/\/([^/]+)\/(\d+)\.json$/);
  return m ? { url: blob.url, pathname: blob.pathname, id: m[1], version: Number(m[2]) } : null;
}

async function listEntries(prefix: string): Promise<Entry[]> {
  const out: Entry[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const entry = parse(blob);
      if (entry) out.push(entry);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function latestBySheet(entries: Entry[]): Entry[] {
  const latest = new Map<string, Entry>();
  for (const e of entries) {
    const best = latest.get(e.id);
    if (!best || e.version > best.version) latest.set(e.id, e);
  }
  return [...latest.values()];
}

async function readSheet(url: string): Promise<Sheet | null> {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as Sheet) : null;
}

const store: Store = {
  async listSheets(roomId) {
    const entries = latestBySheet(await listEntries(roomPrefix(roomId)));
    const sheets = await Promise.all(entries.map((e) => readSheet(e.url)));
    return sheets.filter((s): s is Sheet => s !== null);
  },

  async getSheet(roomId, id) {
    const [latest] = latestBySheet(await listEntries(sheetPrefix(roomId, id)));
    return latest ? readSheet(latest.url) : null;
  },

  async putSheet(sheet) {
    try {
      await put(`${sheetPrefix(sheet.roomId, sheet.id)}${pad(sheet.version)}.json`, JSON.stringify(sheet), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      });
    } catch (e) {
      if (/already exists/i.test((e as Error).message)) throw new ConflictError("version exists");
      throw e;
    }

    if (sheet.version % PRUNE_EVERY === 0) {
      const old = (await listEntries(sheetPrefix(sheet.roomId, sheet.id))).filter(
        (e) => e.version <= sheet.version - KEEP_VERSIONS,
      );
      if (old.length > 0) await del(old.map((e) => e.url));
    }
  },

  async deleteSheet(sheet) {
    const all = await listEntries(sheetPrefix(sheet.roomId, sheet.id));
    if (all.length > 0) await del(all.map((e) => e.url));
  },

  async deleteFile(url) {
    try {
      await del(url);
    } catch {
      /* already gone */
    }
  },
};

export const handlers = createHandlers(store);

export function toApiReq(req: VercelRequest): ApiReq {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    query[k] = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  }
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v[0] : v;
  }
  return { method: req.method ?? "GET", query, headers, body: req.body };
}

export function send(res: VercelResponse, out: ApiRes) {
  res.setHeader("Cache-Control", "no-store");
  res.status(out.status).json(out.body);
}
