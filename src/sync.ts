import OBR from "@owlbear-rodeo/sdk";
import { inObr } from "./identity";

/**
 * Tells other players (and this player's other panels) that a sheet changed, so they refresh
 * right away. This is what lets the periodic polling be slow: Blob API calls are metered.
 */
const CHANNEL = "com.herostable/changed";

export interface ChangeEvent {
  /** Which sheet changed; undefined means "the list changed" (upload, delete, rename…). */
  sheetId?: string;
  /** The player who made the change, so they can ignore their own echo. */
  from: string;
}

export function notifyChanged(event: ChangeEvent) {
  if (!inObr) {
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: event }));
    return;
  }
  OBR.broadcast.sendMessage(CHANNEL, event, { destination: "ALL" }).catch(() => {});
}

export function onChanged(callback: (event: ChangeEvent) => void): () => void {
  if (!inObr) {
    const handler = (e: Event) => callback((e as CustomEvent<ChangeEvent>).detail);
    window.addEventListener(CHANNEL, handler);
    return () => window.removeEventListener(CHANNEL, handler);
  }
  return OBR.broadcast.onMessage(CHANNEL, (message) => callback(message.data as ChangeEvent));
}
