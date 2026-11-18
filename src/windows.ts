import OBR from "@owlbear-rodeo/sdk";
import { inObr } from "./identity";

export const HOST_ID = "com.herostable.windows";
const OPEN_CHANNEL = "com.herostable/open";
const ACK_CHANNEL = "com.herostable/ack";
const MOCK_EVENT = "herostable-open";

/**
 * "overlay": the windows host is a transparent full-screen modal that lets clicks fall
 * through to the map. "blocking": a plain full-screen modal with a backdrop. Overlay is the
 * default; blocking is the fallback if click-through doesn't behave in a given browser.
 */
export type HostMode = "overlay" | "blocking";

export function getHostMode(): HostMode {
  try {
    return localStorage.getItem("hs-mode") === "blocking" ? "blocking" : "overlay";
  } catch {
    return "overlay";
  }
}

export function setHostMode(mode: HostMode) {
  try {
    localStorage.setItem("hs-mode", mode);
  } catch {
    /* ignore */
  }
  if (inObr) OBR.modal.close(HOST_ID); // reopened with the new mode on the next sheet
}

/** Ask the windows host to show a sheet, opening the host modal first if needed. */
export async function openSheet(sheetId: string) {
  if (!inObr) {
    window.dispatchEvent(new CustomEvent(MOCK_EVENT, { detail: sheetId }));
    return;
  }

  let acked = false;
  const off = OBR.broadcast.onMessage(ACK_CHANNEL, () => {
    acked = true;
  });
  await OBR.broadcast.sendMessage(OPEN_CHANNEL, { sheetId }, { destination: "LOCAL" });
  await new Promise((r) => setTimeout(r, 350));
  off();
  if (acked) return;

  const overlay = getHostMode() === "overlay";
  await OBR.modal.open({
    id: HOST_ID,
    url: `/host.html?open=${encodeURIComponent(sheetId)}`,
    fullScreen: true,
    hidePaper: true,
    hideBackdrop: overlay,
    disablePointerEvents: overlay,
  });
}

/** Host side: call `onOpen` when the hub asks for a sheet. Returns an unsubscribe function. */
export function listenForOpen(onOpen: (sheetId: string) => void): () => void {
  if (!inObr) {
    const handler = (e: Event) => onOpen((e as CustomEvent<string>).detail);
    window.addEventListener(MOCK_EVENT, handler);
    return () => window.removeEventListener(MOCK_EVENT, handler);
  }
  return OBR.broadcast.onMessage(OPEN_CHANNEL, (event) => {
    const sheetId = (event.data as { sheetId?: string })?.sheetId;
    if (!sheetId) return;
    onOpen(sheetId);
    OBR.broadcast.sendMessage(ACK_CHANNEL, {}, { destination: "LOCAL" });
  });
}

export function closeHost() {
  if (inObr) OBR.modal.close(HOST_ID);
}
