"use client";

import { useEffect, useState } from "react";
import { Copy, Download, ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { exportFileName, type DayExtras, type ExportContext } from "@/lib/ledger/daybook-export";
import type { Daybook } from "@/lib/ledger/daybook-rules";
import { canvasToBlob, drawDaybookImage, saveBlob } from "./daybook-image";

// The picture is looked at first: it opens here, drawn from the figures on the page. If something looks wrong, the entries and cash count are one click away,
// and "Refresh" draws it again from the latest figures, so nothing needs to be downloaded until it is right.
export function ImagePreview({ data, info, extras, day, refreshing, onRefresh, onCheck, onClose }: { data: Daybook; info: ExportContext; extras: DayExtras; day: string; refreshing: boolean; onRefresh: () => void; onCheck: () => void; onClose: () => void }) {
  const toast = useToast();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Draw (again) whenever the figures change, which is also what happens after Refresh.
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    canvasToBlob(drawDaybookImage(data, info, extras))
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setFailed(false);
        setBlob(b);
        setUrl(made);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [data, info, extras]);

  async function copy() {
    if (!blob) return;
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Picture copied. Paste it into your chat.");
    } catch {
      toast.error("This browser can't copy pictures. Download it instead.");
    }
  }

  return (
    <Modal
      title="Daybook picture"
      description="Check it here first. Download or copy it when it looks right."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" icon={<ListChecks size={15} />} onClick={onCheck}>
            Check entries
          </Button>
          <Button size="sm" icon={<RefreshCw size={15} />} loading={refreshing} onClick={onRefresh}>
            Refresh
          </Button>
          <Button size="sm" icon={<Copy size={15} />} disabled={!blob} onClick={copy}>
            Copy
          </Button>
          <Button size="sm" variant="primary" icon={<Download size={15} />} disabled={!blob} onClick={() => blob && saveBlob(blob, exportFileName(info.company, day, "png"))}>
            Download
          </Button>
        </>
      }
    >
      <div className="flex justify-center rounded-md bg-app p-3">
        {failed ? (
          <p className="py-10 text-sm text-ink-2">Couldn&apos;t make the picture. Try Refresh.</p>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Daybook for ${info.dateLabel}`} className="w-full max-w-[720px] border border-line bg-white" />
        ) : (
          <p className="py-10 text-sm text-ink-2">Drawing the picture…</p>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-2">Something not right? Choose Check entries, open the entry that needs fixing, then come back and choose Refresh.</p>
    </Modal>
  );
}
