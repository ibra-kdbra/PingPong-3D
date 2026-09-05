import "@fontsource-variable/space-grotesk";
import "./style.css";
import ReactDOM from "react-dom/client";
import Experience from "./Experience.jsx";
import { useStore } from "./game/store.js";

// Exposed for debugging / automated tests (dev builds only).
if (import.meta.env.DEV) {
  window.__game = useStore;
  Promise.all([
    import("./net/transport.js"),
    import("./net/session.js"),
    import("./game/match.js"),
    import("./net/current.js"),
  ]).then(([transport, session, match, current]) => {
    window.__net = {
      ...transport,
      ...session,
      createMatch: match.createMatch,
      current: current.net,
    };
  });
}

const root = ReactDOM.createRoot(document.querySelector("#root"));

root.render(<Experience />);
