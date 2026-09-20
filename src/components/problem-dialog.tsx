"use client";

import { useState } from "react";
import { InfoDialog } from "@/app/(app)/inventory/info-dialog";

/**
 * Moves the cursor to the element `selector` matches (or to the first control inside it) — used after a
 * problem dialog is closed, so the person lands in the field that needs attention. A select is opened so an
 * option can be chosen at once, and so is anything marked `data-opens` (e.g. a supplier dropdown).
 */
export function focusTarget(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const target = el.matches("input,select,button,textarea") ? el : el.querySelector<HTMLElement>("button,input,select,textarea");
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  target.focus();
  if (el.hasAttribute("data-opens")) target.click();
  else if (target instanceof HTMLSelectElement) {
    try {
      target.showPicker();
    } catch {
      /* focus is enough where the browser won't open it */
    }
  }
}

/**
 * Problems (a missing field, a refusal from the server) are shown in a dialog that says why. Closing it puts
 * the cursor in the field named by `target` (a CSS selector), if there is one.
 *
 *   const { problem, report, dialog } = useProblem();
 *   report("Select a supplier.", '[data-field="supplier"]');   // ...and render {dialog} in the form
 */
export function useProblem() {
  const [problem, setProblem] = useState<{ message: string; target: string | null } | null>(null);
  function report(message: string, target: string | null = null) {
    setProblem({ message, target });
  }
  function close() {
    const target = problem?.target;
    setProblem(null);
    // Wait for the dialog to unmount before moving focus.
    if (target) setTimeout(() => focusTarget(target), 0);
  }
  const dialog = problem ? <InfoDialog message={problem.message} onOk={close} /> : null;
  return { problem, report, dialog };
}
