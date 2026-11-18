import OBR from "@owlbear-rodeo/sdk";
import { inObr } from "./identity";

export const HOST_ID = "com.herostable.windows";
const OPEN_CHANNEL = "com.herostable/open";
const ACK_CHANNEL = "com.herostable/ack";
const MOCK_EVENT = "herostable-open";

/**
 * "standard": a plain Owlbear modal (just a URL and a size), the same way other extensions open
 * theirs. "floating" (experimental): a transparent modal that lets clicks fall through to the
 * map, which needs Owlbear's hidePaper / hideBackdrop / disablePointerEvents options.
 */
export type HostMode = "standard" | "floating";

export function getHostMode(): HostMode {
  try {
    return localStorage.getItem("hs-host-mode") === "floating" ? "floating" : "standard";
  } catch {
    return "standard";
  }
}

export function setHostMode(mode: HostMode) {
  try {
    localStorage.setItem("hs-host-mode", mode);
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

  // Absolute, so it can't be resolved against anything other than this extension's own origin.
  const url = new URL("/host.html", location.href);
  url.searchParams.set("open", sheetId);

  // An explicit size so the iframe always has room: nearly the whole board.
  const [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]).catch(
    () => [1280, 800],
  );
  await OBR.modal.open({
    id: HOST_ID,
    url: url.href,
    width: Math.max(600, Math.round(vw * 0.96)),
    height: Math.max(400, Math.round(vh * 0.94)),
    ...(getHostMode() === "floating"
      ? { hidePaper: true, hideBackdrop: true, disablePointerEvents: true }
      : {}),
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
