import { D } from "@/components/calendar/date-text";
import { todayIso } from "@/lib/calendar";
import { LogoMark } from "@/components/brand/logo";

/** The printable page of a report. Printing (or saving as PDF) shows only this, not the menus around it. */
export function ReportSheet({ children, name }: { children: React.ReactNode; /** What a multi-page report is called in the saved file's name (the default is the quarterly pack). */ name?: string }) {
  return (
    <div id="report-sheet" data-report-name={name} className="rounded-lg border border-line bg-surface p-5 print:border-none print:p-0">
      {children}
      <style>{`@media print { body * { visibility: hidden; } #report-sheet, #report-sheet * { visibility: visible; } #report-sheet { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </div>
  );
}

/** Company name, address, report name and period, centred at the top of every report. */
export function ReportHeader({ company, address, title, period }: { company: string; address?: string; title: string; period: React.ReactNode }) {
  return (
    <div data-report-header className="mb-4 text-center">
      <h2 className="text-base font-semibold text-ink">{company}</h2>
      {address && <p className="text-xs text-ink-2">{address}</p>}
      <p className="mt-1 text-[13px] font-medium text-ink">{title}</p>
      <p className="text-xs text-ink-2">{period}</p>
    </div>
  );
}

export function ReportFooter({ note }: { note?: string }) {
  return (
    <div data-report-footer className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-[11px] text-ink-3">
      <span>
        Prepared on <D value={todayIso()} style="long" />
        {note ? `  ·  ${note}` : ""}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LogoMark size={14} />
        Made with Workdela
      </span>
      <span aria-hidden />
    </div>
  );
}
