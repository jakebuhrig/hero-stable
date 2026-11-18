import OBR from "@owlbear-rodeo/sdk";
import { useEffect, useState } from "react";
import type { Role } from "../api/_lib/types";

export interface Identity {
  roomId: string;
  playerId: string;
  playerName: string;
  role: Role;
}

/** True inside Owlbear Rodeo; false when the page is opened directly in a browser tab. */
export const inObr = OBR.isAvailable;

function mockIdentity(): Identity {
  const q = new URLSearchParams(location.search);
  return {
    roomId: q.get("room") ?? "dev-room",
    playerId: q.get("id") ?? q.get("player") ?? "dev-player",
    playerName: q.get("player") ?? "Dev Player",
    role: q.get("role") === "GM" ? "GM" : "PLAYER",
  };
}

export function loadIdentity(): Promise<Identity> {
  if (!inObr) return Promise.resolve(mockIdentity());
  return new Promise((resolve) => {
    OBR.onReady(async () => {
      const [playerId, playerName, role] = await Promise.all([
        OBR.player.getId(),
        OBR.player.getName(),
        OBR.player.getRole(),
      ]);
      resolve({ roomId: OBR.room.id, playerId, playerName, role });
    });
  });
}

export function useIdentity(): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    let live = true;
    loadIdentity().then((i) => live && setIdentity(i));
    return () => {
      live = false;
    };
  }, []);
  return identity;
}

/** Follow Owlbear's light/dark theme so the extension matches the room. */
export function useOwlbearTheme() {
  useEffect(() => {
    if (!inObr) return;
    const apply = (t: { mode: string; background: { default: string; paper: string }; text: { primary: string; secondary: string }; primary: { main: string; contrastText: string } }) => {
      const s = document.documentElement.style;
      s.setProperty("--bg", t.background.default);
      s.setProperty("--paper", t.background.paper);
      s.setProperty("--text", t.text.primary);
      s.setProperty("--muted", t.text.secondary);
      s.setProperty("--accent", t.primary.main);
      s.setProperty("--accent-text", t.primary.contrastText);
      document.documentElement.dataset.mode = t.mode.toLowerCase();
    };
    let off = () => {};
    OBR.onReady(() => {
      OBR.theme.getTheme().then(apply);
      off = OBR.theme.onChange(apply);
    });
    return () => off();
  }, []);
}
