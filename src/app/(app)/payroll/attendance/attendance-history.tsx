"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { D } from "@/components/calendar/date-text";
import { useFormatDateTime } from "@/components/calendar/calendar-provider";
import type { AttendanceHistoryItem } from "@/lib/payroll/attendance";
import { getAttendanceHistory } from "../employees/attendance-actions";

const STATUS_WORD: Record<string, string> = { present: "present", absent: "absent", leave: "on leave", half_day: "half day" };

/** What happened to this month's attendance after it was looked over: the check, an undo and its reason, and every mark changed in a checked month. */
export function AttendanceHistory({ periodStart, refreshKey }: { periodStart: string; refreshKey: string }) {
  const fmtDT = useFormatDateTime();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AttendanceHistoryItem[] | null>(null);

  useEffect(() => {
    let live = true;
    getAttendanceHistory({ periodStart })
      .then((r) => live && setItems(r))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [periodStart, refreshKey]);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-9 w-full items-center justify-between px-3 text-left text-[13px] text-ink">
        <span>
          History of this month
          {items ? <span className="text-ink-2"> ({items.length})</span> : null}
        </span>
        <ChevronDown size={15} className={`text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2 text-[13px]">
          {items === null && <p className="text-ink-2">Loading...</p>}
          {items && items.length === 0 && <p className="text-ink-2">Nothing yet. Checking the month, undoing the check, and marks changed after a check are listed here.</p>}
          <ul className="divide-y divide-line">
            {items?.map((e) => (
              <li key={e.id} className="py-1.5">
                <p>
                  {e.kind === "checked" && (
                    <>
                      <span className="font-medium">Checked</span> by {e.by || "someone"}
                    </>
                  )}
                  {e.kind === "check_undone" && (
                    <>
                      <span className="font-medium">Check undone</span> by {e.by || "someone"}
                    </>
                  )}
                  {e.kind === "mark_changed" && (
                    <>
                      <span className="font-medium">{e.employee ?? "An employee"}</span>
                      {e.workDate && (
                        <>
                          , <D value={e.workDate} />
                        </>
                      )}
                      : {STATUS_WORD[e.from ?? "present"] ?? e.from} to {STATUS_WORD[e.to ?? "present"] ?? e.to}, by {e.by || "someone"}
                    </>
                  )}
                </p>
                {e.reason && <p className="text-xs text-ink-2">Reason: {e.reason}</p>}
                <p className="text-xs text-ink-2">{fmtDT(e.at)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
