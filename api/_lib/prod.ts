import { del } from "@vercel/blob";
import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHandlers, type Store } from "./handlers.js";
import type { ApiReq, ApiRes, Sheet } from "./types.js";

// Upstash Redis added through the Vercel Marketplace sets either set of names.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "",
});

const sheetKey = (id: string) => `hs:sheet:${id}`;
const roomKey = (roomId: string) => `hs:room:${roomId}`;

const store: Store = {
  async listSheets(roomId) {
    const ids = await redis.smembers(roomKey(roomId));
    if (ids.length === 0) return [];
    const rows = await redis.mget<(Sheet | null)[]>(...ids.map(sheetKey));
    return rows.filter((s): s is Sheet => s !== null);
  },
  async getSheet(id) {
    return (await redis.get<Sheet>(sheetKey(id))) ?? null;
  },
  async putSheet(sheet) {
    await redis.set(sheetKey(sheet.id), sheet);
    await redis.sadd(roomKey(sheet.roomId), sheet.id);
  },
  async deleteSheet(sheet) {
    await redis.del(sheetKey(sheet.id));
    await redis.srem(roomKey(sheet.roomId), sheet.id);
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
