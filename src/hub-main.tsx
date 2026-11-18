import { createRoot } from "react-dom/client";
import { Host } from "./Host";
import { Hub } from "./Hub";
import { inObr } from "./identity";
import "./styles.css";

// Opened directly in a browser tab (outside Owlbear) the hub and the floating windows
// share one page, which makes local development possible without a room.
createRoot(document.getElementById("root")!).render(
  inObr ? (
    <Hub />
  ) : (
    <>
      <Hub />
      <Host />
    </>
  ),
);
