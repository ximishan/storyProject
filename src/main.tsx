import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installBrowserMock } from "./browserMock";
import { installSingleDadUiAdapter } from "./singleDadUi";

installBrowserMock();
installSingleDadUiAdapter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
