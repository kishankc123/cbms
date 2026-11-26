"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/** The Print button of a voucher; when opened from the list's Print, the browser's print window comes up by itself. */
export function VoucherPrint({ auto }: { auto: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!auto || done.current) return;
    done.current = true;
    const wait = window.setTimeout(() => window.print(), 400);
    return () => {
      window.clearTimeout(wait);
      done.current = false;
    };
  }, [auto]);
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Print / save as PDF
    </Button>
  );
}
