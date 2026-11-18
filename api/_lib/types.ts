export type Role = "GM" | "PLAYER";

export interface Editor {
  id: string;
  name: string;
}

export interface Sheet {
  id: string;
  roomId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  /** Extra players (besides owner and GM) who may edit. */
  editors: Editor[];
  fileUrl: string;
  /** Previous file after a "replace", kept for one-step undo. */
  prevFileUrl?: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

/** Identity claimed by the client (Owlbear gives extensions no signed token). */
export interface Ctx {
  roomId: string;
  playerId: string;
  playerName: string;
  role: Role;
}

export interface ApiReq {
  method: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface ApiRes {
  status: number;
  body: unknown;
}
