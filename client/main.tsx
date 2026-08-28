import { render } from "preact";

import { App } from "./app.js";
import "./styles.css";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Application root not found.");
}

render(<App />, root);
