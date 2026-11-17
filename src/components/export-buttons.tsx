"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProblem } from "@/components/problem-dialog";
import { readSheet, type Sheet } from "@/lib/export/sheet-reader";
import { drawPage, stack } from "@/lib/export/sheet-canvas";
import { A4, buildPdf, sliceHeights, type PdfPage } from "@/lib/export/pdf";

type Kind = "excel" | "image" | "pdf";

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const bytesOf = (canvas: HTMLCanvasElement) => Uint8Array.from(atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]), (c) => c.charCodeAt(0));

// Each page of the report is cut into A4 pieces, wide tables on a landscape page.
function pdfPages(sheet: Sheet): PdfPage[] {
  return sheet.pages.flatMap((page) => {
    const canvas = drawPage(page, sheet.foot);
    const wide = (page.rows[0]?.cells.reduce((n, c) => n + c.span, 0) ?? 0) > 4;
    const [pageWidth, pageHeight] = wide ? A4.landscape : A4.portrait;
    const margin = 24;
    let y = 0;
    return sliceHeights(canvas.width, canvas.height, pageWidth, pageHeight, margin).map((h) => {
      const piece = document.createElement("canvas");
      piece.width = canvas.width;
      piece.height = h;
      const ctx = piece.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, piece.width, h);
      ctx.drawImage(canvas, 0, -y);
      y += h;
      return { jpeg: bytesOf(piece), width: piece.width, height: h, pageWidth, pageHeight, margin };
    });
  });
}

/** Save the report on screen as Excel, a picture or a PDF, or print it. The report is the #report-sheet on the page. */
export function ExportButtons() {
  const [busy, setBusy] = useState<Kind | null>(null);
  const { report, dialog } = useProblem();

  async function run(kind: Kind) {
    const el = document.getElementById("report-sheet");
    if (!el) return;
    setBusy(kind);
    try {
      const sheet = readSheet(el);
      const name = sheet.name.replace(/\//g, "-").replace(/[\\:*?"<>|]/g, "").trim() || "Report";
      if (kind === "excel") {
        const { XLSX, wb } = await (await import("@/lib/export/sheet-xlsx")).toWorkbook(sheet);
        XLSX.writeFile(wb, `${name}.xlsx`);
      } else if (kind === "image") {
        const blob = await new Promise<Blob | null>((done) => stack(sheet.pages.map((p) => drawPage(p, sheet.foot))).toBlob(done, "image/png"));
        if (!blob) throw new Error("The picture could not be made.");
        save(blob, `${name}.png`);
      } else {
        save(new Blob([buildPdf(pdfPages(sheet)) as BlobPart], { type: "application/pdf" }), `${name}.pdf`);
      }
    } catch (e) {
      report(e instanceof Error ? e.message : "That file could not be made.", null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {([["excel", "Excel"], ["image", "Image"], ["pdf", "PDF"]] as const).map(([kind, label]) => (
        <Button key={kind} loading={busy === kind} disabled={busy !== null} onClick={() => run(kind)}>
          {label}
        </Button>
      ))}
      <Button onClick={() => window.print()}>Print</Button>
      {dialog}
    </div>
  );
}
