// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Unregister any existing service workers on load to avoid serving stale cached builds.
// This helps when users have an old service worker that keeps returning outdated index.html.
if ("serviceWorker" in navigator) {
  // run after the page is fully loaded
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch((err) => {
          // don't block app if unregister fails
          console.warn("ServiceWorker unregister failed:", err);
        });
      });
    }).catch((err) => {
      // ignore errors (some browsers may restrict this)
      console.warn("ServiceWorker registrations unavailable:", err);
    });
  });
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
