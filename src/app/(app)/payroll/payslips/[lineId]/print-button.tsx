"use client";

import { Button } from "@/components/ui/button";

// Opens the browser's print dialog; choosing "Save as PDF" there gives the PDF.
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Print / save as PDF
    </Button>
  );
}
