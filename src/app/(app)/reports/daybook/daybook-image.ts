import { imageModel, type DayExtras, type ExportContext, type ImageCard } from "@/lib/ledger/daybook-export";
import type { Daybook } from "@/lib/ledger/daybook-rules";

// Draws the Daybook as a picture, straight onto a canvas, in Workdela's colours: a fixed width and a white page, the same whatever theme the app is in,
// so it reads well when it is sent in a chat. No library. What goes where is decided by imageModel() in daybook-export.ts, which is tested; this file
// only measures and paints it.

const W = 720;
const SCALE = 2; // twice the pixels, so text stays sharp on a phone
const PAD = 28;
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// Workdela's indigo (the app's accent) and ink; the footer band is the dark of the sidebar.
const ACCENT = "#5e6ad2";
const ACCENT_TEXT = "#4f5bc0";
const SOFT = "#eef0fb";
const LINE = "#dfe2f5";
const INK = "#1a1a1f";
const MUTED = "#6b6f8f";
const DARK = "#121316";
const SHARE = ["#5e6ad2", "#8f99f0", "#bfc5f5", "#e1e4fa"];

const HEADER_H = 98;
const SECTION_H = 40;
const CARD_GAP = 10;
const CARD_ROW = 20;
const FLOW_ROW = 30;
const CASH_ROW = 30;
const CHIP_H = 32;
const FOOTER_H = 64;

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size: number; weight?: number; color: string; align?: CanvasTextAlign }) {
  ctx.font = `${o.weight ?? 400} ${o.size}px ${FONT}`;
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align ?? "left";
  ctx.fillText(s, x, y);
}

function sectionHeader(ctx: CanvasRenderingContext2D, n: number, title: string, y: number) {
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(PAD + 12, y + 14, 12, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, String(n), PAD + 12, y + 19, { size: 14, weight: 600, color: "#fff", align: "center" });
  text(ctx, title, PAD + 34, y + 20, { size: 18, weight: 600, color: ACCENT_TEXT });
  const w = (() => { ctx.font = `600 18px ${FONT}`; return ctx.measureText(title).width; })();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD + 34 + w + 12, y + 14);
  ctx.lineTo(W - PAD, y + 14);
  ctx.stroke();
}

function divider(ctx: CanvasRenderingContext2D, y: number) {
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
}

function drawCard(ctx: CanvasRenderingContext2D, c: ImageCard, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10);
  ctx.stroke();
  const inner = 13;
  text(ctx, c.title, x + inner, y + 26, { size: 16, weight: 600, color: INK });
  text(ctx, c.total, x + w - inner, y + 26, { size: 16, weight: 600, color: INK, align: "right" });
  text(ctx, `This month ${c.month}`, x + inner, y + 46, { size: 12, color: MUTED });

  // The share bar: how the day's amount was paid.
  const barX = x + inner;
  const barW = w - inner * 2;
  const barY = y + 58;
  ctx.save();
  roundRect(ctx, barX, barY, barW, 8, 4);
  ctx.clip();
  ctx.fillStyle = SOFT;
  ctx.fillRect(barX, barY, barW, 8);
  let cx = barX;
  c.modes.forEach((m, i) => {
    const sw = barW * m.share;
    if (sw <= 0) return;
    ctx.fillStyle = SHARE[i % SHARE.length];
    ctx.fillRect(cx, barY, Math.max(1, sw - 1), 8);
    cx += sw;
  });
  ctx.restore();

  let ry = y + 90;
  if (c.modes.length === 0) text(ctx, "Nothing today", x + inner, ry, { size: 13, color: MUTED });
  c.modes.forEach((m, i) => {
    ctx.fillStyle = SHARE[i % SHARE.length];
    roundRect(ctx, x + inner, ry - 9, 9, 9, 2);
    ctx.fill();
    ctx.font = `400 13px ${FONT}`;
    const amountW = ctx.measureText(m.amount).width;
    text(ctx, m.amount, x + w - inner, ry, { size: 13, color: INK, align: "right" });
    text(ctx, fit(ctx, m.label, w - inner * 2 - 15 - amountW - 6), x + inner + 15, ry, { size: 13, color: "#44465e" });
    ry += CARD_ROW;
  });
  if (c.returns) text(ctx, `Returns  -${c.returns}`, x + inner, ry, { size: 12, color: MUTED });
}

