"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { DatePicker } from "@/components/calendar/date-picker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, controlClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { LazyBalanceChart } from "../balance-chart-lazy";
import { addDays, type ForecastDay } from "@/lib/dashboard/forecast-rules";
import { EVENT_CATEGORIES, PATTERNS, SALES_EFFECTS, URGENCIES, eventFlows, positionOf, rollForward, safestDate, salesNeeded, type EventCategory, type EventInput, type Flow, type PlannedEvent, type SalesEffect, type Urgency, type PaymentPattern } from "@/lib/dashboard/planning-rules";
import { closePlannedEvent, savePlannedEvent } from "./actions";

import { AmountInput } from "@/components/ui/amount-input";
const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const URGENCY_TONE: Record<Urgency, StatusTone> = { must_do: "critical", should_do_soon: "action", can_wait: "neutral" };
const label = (list: readonly { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label ?? key;

type Props = {
  openingCash: number;
  days: ForecastDay[];
  reserve: number;
  horizonDays: number;
  events: PlannedEvent[];
  vendors: { id: string; name: string }[];
  collectedShare: number;
  variableCostShare: number;
  today: string;
  canEdit: boolean;
};

export function PlanningWorkspace(p: Props) {
  const calendar = useCalendar();
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<PlannedEvent | "new" | null>(null);
  const [reserveText, setReserveText] = useState(String(p.reserve));
  const [collected, setCollected] = useState(String(Math.round(p.collectedShare * 100)));
  const [variable, setVariable] = useState(String(Math.round(p.variableCostShare * 100)));
  const [, start] = useTransition();

  const reserve = Number.isFinite(Number(reserveText)) && reserveText.trim() !== "" ? Number(reserveText) : p.reserve;
  const fmt = (iso: string) => formatDate(iso, calendar, "short");

  const flowsOf = useMemo(() => new Map(p.events.map((e) => [e.id, eventFlows(e)])), [p.events]);
  const allFlows = useMemo(() => [...flowsOf.values()].flat(), [flowsOf]);

  const without = useMemo(() => positionOf(p.days, reserve), [p.days, reserve]);
  const withPlanDays = useMemo(() => rollForward(p.openingCash, p.days, allFlows), [p.openingCash, p.days, allFlows]);
  const withPlan = useMemo(() => positionOf(withPlanDays, reserve), [withPlanDays, reserve]);

  const points = withPlanDays.map((d, i) => ({ label: fmt(d.date), balance: p.days[i].balance, plan: p.events.length > 0 ? d.balance : undefined, moneyIn: d.moneyIn, moneyOut: d.moneyOut }));
  const totalPlanned = p.events.reduce((s, e) => s + e.estimate, 0);

  const need = salesNeeded(Math.max(reserve - withPlan.lowest.balance, 0), Number(collected) / 100, Number(variable) / 100);

  // What each event does on its own: the plan with it against the plan without it.
  function impactOf(e: PlannedEvent) {
    const others = p.events.filter((x) => x.id !== e.id).flatMap((x) => flowsOf.get(x.id) ?? []);
    return { without: positionOf(rollForward(p.openingCash, p.days, others), reserve), with: withPlan };
  }

  async function close(e: PlannedEvent, status: "done" | "cancelled") {
    const ok = await ask(status === "done" ? `Mark "${e.name}" as done? It leaves the plan. Record the real spending in Expenses or Purchases.` : `Cancel "${e.name}"? It leaves the plan.`, { confirmLabel: status === "done" ? "Mark done" : "Cancel event", danger: status === "cancelled" });
    if (!ok) return;
    const r = await closePlannedEvent(e.id, status);
    if (r.ok) {
      toast.success(status === "done" ? "Marked as done" : "Event cancelled");
      start(() => router.refresh());
    } else toast.error(r.error);
  }

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          { label: "Planned spending", value: money(totalPlanned) },
          { label: "Lowest cash, without the plan", value: money(without.lowest.balance), tone: without.lowest.balance < 0 ? "danger" : without.lowest.balance < reserve ? "warning" : "default" },
          { label: "Lowest cash, with the plan", value: money(withPlan.lowest.balance), tone: withPlan.lowest.balance < 0 ? "danger" : withPlan.lowest.balance < reserve ? "warning" : "default" },
          { label: "Room above the reserve", value: money(withPlan.headroom), tone: withPlan.headroom < 0 ? "danger" : "default" },
        ]}
      />
      <div className="-mt-3 flex flex-wrap items-end gap-3 text-xs text-ink-2">
        <label className="flex items-center gap-2">
          What if the reserve were
          <AmountInput bare type="number" min={0} value={reserveText} onChange={(e) => setReserveText(e.target.value)} className={`${controlClass} w-36`} aria-label="Reserve to test" />
        </label>
        {reserve !== p.reserve && (
          <button type="button" className="text-accent-text hover:underline" onClick={() => setReserveText(String(p.reserve))}>
            Back to {money(p.reserve)}
          </button>
        )}
        <span>This only tries a different figure on this page. It does not change your setting.</span>
      </div>

      {withPlan.shortfallDate ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
          <StatusPill tone="critical">Cash shortfall</StatusPill>With the plan, cash runs out from {fmt(withPlan.shortfallDate)}.
        </p>
      ) : withPlan.breachDate ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
          <StatusPill tone="action">Below reserve</StatusPill>With the plan, cash falls below the reserve from {fmt(withPlan.breachDate)}.
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
          <StatusPill tone="success">On track</StatusPill>The plan keeps cash above the reserve for the next {p.horizonDays} days.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Expected cash balance</h2>
        <LazyBalanceChart data={points} reserve={reserve} showPlan={p.events.length > 0} />
        <p className="mt-1 text-xs text-ink-2">{p.events.length > 0 ? "The solid line is the forecast with your planned events. The faint line is without them." : "Add a planned event to see its effect."} The dashed line is the reserve.</p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Planned events</h2>
          {p.canEdit && (
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
              Plan an event
            </Button>
          )}
        </div>
        {p.events.length === 0 ? (
          <p className="border-y border-line py-4 text-[13px] text-ink-2">Nothing is planned. Plan a repair, a purchase, a hire or a bonus to see what it would do to your cash before you commit.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] border-y border-line">
            {p.events.map((e) => {
              const imp = impactOf(e);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                      {e.name}
                      <StatusPill tone="pending">Planned</StatusPill>
                      <StatusPill tone={URGENCY_TONE[e.urgency]}>{label(URGENCIES, e.urgency)}</StatusPill>
                    </p>
                    <p className="text-xs text-ink-2">
                      {label(EVENT_CATEGORIES, e.category)}
                      {e.vendorName ? ` · ${e.vendorName}` : ""} · {fmt(e.plannedDate)} · {label(PATTERNS, e.pattern)}
                      {e.high && e.high > e.estimate ? ` · up to ${money(e.high)}` : ""}
                    </p>
                    <p className="text-xs text-ink-2">
                      Lowest cash {money(imp.without.lowest.balance)} without it, {money(imp.with.lowest.balance)} with the whole plan.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tnum text-[13px] font-medium text-ink">{money(e.estimate)}</span>
                    {p.canEdit && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => close(e, "done")}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => close(e, "cancelled")}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-ink-2">A planned event is not an approval and posts nothing. When the money is really spent, record it in Expenses or Purchases and mark the event done.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">How much selling would it take?</h2>
        <div className="flex flex-wrap items-end gap-3 text-xs text-ink-2">
          <Field label="Share of sales collected">
            <span className="flex items-center gap-1.5">
              <AmountInput type="number" min={0} max={100} value={collected} onChange={(e) => setCollected(e.target.value)} className="w-20" /> %
            </span>
          </Field>
          <Field label="Share that goes on the cost of what is sold">
            <span className="flex items-center gap-1.5">
              <AmountInput type="number" min={0} max={100} value={variable} onChange={(e) => setVariable(e.target.value)} className="w-20" /> %
            </span>
          </Field>
        </div>
        <p className="mt-2 text-[13px] text-ink">
          {need.shortfall === 0
            ? "With the plan, cash stays above the reserve, so no extra selling is needed."
            : need.salesNeeded === null
              ? need.note
              : `To close the ${money(need.shortfall)} gap below the reserve, you would need about ${money(need.salesNeeded)} more in sales, collected, in the next ${p.horizonDays} days.`}
        </p>
        <p className="mt-1 text-xs text-ink-2">
          Each rupee of sales brings in about {Math.round(need.netPerRupee * 100)} paisa after the cost of what is sold. The two shares start from your last 90 days and can be changed here. This is a guide, not a target.
        </p>
      </section>

      {editing && (
        <EventModal
          key={editing === "new" ? "new" : editing.id}
          event={editing === "new" ? null : editing}
          others={p.events.filter((x) => editing === "new" || x.id !== editing.id)}
          vendors={p.vendors}
          openingCash={p.openingCash}
          days={p.days}
          reserve={reserve}
          today={p.today}
          horizonDays={p.horizonDays}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success("Event saved to the plan");
            start(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ The form, with the effect shown as you fill it in

type Draft = {
  name: string;
  category: EventCategory;
  vendorId: string;
  estimate: string;
  low: string;
  high: string;
  earliestDate: string;
  latestDate: string;
  plannedDate: string;
  pattern: PaymentPattern;
  advancePct: string;
  balanceDays: string;
  instalments: string;
  intervalDays: string;
  creditDays: string;
  urgency: Urgency;
  salesEffect: SalesEffect;
  salesEffectMonthly: string;
  salesEffectDays: string;
  notes: string;
};

const text = (n: number | null) => (n === null ? "" : String(n));
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

function toInput(d: Draft): EventInput {
  return {
    name: d.name,
    category: d.category,
    vendorId: d.vendorId || null,
    estimate: Number(d.estimate),
    low: numOrNull(d.low),
    high: numOrNull(d.high),
    earliestDate: d.earliestDate,
    latestDate: d.latestDate || null,
    plannedDate: d.plannedDate,
    pattern: d.pattern,
    advancePct: d.pattern === "advance_balance" ? numOrNull(d.advancePct) : null,
    balanceDays: d.pattern === "advance_balance" ? numOrNull(d.balanceDays) : null,
    instalments: d.pattern === "instalments" ? numOrNull(d.instalments) : null,
    intervalDays: d.pattern === "instalments" ? numOrNull(d.intervalDays) : null,
    creditDays: d.pattern === "credit" ? numOrNull(d.creditDays) : null,
    urgency: d.urgency,
    salesEffect: d.salesEffect,
    salesEffectMonthly: d.salesEffect === "none" ? null : numOrNull(d.salesEffectMonthly),
    salesEffectDays: d.salesEffect === "none" ? null : numOrNull(d.salesEffectDays),
    notes: d.notes || null,
  };
}

function EventModal({ event, others, vendors, openingCash, days, reserve, today, horizonDays, onClose, onSaved }: { event: PlannedEvent | null; others: PlannedEvent[]; vendors: { id: string; name: string }[]; openingCash: number; days: ForecastDay[]; reserve: number; today: string; horizonDays: number; onClose: () => void; onSaved: () => void }) {
  const calendar = useCalendar();
  const [d, setD] = useState<Draft>(() => ({
    name: event?.name ?? "",
    category: event?.category ?? "repair",
    vendorId: event?.vendorId ?? "",
    estimate: event ? String(event.estimate) : "",
    low: text(event?.low ?? null),
    high: text(event?.high ?? null),
    earliestDate: event?.earliestDate ?? addDays(today, 7),
    latestDate: event?.latestDate ?? "",
    plannedDate: event?.plannedDate ?? addDays(today, 7),
    pattern: event?.pattern ?? "full",
    advancePct: text(event?.advancePct ?? 50),
    balanceDays: text(event?.balanceDays ?? 30),
    instalments: text(event?.instalments ?? 3),
    intervalDays: text(event?.intervalDays ?? 30),
    creditDays: text(event?.creditDays ?? 30),
    urgency: event?.urgency ?? "should_do_soon",
    salesEffect: event?.salesEffect ?? "none",
    salesEffectMonthly: text(event?.salesEffectMonthly ?? null),
    salesEffectDays: text(event?.salesEffectDays ?? null),
    notes: event?.notes ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const fmt = (iso: string) => formatDate(iso, calendar, "short");

  const input = toInput(d);
  const usable = Number.isFinite(input.estimate) && input.estimate > 0 && !!input.plannedDate;
  const otherFlows = useMemo(() => others.flatMap((o) => eventFlows(o)), [others]);

  const live = useMemo(() => {
    if (!usable) return null;
    const before = positionOf(rollForward(openingCash, days, otherFlows), reserve);
    const flows = (kind: "expected" | "high"): Flow[] => [...otherFlows, ...eventFlows(input, kind)];
    const expected = positionOf(rollForward(openingCash, days, flows("expected")), reserve);
    const high = input.high && input.high > input.estimate ? positionOf(rollForward(openingCash, days, flows("high")), reserve) : null;
    const safest = safestDate(openingCash, days, otherFlows, input, { earliest: input.earliestDate, latest: input.latestDate }, reserve);
    return { before, expected, high, safest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, d, otherFlows, openingCash, days, reserve]);

  function save() {
    setError(null);
    start(async () => {
      const r = await savePlannedEvent(event?.id ?? null, input);
      if (r.ok) onSaved();
      else setError(r.error);
    });
  }

  const dateClass = `${controlClass} w-full`;

  return (
    <Modal
      title={event ? "Edit planned event" : "Plan an event"}
      description="A plan only. It is tried against your forecast and posts nothing."
      onClose={onClose}
      dismissible={!pending}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button variant="primary" onClick={save} loading={pending}>
            Save to plan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="What is it" required className="sm:col-span-2">
              <Input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="New freezer" />
            </Field>
            <Field label="Kind">
              <Select value={d.category} onChange={(e) => set("category", e.target.value as EventCategory)}>
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Supplier (optional)">
              <Select value={d.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
                <option value="">None</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Best estimate" required>
              <AmountInput type="number" min={0} step="0.01" value={d.estimate} onChange={(e) => set("estimate", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Low end">
                <AmountInput type="number" min={0} step="0.01" value={d.low} onChange={(e) => set("low", e.target.value)} />
              </Field>
              <Field label="High end">
                <AmountInput type="number" min={0} step="0.01" value={d.high} onChange={(e) => set("high", e.target.value)} />
              </Field>
            </div>
            <Field label="Earliest it can happen">
              <DatePicker value={d.earliestDate} onChange={(v) => set("earliestDate", v)} className={dateClass} />
            </Field>
            <Field label="Latest it can wait to">
              <DatePicker value={d.latestDate} onChange={(v) => set("latestDate", v)} min={d.earliestDate || undefined} className={dateClass} />
            </Field>
            <Field label="Date you plan to do it" required>
              <DatePicker value={d.plannedDate} onChange={(v) => set("plannedDate", v)} className={dateClass} />
            </Field>
            <Field label="How urgent">
              <Select value={d.urgency} onChange={(e) => set("urgency", e.target.value as Urgency)}>
                {URGENCIES.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How it will be paid" className="sm:col-span-2">
              <Select value={d.pattern} onChange={(e) => set("pattern", e.target.value as PaymentPattern)}>
                {PATTERNS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            {d.pattern === "advance_balance" && (
              <>
                <Field label="Advance, as % of the total">
                  <AmountInput type="number" min={0} max={100} value={d.advancePct} onChange={(e) => set("advancePct", e.target.value)} />
                </Field>
                <Field label="Balance paid after (days)">
                  <Input type="number" min={0} value={d.balanceDays} onChange={(e) => set("balanceDays", e.target.value)} />
                </Field>
              </>
            )}
            {d.pattern === "instalments" && (
              <>
                <Field label="Number of instalments">
                  <Input type="number" min={1} max={60} value={d.instalments} onChange={(e) => set("instalments", e.target.value)} />
                </Field>
                <Field label="Days between instalments">
                  <Input type="number" min={1} value={d.intervalDays} onChange={(e) => set("intervalDays", e.target.value)} />
                </Field>
              </>
            )}
            {d.pattern === "credit" && (
              <Field label="Paid after (days)">
                <Input type="number" min={0} value={d.creditDays} onChange={(e) => set("creditDays", e.target.value)} />
              </Field>
            )}
            <Field label="Effect on sales" className="sm:col-span-2">
              <Select value={d.salesEffect} onChange={(e) => set("salesEffect", e.target.value as SalesEffect)}>
                {SALES_EFFECTS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            {d.salesEffect !== "none" && (
              <>
                <Field label={d.salesEffect === "raise" ? "Sales gained a month" : "Sales lost a month"}>
                  <AmountInput type="number" min={0} step="0.01" value={d.salesEffectMonthly} onChange={(e) => set("salesEffectMonthly", e.target.value)} />
                </Field>
                <Field label="For how many days">
                  <Input type="number" min={1} max={365} value={d.salesEffectDays} onChange={(e) => set("salesEffectDays", e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Notes" className="sm:col-span-2">
              <Input value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-[13px] text-[var(--danger-text)]">{error}</p>}
        </div>

        <aside className="h-fit rounded-lg border border-line bg-surface-2 p-3 text-[13px]" aria-live="polite">
          <p className="mb-2 flex items-center gap-2 font-semibold text-ink">
            What it would do <StatusPill tone="pending">Planned</StatusPill>
          </p>
          {!live ? (
            <p className="text-ink-2">Enter an estimate and a date to see the effect on your cash.</p>
          ) : (
            <div className="space-y-2.5">
              <Row label="Lowest cash without it" value={money(live.before.lowest.balance)} sub={fmt(live.before.lowest.date)} />
              <Row label="Lowest cash with it" value={money(live.expected.lowest.balance)} sub={fmt(live.expected.lowest.date)} tone={live.expected.lowest.balance < 0 ? "danger" : live.expected.lowest.balance < reserve ? "warning" : "default"} />
              {live.high && <Row label="If it costs the high end" value={money(live.high.lowest.balance)} sub={fmt(live.high.lowest.date)} tone={live.high.lowest.balance < 0 ? "danger" : live.high.lowest.balance < reserve ? "warning" : "default"} />}
              <p className="border-t border-line pt-2 text-ink">
                {live.expected.shortfallDate
                  ? `Cash would run out from ${fmt(live.expected.shortfallDate)}.`
                  : live.expected.breachDate
                    ? `It would take cash below the ${money(reserve)} reserve from ${fmt(live.expected.breachDate)}.`
                    : `Cash stays above the ${money(reserve)} reserve for the next ${horizonDays} days.`}
              </p>
              {live.safest && live.safest.date !== d.plannedDate && (
                <p className="text-ink-2">
                  Safest date in your window: <span className="font-medium text-ink">{fmt(live.safest.date)}</span>, lowest cash {money(live.safest.position.lowest.balance)}.{" "}
                  <button type="button" className="text-accent-text hover:underline" onClick={() => set("plannedDate", live.safest!.date)}>
                    Use it
                  </button>
                </p>
              )}
              {live.safest && live.safest.date === d.plannedDate && <p className="text-ink-2">This is already the safest date in your window.</p>}
              {d.urgency === "must_do" && live.expected.headroom < 0 && <p className="text-ink-2">It must be done, so the question is how to fund it, not whether to do it.</p>}
              {d.urgency === "can_wait" && live.expected.headroom < 0 && <p className="text-ink-2">It can wait. Moving it later may keep cash above the reserve.</p>}
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function Row({ label, value, sub, tone = "default" }: { label: string; value: string; sub: string; tone?: "default" | "warning" | "danger" }) {
  const color = tone === "danger" ? "text-[var(--danger-text)]" : tone === "warning" ? "text-[var(--warning-text)]" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <p className="text-ink-2">{label}</p>
        <p className="text-xs text-ink-2">on {sub}</p>
      </div>
      <p className={`tnum font-semibold ${color}`}>{value}</p>
    </div>
  );
}
