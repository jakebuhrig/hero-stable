import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";
import { ConflictError, createHandlers, type Store } from "./api/_lib/handlers";
import type { ApiReq, Sheet } from "./api/_lib/types";

/**
 * Dev-only backend for `npm run dev`: the same handlers the Vercel functions use,
 * backed by JSON + PDF files in .localdata/ instead of Redis + Vercel Blob.
 */
export function localApi(): Plugin {
  const dir = join(process.cwd(), ".localdata");
  const filesDir = join(dir, "files");
  const dbPath = join(dir, "db.json");
  mkdirSync(filesDir, { recursive: true });

  const load = (): Record<string, Sheet> =>
    existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, "utf8")) : {};
  const save = (db: Record<string, Sheet>) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(dbPath, JSON.stringify(db, null, 2));
  };

  const store: Store = {
    async listSheets(roomId) {
      return Object.values(load()).filter((s) => s.roomId === roomId);
    },
    async getSheet(roomId, id) {
      const sheet = load()[id];
      return sheet && sheet.roomId === roomId ? sheet : null;
    },
    async putSheet(sheet) {
      const db = load();
      // Same rule as the Blob store: a version can only be written once.
      if (db[sheet.id] && db[sheet.id].version >= sheet.version) throw new ConflictError("version exists");
      db[sheet.id] = sheet;
      save(db);
    },
    async deleteSheet(sheet) {
      const db = load();
      delete db[sheet.id];
      save(db);
    },
    async deleteFile(url) {
      const name = url.replace("/api/local-file/", "");
      if (/^[\w.-]+$/.test(name)) {
        try {
          unlinkSync(join(filesDir, name));
        } catch {
          /* already gone */
        }
      }
    },
  };
  const handlers = createHandlers(store);

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  return {
    name: "hero-stable-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        // Only our endpoints; /api/_lib/*.ts must fall through so Vite can serve shared source modules.
        if (!/^\/api\/(sheets|local-upload|local-file)(\/|$)/.test(url.pathname)) return next();

        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };

        try {
          if (url.pathname === "/api/local-upload" && req.method === "PUT") {
            const name = `${randomBytes(12).toString("hex")}.pdf`;
            mkdirSync(filesDir, { recursive: true });
            writeFileSync(join(filesDir, name), await readBody(req));
            return json(200, { url: `/api/local-file/${name}` });
          }

          if (url.pathname.startsWith("/api/local-file/") && req.method === "GET") {
            const name = url.pathname.slice("/api/local-file/".length);
            const path = join(filesDir, name);
            if (!/^[\w.-]+$/.test(name) || !existsSync(path)) return json(404, { error: "Not found" });
            res.setHeader("Content-Type", "application/pdf");
            return res.end(readFileSync(path));
          }

          const idMatch = url.pathname.match(/^\/api\/sheets\/([^/]+)$/);
          if (url.pathname !== "/api/sheets" && !idMatch) return json(404, { error: "Not found" });

          const raw = req.method === "GET" || req.method === "DELETE" ? null : await readBody(req);
          const apiReq: ApiReq = {
            method: req.method ?? "GET",
            query: idMatch ? { id: decodeURIComponent(idMatch[1]) } : {},
            headers: Object.fromEntries(
              Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
            ),
            body: raw && raw.length > 0 ? JSON.parse(raw.toString("utf8")) : undefined,
          };
          const out = await (idMatch ? handlers.sheet(apiReq) : handlers.sheets(apiReq));
          json(out.status, out.body);
        } catch (err) {
          json(500, { error: (err as Error).message });
        }
      });
    },
  };
}