/** The logo: a W made of two interlocking Vs (see components/brand/logo.tsx), in the light tones used on dark backgrounds. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 56;
  const line = (pts: number[][], color: string, alpha: number) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 7 * k;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * k, y + py * k) : ctx.lineTo(x + px * k, y + py * k)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  line([[6, 14], [18, 42], [30, 14]], "#afa9ec", 1);
  line([[26, 14], [38, 42], [50, 14]], "#5dcaa5", 0.9);
}

export function drawDaybookImage(d: Daybook, info: ExportContext, extras: DayExtras): HTMLCanvasElement {
  const m = imageModel(d, extras);
  const cardRows = Math.max(1, ...m.cards.map((c) => Math.max(1, c.modes.length))) + (m.cards.some((c) => c.returns) ? 1 : 0);
  const cardH = 90 + cardRows * CARD_ROW + 6;
  const H = HEADER_H + 18 + SECTION_H + cardH + 30 + 22 + SECTION_H + FLOW_ROW * (m.flows.length + 1) + 22 + SECTION_H + CASH_ROW * (m.cash.rows.length + 1) + 28 + m.chips.length * (CHIP_H + 8) + 18 + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // Header band: the business, the word Daybook, and the day.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.font = `600 26px ${FONT}`;
  text(ctx, fit(ctx, info.company, W - PAD * 2 - 110), PAD, 42, { size: 26, weight: 600, color: "#fff" });
  text(ctx, "Daybook", W - PAD, 42, { size: 17, weight: 500, color: "#dfe2fb", align: "right" });
  text(ctx, info.dateLabel, PAD, 70, { size: 18, weight: 500, color: "#fff" });
  text(ctx, info.otherDateLabel, PAD, 88, { size: 13, color: "#dfe2fb" });

  let y = HEADER_H + 18;
  // 1. Business performance
  sectionHeader(ctx, 1, "Business performance", y);
  y += SECTION_H;
  const cw = (W - PAD * 2 - CARD_GAP * 2) / 3;
  m.cards.forEach((c, i) => drawCard(ctx, c, PAD + i * (cw + CARD_GAP), y, cw, cardH));
  y += cardH + 18;
  ctx.font = `400 12px ${FONT}`;
  text(ctx, fit(ctx, m.note, W - PAD * 2), PAD, y, { size: 12, color: MUTED });
  y += 12;
  divider(ctx, y);
  y += 22;

  // 2. Collections and payments
  sectionHeader(ctx, 2, "Collections and payments", y);
  y += SECTION_H;
  // The column names sit above the first rule; each row's rule is 24px below the one before.
  text(ctx, "Today", W - PAD - 150, y + 14, { size: 12, weight: 500, color: MUTED, align: "right" });
  text(ctx, "This month", W - PAD, y + 14, { size: 12, weight: 500, color: MUTED, align: "right" });
  y += 24;
  m.flows.forEach((r) => {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    text(ctx, r.label, PAD, y + 20, { size: 14, color: INK });
    text(ctx, r.today, W - PAD - 150, y + 20, { size: 14, weight: r.quiet ? 400 : 600, color: r.quiet ? "#a3a6bd" : INK, align: "right" });
    text(ctx, r.month, W - PAD, y + 20, { size: 14, color: INK, align: "right" });
    y += FLOW_ROW;
  });
  y += 6;
  divider(ctx, y);
  y += 22;

  // 3. Cash position: one column for each cash, bank or wallet account, then the total.
  sectionHeader(ctx, 3, "Cash position", y);
  y += SECTION_H;
  const labelW = 86;
  const colCount = m.cash.columns.length;
  const colW = (W - PAD * 2 - labelW) / colCount;
  m.cash.columns.forEach((c, i) => {
    ctx.font = `500 12px ${FONT}`;
    text(ctx, fit(ctx, c, colW - 8), PAD + labelW + colW * (i + 1) - 4, y + 14, { size: 12, weight: i === colCount - 1 ? 600 : 500, color: i === colCount - 1 ? INK : MUTED, align: "right" });
  });
  y += 24;
  m.cash.rows.forEach((r) => {
    if (r.strong) {
      ctx.fillStyle = SOFT;
      ctx.fillRect(PAD - 6, y, W - PAD * 2 + 12, CASH_ROW - 2);
    } else {
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }
    text(ctx, r.label, PAD, y + 20, { size: 13, weight: r.strong ? 600 : 400, color: INK });
    r.values.forEach((v, i) => {
      const last = i === colCount - 1;
      ctx.font = `${r.strong || last ? 600 : 400} 13px ${FONT}`;
      text(ctx, fit(ctx, v, colW - 6), PAD + labelW + colW * (i + 1) - 4, y + 20, { size: 13, weight: r.strong || last ? 600 : 400, color: INK, align: "right" });
    });
    y += CASH_ROW;
  });
  y += 8;
  text(ctx, fit(ctx, m.monthCash, W - PAD * 2), PAD, y + 8, { size: 12, color: MUTED });
  y += 24;
  m.chips.forEach((c) => {
    ctx.fillStyle = SOFT;
    roundRect(ctx, PAD, y, W - PAD * 2, CHIP_H, 8);
    ctx.fill();
    ctx.font = `400 13px ${FONT}`;
    text(ctx, fit(ctx, c, W - PAD * 2 - 24), PAD + 12, y + 21, { size: 13, color: "#33365a" });
    y += CHIP_H + 8;
  });

  // Footer band: a dark strip with the logo and "Made with Workdela" in the same size as the rest of the text, so it stands out by colour and not by size.
  const fy = H - FOOTER_H;
  ctx.fillStyle = DARK;
  ctx.fillRect(0, fy, W, FOOTER_H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, fy, W, 3);
  ctx.font = `400 14px ${FONT}`;
  const lead = ctx.measureText("Made with ").width;
  ctx.font = `500 14px ${FONT}`;
  const brandW = ctx.measureText("Workdela").width;
  const MARK = 26;
  const total = MARK + 10 + lead + brandW;
  const sx = (W - total) / 2;
  const mid = fy + 3 + (FOOTER_H - 3) / 2;
  drawMark(ctx, sx, mid - MARK / 2, MARK);
  text(ctx, "Made with ", sx + MARK + 10, mid + 5, { size: 14, color: "#b8bacb" });
  text(ctx, "Workdela", sx + MARK + 10 + lead, mid + 5, { size: 14, weight: 500, color: "#ffffff" });
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the picture"))), "image/png"));
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
