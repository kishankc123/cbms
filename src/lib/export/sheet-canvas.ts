import type { Cell, Page, Sheet } from "./sheet-reader";
import { SHEET_WIDTH } from "./sheet-reader";

// Paints each page of a report (company, title, period, the table, the footer) onto a canvas: a white page in plain greys, the same whatever theme the app
// is in. Colour only where it means something (money in green, money out red). What goes where is read from the screen by sheet-reader.ts.

const SCALE = 2; // twice the pixels, so text stays sharp
const PAD = 32;
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const INK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#cfd3da";
const SHADE = "#f3f4f6";
const TONE = { in: "#15803d", out: "#b91c1c" };
const FOOT_H = 44;
const HEAD_GAP = 14;

const headHeight = (p: Page) => p.head.reduce((h, l) => h + Math.round(l.size * 1.45), 0) + HEAD_GAP;

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

function drawCell(ctx: CanvasRenderingContext2D, c: Cell, left: number, y: number, h: number, muted: boolean) {
  if (!c.text) return;
  ctx.font = `${c.bold ? 500 : 400} ${c.size}px ${FONT}`;
  ctx.fillStyle = c.tone ? TONE[c.tone] : muted ? MUTED : INK;
  ctx.textAlign = c.align;
  const inner = c.w - 16;
  const x = c.align === "right" ? left + c.x + c.w - 8 : c.align === "center" ? left + c.x + c.w / 2 : left + c.x + 8;
  ctx.fillText(fit(ctx, c.text, inner), x, y + h / 2);
}

/** One page of a report as a canvas, with the report's footer along the bottom. */
export function drawPage(page: Page, foot: Sheet["foot"]): HTMLCanvasElement {
  const width = Math.max(SHEET_WIDTH, page.width) + PAD * 2;
  const height = PAD + headHeight(page) + page.height + FOOT_H + PAD / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  let y = PAD;
  ctx.textAlign = "center";
  for (const line of page.head) {
    const h = Math.round(line.size * 1.45);
    ctx.font = `${line.bold ? 500 : 400} ${line.size}px ${FONT}`;
    ctx.fillStyle = line.bold ? INK : MUTED;
    ctx.fillText(line.text, width / 2, y + h / 2);
    y += h;
  }
  y += HEAD_GAP;

  const top = y;
  for (const row of page.rows) {
    const ry = top + row.y;
    if (row.spacer) continue;
    if (row.shaded) {
      ctx.fillStyle = SHADE;
      ctx.fillRect(PAD, ry, page.width, row.h);
    }
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 1;
    for (const [on, at] of [[row.ruleTop, ry], [row.ruleBottom, ry + row.h]] as const) {
      if (!on) continue;
      ctx.beginPath();
      ctx.moveTo(PAD, at);
      ctx.lineTo(PAD + page.width, at);
      ctx.stroke();
    }
    row.cells.forEach((c) => drawCell(ctx, c, PAD, ry, row.h, false));
  }

  const fy = top + page.height + FOOT_H / 2;
  ctx.font = `400 11px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.fillText(foot[0], PAD, fy);
  ctx.textAlign = "right";
  ctx.fillText(foot[1], width - PAD, fy);
  return canvas;
}

/** Several pages one under the other as a single picture. */
export function stack(canvases: HTMLCanvasElement[]): HTMLCanvasElement {
  if (canvases.length === 1) return canvases[0];
  const out = document.createElement("canvas");
  out.width = Math.max(...canvases.map((c) => c.width));
  out.height = canvases.reduce((h, c) => h + c.height, 0);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const c of canvases) {
    ctx.drawImage(c, 0, y);
    y += c.height;
  }
  return out;
}
