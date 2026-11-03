import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

// Accounting tables. Compact 32px rows, thin horizontal separators only, a quiet header, figures right-aligned in tabular
// numerals, a soft hover and a clear selected row. The table is not wrapped in a card: it sits on the page. A table of many
// rows can keep its header in view with stickyHeader (the table then scrolls inside its own box).
//
//   <DataTable stickyHeader>
//     <thead><Tr><Th>Date</Th><Th align="right">Amount</Th></Tr></thead>
//     <tbody><Tr><Td>12-04-2083</Td><Td numeric><Amount value={1250} /></Td></Tr></tbody>
//   </DataTable>

export function DataTable({ children, stickyHeader, className = "" }: { children: React.ReactNode; stickyHeader?: boolean; className?: string }) {
  return (
    <div className={`overflow-x-auto ${stickyHeader ? "max-h-[70vh] overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10" : ""} ${className}`}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({ align = "left", className = "", ...rest }: React.ComponentProps<"th"> & { align?: Align }) {
  return <th className={`h-8 whitespace-nowrap border-b border-line bg-app px-2.5 text-xs font-medium text-ink-2 ${ALIGN[align]} ${className}`} {...rest} />;
}

/** A column heading that sorts: shows which way it is sorted, and calls onSort when clicked. */
export function SortableTh({ children, direction, onSort, align = "left", className = "" }: { children: React.ReactNode; direction?: "asc" | "desc" | null; onSort: () => void; align?: Align; className?: string }) {
  const Icon = direction === "asc" ? ChevronUp : direction === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"} className={`h-8 whitespace-nowrap border-b border-line bg-app px-2.5 text-xs font-medium text-ink-2 ${ALIGN[align]} ${className}`}>
      <button type="button" onClick={onSort} className={`inline-flex items-center gap-1 hover:text-ink ${align === "right" ? "flex-row-reverse" : ""}`}>
        {children}
        <Icon size={12} className={direction ? "text-ink" : "text-ink-3"} />
      </button>
    </th>
  );
}

export function Tr({ selected, clickable, className = "", ...rest }: React.ComponentProps<"tr"> & { selected?: boolean; clickable?: boolean }) {
  return <tr aria-selected={selected || undefined} className={`group transition-colors duration-100 hover:bg-hover ${selected ? "bg-selected hover:bg-selected" : ""} ${clickable ? "cursor-pointer" : ""} ${className}`} {...rest} />;
}

export function Td({ numeric, align, className = "", ...rest }: React.ComponentProps<"td"> & { numeric?: boolean; align?: Align }) {
  return <td className={`h-8 border-b border-line px-2.5 text-ink ${numeric ? "text-right tnum" : ALIGN[align ?? "left"]} ${className}`} {...rest} />;
}

/** Row actions (a contextual menu or buttons): quiet until the row is hovered or focused. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1 opacity-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{children}</div>;
}

/**
 * A money amount, the same everywhere: two decimals with thousands separators, a minus sign and red for a negative, grey for
 * zero. `side` adds a small Dr or Cr after a ledger figure. Put it in a numeric cell so it lines up on the right.
 */
export function Amount({ value, side, decimals = 2, className = "" }: { value: number; side?: "dr" | "cr"; decimals?: number; className?: string }) {
  const text = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const negative = value < -(10 ** -decimals) / 2;
  const zero = Math.abs(value) < 10 ** -decimals / 2;
  return (
    <span className={`tnum ${negative ? "text-[var(--danger-text)]" : zero ? "text-ink-3" : ""} ${className}`}>
      {negative ? "-" : ""}
      {text}
      {side && <span className="ml-1 text-[11px] font-normal text-ink-3">{side === "dr" ? "Dr" : "Cr"}</span>}
    </span>
  );
}
