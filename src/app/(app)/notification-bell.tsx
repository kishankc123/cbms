"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, Bell, CalendarClock, Calculator, ClipboardList, Coins, FileText, Landmark, PackageX, Receipt, Scale, Users, type LucideIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { GROUP_LABEL, type NotifGroup, type NotifView, type StateAction } from "@/lib/notifications/notification-rules";
import { getNotifications, setNotificationState, type NotificationsData } from "./notifications/actions";

type Tab = "all" | NotifGroup;
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verify", label: GROUP_LABEL.verify },
  { key: "due", label: GROUP_LABEL.due },
  { key: "alert", label: GROUP_LABEL.alert },
];

const ICON: Record<string, LucideIcon> = {
  draft_invoices: FileText,
  draft_bills: FileText,
  details_pending: ClipboardList,
  negative_stock: PackageX,
  overdue_receivables: Receipt,
  cheques_due: Banknote,
  received_cheques_ready: Banknote,
  bank_unmatched: Landmark,
  payroll_runs: Users,
  contributions_owed: Coins,
  compliance_overdue: CalendarClock,
  compliance_due: CalendarClock,
  tax_depreciation_review: Calculator,
  trial_balance: Scale,
};

const TONE = {
  critical: "bg-[var(--status-critical-bg)] text-[var(--status-critical-text)]",
  action: "bg-[var(--status-action-bg)] text-[var(--status-action-text)]",
  info: "bg-[var(--status-pending-bg)] text-[var(--status-pending-text)]",
} as const;

const money = (n: number) => `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const age = (d: number | null) => (d === null ? "" : d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`);
const REFRESH_AFTER_MS = 60_000;

// The bell in the top bar: what needs this person's attention, worked out live, grouped as verification pending, due soon and alerts. The list loads
// after the page has painted (so it never slows a page) and is refreshed when the bell is opened and every few minutes.
export function NotificationBell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const fetchedAt = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getNotifications());
      fetchedAt.current = Date.now();
    } catch {
      /* the bell stays as it was; the next refresh tries again */
    } finally {
      setLoading(false);
    }
  }, []);

  // After the page has painted, then every few minutes.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const refresh = Date.now() - fetchedAt.current > REFRESH_AFTER_MS ? setTimeout(() => void load(), 0) : null;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      if (refresh) clearTimeout(refresh);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  // Choose something about one or more notifications: the screen updates at once, then the choice is saved and the list read again.
  async function choose(items: NotifView[], action: StateAction) {
    setData((d) => {
      if (!d) return d;
      const keys = new Set(items.map((i) => i.key));
      const next = action === "snooze1" || action === "snooze7" ? d.items.filter((i) => !keys.has(i.key)) : d.items.map((i) => (keys.has(i.key) ? { ...i, seen: action === "seen" } : i));
      const unseen = next.filter((i) => !i.seen);
      return { items: next, critical: unseen.some((i) => i.severity === "critical"), counts: { all: unseen.length, verify: unseen.filter((i) => i.group === "verify").length, due: unseen.filter((i) => i.group === "due").length, alert: unseen.filter((i) => i.group === "alert").length } };
    });
    try {
      await setNotificationState({ items: items.map((i) => ({ key: i.key, count: i.count })), action });
    } catch {
      toast.error("Couldn't save that. Try again.");
    }
    void load();
  }

  const shown = (data?.items ?? []).filter((i) => tab === "all" || i.group === tab);
  const unseen = data?.counts.all ?? 0;

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={unseen > 0 ? `Notifications, ${unseen} to look at` : "Notifications"} className="relative flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink">
        <Bell size={18} strokeWidth={1.75} />
        {unseen > 0 && <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${data?.critical ? "bg-[var(--danger)]" : "bg-accent"}`}>{unseen > 99 ? "99+" : unseen}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-popover)]">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-sm font-semibold text-ink">Notifications</h2>
            <button type="button" disabled={unseen === 0} onClick={() => choose((data?.items ?? []).filter((i) => !i.seen), "seen")} className="text-xs text-accent-text hover:underline disabled:pointer-events-none disabled:opacity-40">
              Mark all seen
            </button>
          </div>

          <div className="flex gap-0.5 overflow-x-auto border-b border-line px-3">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`whitespace-nowrap border-b-2 px-2 py-2 text-[13px] transition-colors ${tab === t.key ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
                {t.label}
                {(data?.counts[t.key] ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2">{data?.counts[t.key]}</span>}
              </button>
            ))}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {!data && loading && <p className="px-4 py-8 text-center text-[13px] text-ink-2">Checking…</p>}
            {data && shown.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-2">{tab === "all" ? "You're all caught up." : "Nothing here right now."}</p>}
            {shown.map((n) => {
              const Icon = ICON[n.key] ?? Bell;
              return (
                <div key={n.key} className={`flex gap-3 border-b border-line px-4 py-3 transition-colors last:border-b-0 hover:bg-hover ${n.seen ? "opacity-55" : ""}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE[n.severity]}`}>
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug text-ink">{n.title}</p>
                    <p className="mt-0.5 text-xs text-ink-2">{n.detail}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <Link href={n.href} onClick={() => setOpen(false)} className="font-medium text-accent-text hover:underline">
                        Open
                      </Link>
                      <button type="button" onClick={() => choose([n], n.seen ? "unseen" : "seen")} className="text-ink-2 hover:text-ink">
                        {n.seen ? "Mark unseen" : "Mark seen"}
                      </button>
                      <button type="button" onClick={() => choose([n], "snooze1")} className="text-ink-2 hover:text-ink">
                        Snooze 1 day
                      </button>
                      <button type="button" onClick={() => choose([n], "snooze7")} className="text-ink-2 hover:text-ink">
                        1 week
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-ink-2">
                    {n.amount !== null && <span className="block text-[13px] font-medium tabular-nums text-ink">{money(n.amount)}</span>}
                    {n.amount === null && n.count > 1 && <span className="block text-[13px] font-medium tabular-nums text-ink">{n.count}</span>}
                    {age(n.sinceDays)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between bg-surface-2 px-4 py-2 text-xs text-ink-2">
            <span>{loading ? "Updating…" : "Worked out from your books just now"}</span>
            <span>Only what your role can see</span>
          </div>
        </div>
      )}
    </div>
  );
}
