"use client";

import { useEffect } from "react";

// Many forms put a <label> above a field without tying the two together. This links them as pages appear: a label with no
// "for" takes the control that follows it (the next element, or the one field inside it), so clicking the label focuses the
// field and a screen reader announces the label as the field's name. Nothing else about the form changes.
const CONTROL = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea";
let counter = 0;

function link(root: ParentNode) {
  for (const label of root.querySelectorAll<HTMLLabelElement>("label:not([for])")) {
    if (label.querySelector(CONTROL) || !label.textContent?.trim()) continue;
    const next = label.nextElementSibling;
    if (!next) continue;
    const controls = next.matches(CONTROL) ? [next] : [...next.querySelectorAll(CONTROL)];
    if (controls.length !== 1) continue;
    const control = controls[0] as HTMLElement;
    if (!control.id) control.id = `lbl-${++counter}`;
    label.htmlFor = control.id;
  }
}

export function LabelLinks() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => link(document));
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
