import { createRoot } from "react-dom/client";
import { Host } from "./Host";
import "./styles.css";

// The windows host must stay transparent over the map; see `html.host-page` in styles.css.
document.documentElement.classList.add("host-page");

createRoot(document.getElementById("root")!).render(<Host />);
