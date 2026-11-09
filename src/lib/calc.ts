// The calculator behind number fields: type =250+250 and the field works it out. Written by hand (no eval), so nothing a person types can run as code.
//
// What it understands: numbers (with decimals, and commas like 1,250), + - * / (and the x and × ÷ signs), brackets, a minus or plus in front of a number, and
// percentages. A percentage after + or - is a share of what came before ("=1000+13%" is 1130, "=1000-10%" is 900); anywhere else it is just the number
// divided by a hundred ("=1000*13%" is 130). The answer is rounded once, at the end, so "=1/3*3" comes out as 1.

export type CalcResult = { ok: true; value: string; number: number } | { ok: false; error: string };

const MAX_LENGTH = 200;
const LIMIT = 1e15;

/** Whether what was typed is meant as a calculation: it starts with "=" (after any spaces). */
export const isFormula = (text: string): boolean => text.trimStart().startsWith("=");

type Token = { kind: "num"; value: number } | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" | "%" };

class CalcError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      let seenDot = false;
      let text = "";
      while (j < src.length) {
        const d = src[j];
        if (d >= "0" && d <= "9") text += d;
        else if (d === ".") {
          if (seenDot) throw new CalcError("A number has two decimal points.");
          seenDot = true;
          text += d;
        } else if (d === "," && j + 1 < src.length && src[j + 1] >= "0" && src[j + 1] <= "9") {
          // a thousands comma, as in 1,250 (a comma before anything else is left to fail)
        } else break;
        j++;
      }
      if (text === ".") throw new CalcError("A number is missing its digits.");
      tokens.push({ kind: "num", value: Number(text) });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "(" || c === ")" || c === "%") {
      tokens.push({ kind: "op", value: c });
    } else if (c === "x" || c === "X" || c === "×") tokens.push({ kind: "op", value: "*" });
    else if (c === "÷") tokens.push({ kind: "op", value: "/" });
    else throw new CalcError(`"${c}" can't be used in a sum.`);
    i++;
  }
  return tokens;
}

type Val = { v: number; pct: boolean };

function run(tokens: Token[]): number {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (t: Token | undefined, ...ops: string[]) => t !== undefined && t.kind === "op" && ops.includes(t.value);

  function primary(): Val {
    const t = tokens[p];
    if (!t) throw new CalcError("The sum stops too early.");
    if (t.kind === "num") {
      p++;
      return { v: t.value, pct: false };
    }
    if (isOp(t, "(")) {
      p++;
      const inner = expr();
      if (!isOp(peek(), ")")) throw new CalcError("A bracket is not closed.");
      p++;
      return { v: inner.v, pct: false };
    }
    throw new CalcError("The sum is not complete.");
  }

  function unary(): Val {
    if (isOp(peek(), "-")) {
      p++;
      const x = unary();
      return { v: -x.v, pct: x.pct };
    }
    if (isOp(peek(), "+")) {
      p++;
      return unary();
    }
    let x = primary();
    while (isOp(peek(), "%")) {
      p++;
      x = { v: x.v / 100, pct: true };
    }
    return x;
  }

  function term(): Val {
    let left = unary();
    while (isOp(peek(), "*", "/")) {
      const op = (tokens[p++] as { value: string }).value;
      const right = unary();
      if (op === "/" && right.v === 0) throw new CalcError("Can't divide by zero.");
      left = { v: op === "*" ? left.v * right.v : left.v / right.v, pct: false };
    }
    return left;
  }

  function expr(): Val {
    let left = term();
    while (isOp(peek(), "+", "-")) {
      const op = (tokens[p++] as { value: string }).value;
      const right = term();
      // "1000+13%" is 1000 plus 13 per cent of 1000.
      const amount = right.pct ? left.v * right.v : right.v;
      left = { v: op === "+" ? left.v + amount : left.v - amount, pct: false };
    }
    return left;
  }

  const result = expr();
  if (p < tokens.length) throw new CalcError(isOp(tokens[p], ")") ? "A bracket is closed that was never opened." : "The sum is not complete.");
  return result.v;
}

/** Works out a formula such as "=250+250". `decimals` is how many places the answer keeps (2 for money). */
export function evaluateFormula(text: string, decimals = 2): CalcResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("=")) return { ok: false, error: "Start with = to work out a sum, like =250+250." };
  const body = trimmed.slice(1).trim();
  if (body === "") return { ok: false, error: "Type a sum after the =, like =250+250." };
  if (body.length > MAX_LENGTH) return { ok: false, error: "That sum is too long." };
  try {
    const raw = run(tokenize(body));
    if (!Number.isFinite(raw) || Math.abs(raw) >= LIMIT) return { ok: false, error: "That number is too large." };
    const factor = 10 ** decimals;
    const rounded = (Math.sign(raw) * Math.round((Math.abs(raw) + Number.EPSILON) * factor)) / factor; // halves round away from zero, the same for losses as for gains
    const number = Object.is(rounded, -0) ? 0 : rounded;
    return { ok: true, number, value: String(number) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    return { ok: false, error: "Can't work this out." };
  }
}
