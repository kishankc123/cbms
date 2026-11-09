"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "./field";
import { evaluateFormula, isFormula } from "@/lib/calc";

// A number field that can do a sum. Type =250+250 and the answer shows under the field as you type; Enter (or leaving the field) puts the answer in the
// field. Anything not starting with = is a plain number, and only digits, a point and a minus are accepted.
//
// It is a drop-in for <input type="number"> and <Input type="number">: same value and onChange(e) with e.target.value, so the screens that use it
// do not change how they read the field. While a sum is being typed the screen is not told anything (it would only see half a formula); when it is
// worked out, the answer arrives as an ordinary change, so VAT, totals and everything linked to the field recalculate as they do for typing.

type Props = Omit<React.ComponentProps<"input">, "type" | "step" | "min" | "max"> & {
  invalid?: boolean;
  /** Plain <input>, with the caller's classes only, for tables and forms that style their own inputs. */
  bare?: boolean;
  /** Places kept in the answer: 2 for money, more for rates. */
  decimals?: number;
  /** Kept so screens that already pass them need no edit; text fields ignore them. */
  step?: unknown;
  min?: unknown;
  max?: unknown;
  type?: unknown;
};

const PLAIN_ONLY = /[^0-9.\-]/g;

/** Sets the field's value the way the browser itself would, so React sees a real change event. */
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const showMoney = (n: number, decimals: number) => n.toLocaleString("en-IN", { minimumFractionDigits: Math.min(decimals, 2), maximumFractionDigits: decimals });

export const AmountInput = forwardRef<HTMLInputElement, Props>(function AmountInput(
  { invalid, bare, decimals = 2, onChange, onBlur, onKeyDown, value, defaultValue, className, title, ...others },
  ref,
) {
  // A text field has no use for these, so they are dropped here and screens that still pass them need no edit.
  const rest: Record<string, unknown> = { ...others };
  for (const k of ["step", "min", "max", "type"]) delete rest[k];
  const el = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLInputElement);
  // A field that starts from defaultValue (and is read when the form is sent) keeps its own text here, so it can be shown as a sum without switching between controlled and uncontrolled.
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue === undefined || defaultValue === null ? "" : String(defaultValue));
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  // The last sum that was worked out and what it came to, so Esc can bring the sum back.
  const last = useRef<{ formula: string; result: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The note under the field sits just below it, wherever the field is on the screen right now.
  const place = () => {
    if (!el.current) return;
    const r = el.current.getBoundingClientRect();
    setBox({ top: r.bottom + 4, left: r.left });
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const say = (message: string | null, forMs = 0) => {
    if (timer.current) clearTimeout(timer.current);
    if (message) place();
    setProblem(message);
    if (message && forMs > 0) timer.current = setTimeout(() => setProblem(null), forMs);
  };

  function change(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (isFormula(raw)) {
      place();
      setDraft(raw);
      say(null);
      return;
    }
    if (draft !== null) setDraft(null);
    const clean = raw.replace(PLAIN_ONLY, "");
    if (clean !== raw) e.target.value = clean;
    if (!controlled) setInner(clean);
    onChange?.(e);
  }

  /** Works the sum out and puts the answer in the field. Returns whether it did. */
  function commit(via: "enter" | "blur"): boolean {
    if (draft === null || !el.current) return false;
    const r = evaluateFormula(draft, decimals);
    if (!r.ok) {
      if (via === "enter") {
        say(r.error);
      } else {
        // Leaving with a sum that does not work: the field goes back to what it held, and says so for a moment, so a half-typed sum is never left looking like an amount.
        setDraft(null);
        say(`${r.error} The amount was left as it was.`, 4000);
      }
      return false;
    }
    last.current = { formula: draft, result: r.value };
    setDraft(null);
    say(null);
    setNativeValue(el.current, r.value);
    return true;
  }

  function keyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && draft !== null) {
      // The sum is worked out first; this Enter must not also save the form.
      e.preventDefault();
      commit("enter");
      return;
    }
    if (e.key === "Escape") {
      if (draft !== null) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
        say(null);
        return;
      }
      if (last.current && el.current && el.current.value === last.current.result) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(last.current.formula);
        last.current = null;
        return;
      }
    }
    onKeyDown?.(e);
  }

  function blur(e: React.FocusEvent<HTMLInputElement>) {
    commit("blur");
    onBlur?.(e);
  }

  const shown = draft ?? (controlled ? value : inner);
  const live = draft !== null ? evaluateFormula(draft, decimals) : null;
  const hint = problem
    ? { text: problem, bad: true }
    : live?.ok
      ? { text: `= ${showMoney(live.number, decimals)}   · Enter to use`, bad: false }
      : draft !== null
        ? { text: draft.trim() === "=" ? "Type a sum, like =250+250" : "Keep typing, or press Esc to cancel", bad: false }
        : null;

  const shared = {
    ref: el,
    inputMode: "decimal" as const,
    autoComplete: "off",
    title: title ?? "Start with = to work out a sum, like =250+250",
    value: shown,
    onChange: change,
    onKeyDown: keyDown,
    onBlur: blur,
    ...rest,
  };

  return (
    <>
      {bare ? <input {...shared} aria-invalid={invalid || undefined} className={className} /> : <Input {...shared} invalid={invalid} className={className} />}
      {hint && box && typeof document !== "undefined"
        ? createPortal(
            <div role="status" style={{ top: box.top, left: box.left }} className={`fixed z-[70] whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md ${hint.bad ? "border-[var(--danger)] bg-surface text-[var(--danger-text)]" : "border-line-strong bg-surface text-ink"}`}>
              {hint.text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
});
