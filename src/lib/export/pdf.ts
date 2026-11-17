// A small PDF writer: each page is one JPEG picture placed on an A4 page. Pure (bytes in, bytes out), so it can be tested.

export type PdfPage = { jpeg: Uint8Array; /** pixels of the picture */ width: number; height: number; /** page size in points */ pageWidth: number; pageHeight: number; margin: number };

export const A4 = { portrait: [595, 842], landscape: [842, 595] } as const;

export function buildPdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const put = (d: string | Uint8Array) => {
    const b = typeof d === "string" ? enc.encode(d) : d;
    parts.push(b);
    length += b.length;
  };
  const obj = (id: number, body: () => void) => {
    offsets[id] = length;
    put(`${id} 0 obj\n`);
    body();
    put("\nendobj\n");
  };

  put("%PDF-1.4\n");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const [page, content, image] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const w = p.pageWidth - p.margin * 2;
    const h = (p.height / p.width) * w;
    const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${p.margin} ${(p.pageHeight - p.margin - h).toFixed(2)} cm /Im0 Do Q`;
    obj(page, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pageWidth} ${p.pageHeight}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(content, () => put(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    obj(image, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      put(p.jpeg);
      put("\nendstream");
    });
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) put(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** The pieces a picture is cut into so that each fits one page: heights in pixels of the picture. */
export function sliceHeights(width: number, height: number, pageWidth: number, pageHeight: number, margin: number): number[] {
  const perPage = Math.floor(((pageHeight - margin * 2) / (pageWidth - margin * 2)) * width);
  const out: number[] = [];
  for (let y = 0; y < height; y += perPage) out.push(Math.min(perPage, height - y));
  return out;
}
