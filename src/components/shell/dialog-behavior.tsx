"use client";

import { useEffect } from "react";

// Dialogs written by hand (a fixed full-screen layer with a dimmed backdrop and a panel) get the same behaviour as the shared
// Modal without each being rewritten: they are announced as dialogs, take focus when they open, stop the page behind them
// from scrolling, and close on Escape (the same as clicking the backdrop). Dialogs that already carry role="dialog" (the shared
// Modal and the confirmation) look after themselves and are left alone. Escape is ignored while a pop-up list or date picker
// is open, so it closes that first.
const OVERLAY = "div.fixed.inset-0";
const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]';

const handmade = () =>
  [...document.querySelectorAll<HTMLElement>(OVERLAY)].filter((o) => !o.querySelector('[role="dialog"], [role="alertdialog"]') && o.querySelector(":scope > .absolute.inset-0") && o.getBoundingClientRect().width > 0);

function enhance() {
  const layers = handmade();
  document.body.style.overflow = layers.length > 0 || document.querySelector('[role="dialog"]') ? "hidden" : "";
  for (const layer of layers) {
    const panel = layer.querySelector<HTMLElement>(":scope > .relative");
    if (!panel || layer.dataset.dialogReady) continue;
    layer.dataset.dialogReady = "1";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const heading = panel.querySelector("h1, h2, h3")?.textContent?.trim();
    if (heading) panel.setAttribute("aria-label", heading);
    if (!layer.contains(document.activeElement)) panel.querySelector<HTMLElement>("[autofocus], " + FOCUSABLE)?.focus({ preventScroll: true });
  }
}

export function DialogBehavior() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(enhance);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[style*="position: fixed"]')) return; // a pop-up list or date picker is open: it closes first
      const top = handmade().pop();
      top?.querySelector<HTMLElement>(":scope > .absolute.inset-0")?.click();
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);
  return null;
}
