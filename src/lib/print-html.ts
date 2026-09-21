/** Escapes text for use inside printed HTML. */
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Prints one document (not the whole page): the HTML goes into a hidden frame, which is printed and then removed.
 * Runs in the browser only.
 */
export function printDocument(title: string, bodyHtml: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#111;margin:32px;font-size:13px}
    h1{font-size:18px;margin:0 0 4px} .sub{color:#666;margin-bottom:18px}
    table{border-collapse:collapse;width:100%;margin-top:8px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}
    th{width:32%;color:#555;font-weight:600} .num{text-align:right}
    .total td,.total th{font-weight:700;border-top:2px solid #999}
  </style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const win = frame.contentWindow;
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1500);
  }, 150);
}
