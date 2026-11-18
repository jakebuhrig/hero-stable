import type { Ctx, Sheet } from "./types.js";

/** Owner, GM, or a listed editor may change the filled-in values. */
export function canEdit(sheet: Sheet, who: Pick<Ctx, "playerId" | "role">): boolean {
  return (
    who.role === "GM" ||
    sheet.ownerId === who.playerId ||
    sheet.editors.some((e) => e.id === who.playerId)
  );
}

/** Owner or GM may rename, replace the file, change permissions, or delete. */
export function canManage(sheet: Sheet, who: Pick<Ctx, "playerId" | "role">): boolean {
  return who.role === "GM" || sheet.ownerId === who.playerId;
}
