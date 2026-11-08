import { imageRows, type ExportContext, type ImageRow } from "@/lib/ledger/daybook-export";
import type { Daybook } from "@/lib/ledger/daybook-rules";

// Draws the Daybook as a picture, straight onto a canvas: a fixed width, white, dark text, the same whatever theme the app is in, so it reads well when
// it is sent in a chat. No library: the layout is a plain list of rows (see daybook-export.ts, which is tested).

const W = 720;
const SCALE = 2; // twice the pixels, so text stays sharp on a phone
const PAD = 40;
const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const RULE = "#e3e3e3";
const HEIGHT: Record<ImageRow["kind"], number> = { section: 38, line: 32, sub: 26, rule: 22, gap: 8 };

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

export function drawDaybookImage(d: Daybook, info: ExportContext): HTMLCanvasElement {
  const rows = imageRows(d);
  const header = 144;
  const footer = 56;
  const H = header + rows.reduce((s, r) => s + HEIGHT[r.kind], 0) + footer;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // Header: the business, the word Daybook, and the day.
  ctx.fillStyle = INK;
  ctx.font = `600 28px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(fit(ctx, info.company, W - PAD * 2 - 130), PAD, PAD + 24);
  ctx.fillStyle = MUTED;
  ctx.font = `500 20px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("Daybook", W - PAD, PAD + 24);
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(info.dateLabel, PAD, PAD + 58);
  ctx.fillStyle = MUTED;
  ctx.font = `400 16px ${FONT}`;
  ctx.fillText(info.otherDateLabel, PAD, PAD + 82);

  let y = header;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 12);
  ctx.lineTo(W - PAD, y - 12);
  ctx.stroke();

  for (const r of rows) {
    const h = HEIGHT[r.kind];
    if (r.kind === "rule") {
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + h / 2);
      ctx.lineTo(W - PAD, y + h / 2);
      ctx.stroke();
    } else if (r.kind !== "gap") {
      const sub = r.kind === "sub";
      ctx.fillStyle = sub ? MUTED : INK;
      ctx.font = `${r.kind === "section" ? 600 : 400} ${sub ? 17 : r.kind === "section" ? 21 : 20}px ${FONT}`;
      const baseline = y + h - (sub ? 8 : 10);
      const indent = sub ? 18 : 0;
      ctx.textAlign = "right";
      const right = r.right ?? "";
      const rightWidth = right ? ctx.measureText(right).width : 0;
      if (right) ctx.fillText(right, W - PAD, baseline);
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, r.left ?? "", W - PAD * 2 - indent - rightWidth - 16), PAD + indent, baseline);
    }
    y += h;
  }

  ctx.fillStyle = MUTED;
  ctx.font = `400 14px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Made with Workdela", W / 2, H - 24);
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
