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

export type FieldRules = [RegExp, string][];

/** The first usable field of the open modal — where to land after a message about a form that has no better target. */
export const FIRST_FIELD_IN_MODAL =
  '.fixed.inset-0 input:not([type="hidden"]):not([type="checkbox"]):not([disabled]), .fixed.inset-0 select:not([disabled]), .fixed.inset-0 textarea:not([disabled])';

/** The selector of the field a message is about (the first rule whose pattern matches), so the cursor can be put there. */
export function targetForMessage(message: string, rules: FieldRules | undefined, fallback: string | null = null): string | null {
  return rules?.find(([re]) => re.test(message))?.[1] ?? fallback;
}

export function messageOf(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * For forms that used to keep an `error` string and print it inline: `setError(message)` now opens the dialog (and, on
 * OK, moves to the field the message is about — by `rules`, else `fallbackTarget`), and `setError(null)` is a no-op
 * because there is nothing left on screen to clear.
 */
export function useErrorDialog(rules?: FieldRules, fallbackTarget: string | null = null) {
  const { report, dialog } = useProblem();
  function setError(message: string | null) {
    if (message) report(message, targetForMessage(message, rules, fallbackTarget));
  }
  return { setError, dialog };
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
  /** Shows a caught error (a failed save, a refused action) in the dialog and, on OK, moves to the field it is about. */
  function reportError(error: unknown, rules?: FieldRules, fallbackTarget: string | null = null) {
    const message = messageOf(error);
    report(message, targetForMessage(message, rules, fallbackTarget));
  }
  function close() {
    const target = problem?.target;
    setProblem(null);
    // Wait for the dialog to unmount before moving focus.
    if (target) setTimeout(() => focusTarget(target), 0);
  }
  const dialog = problem ? <InfoDialog message={problem.message} onOk={close} /> : null;
  return { problem, report, reportError, dialog };
}
