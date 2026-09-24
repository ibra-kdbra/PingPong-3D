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
    import("./game/fx.js"),
    import("./game/gamepad.js"),
  ]).then(([transport, session, match, current, fx, gamepad]) => {
    window.__net = {
      ...transport,
      ...session,
      createMatch: match.createMatch,
      current: current.net,
    };
    window.__fx = fx.fx;
    window.__pad = gamepad.padPlayers;
  });
}

const root = ReactDOM.createRoot(document.querySelector("#root"));

root.render(<Experience />);
