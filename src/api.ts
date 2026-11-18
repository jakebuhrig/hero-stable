import { upload } from "@vercel/blob/client";
import type { Editor, Sheet } from "../api/_lib/types";
import type { Identity } from "./identity";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: { sheet?: Sheet } = {},
  ) {
    super(message);
  }
}

const useLocalStorage = import.meta.env.VITE_STORAGE === "local";

function authHeaders(id: Identity): Record<string, string> {
  return {
    "x-hs-room": id.roomId,
    "x-hs-player": id.playerId,
    "x-hs-name": encodeURIComponent(id.playerName),
    "x-hs-role": id.role,
  };
}

async function request<T>(id: Identity, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(id),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body);
  return body as T;
}

export interface SheetPatch {
  name?: string;
  editors?: Editor[];
  fileUrl?: string;
  mode?: "save" | "replace";
  baseVersion?: number;
  force?: boolean;
  restore?: boolean;
}

export function sheetsApi(id: Identity) {
  return {
    list: () => request<Sheet[]>(id, "/api/sheets"),
    get: (sheetId: string) => request<Sheet>(id, `/api/sheets/${sheetId}`),
    create: (name: string, fileUrl: string) =>
      request<Sheet>(id, "/api/sheets", { method: "POST", body: JSON.stringify({ name, fileUrl }) }),
    patch: (sheetId: string, patch: SheetPatch) =>
      request<Sheet>(id, `/api/sheets/${sheetId}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (sheetId: string) =>
      request<{ deleted: true }>(id, `/api/sheets/${sheetId}`, { method: "DELETE" }),
  };
}

/** Upload PDF bytes and return the stored file's URL. */
export async function uploadPdf(id: Identity, bytes: Uint8Array | File, label: string): Promise<string> {
  if (useLocalStorage) {
    const res = await fetch("/api/local-upload", { method: "PUT", body: bytes as BodyInit });
    if (!res.ok) throw new Error("Upload failed");
    return (await res.json()).url as string;
  }
  const slug = label.replace(/[^\w-]+/g, "-").slice(0, 40) || "sheet";
  const blob = bytes instanceof File ? bytes : new Blob([bytes as BlobPart], { type: "application/pdf" });
  const result = await upload(`sheets/${slug}.pdf`, blob, {
    access: "public",
    handleUploadUrl: "/api/upload",
    clientPayload: JSON.stringify({ roomId: id.roomId, playerId: id.playerId }),
  });
  return result.url;
}

export async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the PDF (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
