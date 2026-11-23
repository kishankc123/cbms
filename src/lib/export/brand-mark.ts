// The Workdela mark (a W made of two interlocking Vs, see components/brand/logo.tsx) painted on a canvas for the exported pictures and PDFs.

const TONES = {
  light: { first: "#5b5fc7", second: "#1d9e75" },
  dark: { first: "#afa9ec", second: "#5dcaa5" },
} as const;

/** `tone="light"` is for a light page, `"dark"` for a dark strip. `size` is the width and height of the square it fits in. */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tone: keyof typeof TONES = "dark") {
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
  line([[6, 14], [18, 42], [30, 14]], TONES[tone].first, 1);
  line([[26, 14], [38, 42], [50, 14]], TONES[tone].second, 0.9);
}
