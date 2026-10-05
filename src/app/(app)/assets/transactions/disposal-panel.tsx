"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { CustomerSelect } from "@/components/quick-add/pickers";
import { useProblem, type FieldRules } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { disposalAmounts, type DisposalKind } from "@/lib/assets/disposal-math";
import { todayIso } from "@/lib/calendar";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { InfoDialog } from "../../inventory/info-dialog";
import { createAssetDisposal, reverseAssetDisposalAction, type DisposalFormData } from "../actions";
import { money } from "../shared";

const input = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const label = "mb-1 block text-xs text-gray-500";
const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const KINDS: { id: DisposalKind; title: string; help: string }[] = [
  { id: "sale", title: "Sell", help: "The asset is sold and money is received." },
  { id: "disposal", title: "Dispose", help: "Scrapped, given away or lost. No money comes in." },
  { id: "write_off", title: "Write off", help: "Taken off the books as worthless, for example after damage or theft." },
];
const KIND_LABEL: Record<string, string> = { sale: "Sale", disposal: "Disposal", write_off: "Write-off" };

const SERVER_RULES: FieldRules = [
  [/choose the asset|is (sold|disposed|written)/i, '[data-field="asset"]'],
  [/depreciation/i, '[data-field="asset"]'],
  [/sale price/i, '[data-field="price"]'],
  [/cash or bank/i, '[data-field="account"]'],
  [/customer/i, '[data-field="customer"]'],
  [/reason/i, '[data-field="reason"]'],
  [/date|period/i, "#ds-date"],
];

export function DisposalPanel({ data }: { data: DisposalFormData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [customers, addCustomer] = useWithAdded(data.customers);
  const [kind, setKind] = useState<DisposalKind>("sale");
  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [customerId, setCustomerId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [reversing, setReversing] = useState<DisposalFormData["disposals"][number] | null>(null);

  const asset = data.assets.find((a) => a.id === assetId);
  const proceeds = kind === "sale" ? Number(price) || 0 : 0;
  const amounts = asset ? disposalAmounts({ cost: asset.cost, accumulated: asset.accumulated, proceeds, vatRate: kind === "sale" && taxable ? data.vatRate : 0 }) : null;

  async function save() {
    if (!assetId) return report("Choose the asset.", '[data-field="asset"]');
    setSaving(true);
    try {
      const r = await createAssetDisposal({ assetId, kind, disposalDate: date, customerId: customerId || null, invoiceNumber: invoice, taxable, salePrice: proceeds, receivedAccountId: accountId || null, reason });
      if (!r.ok) return report(r.error, SERVER_RULES.find(([re]) => re.test(r.error))?.[1] ?? null);
      setDone(`${r.reference} was recorded. ${r.gainLoss === 0 ? "There is no gain or loss." : `${r.gainLoss > 0 ? "Gain" : "Loss"} on disposal: ${money(Math.abs(r.gainLoss))}.`}`);
      setAssetId("");
      setPrice("");
      setReason("");
      setInvoice("");
      setCustomerId("");
    } catch (e) {
      reportError(e, SERVER_RULES);
    } finally {
      setSaving(false);
    }
  }

  async function reverse() {
    const row = reversing;
    setReversing(null);
    if (!row) return;
    try {
      const r = await reverseAssetDisposalAction(row.id);
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  if (!data.canCreate)
    return <p className={`${card} p-6 text-sm text-[var(--text-secondary)]`}>You don&apos;t have permission to sell or dispose of assets.</p>;

  return (
    <div className="space-y-4">
      <section className={`${card} p-4`}>
        <div className="mb-4 inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} className={`rounded-full px-4 py-1.5 text-sm transition-colors ${kind === k.id ? "bg-[var(--card-bg)] font-medium text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
              {k.title}
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs text-[var(--text-secondary)]">{KINDS.find((k) => k.id === kind)!.help}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={label}>Asset *</label>
            <select data-field="asset" className={input} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Select asset</option>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.assetCode} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{kind === "sale" ? "Sale date" : kind === "write_off" ? "Write-off date" : "Disposal date"} *</label>
            <DatePicker id="ds-date" max={todayIso()} value={date} onChange={setDate} className={input} />
          </div>

          {kind === "sale" ? (
            <>
              <div>
                <label className={label}>Buyer</label>
                <div data-field="customer" data-opens>
                  <CustomerSelect value={customerId} options={customers} onChange={setCustomerId} onAdded={addCustomer} className={input} />
                </div>
              </div>
              <div>
                <label className={label}>Invoice number</label>
                <input className={input} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className={label}>Sale price (before VAT) *</label>
                <input data-field="price" type="number" min="0" step="0.01" className={input} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              {data.vatRate > 0 && (
                <div>
                  <label className={label}>VAT</label>
                  <select className={input} value={taxable ? "taxable" : "none"} onChange={(e) => setTaxable(e.target.value === "taxable")}>
                    <option value="taxable">Taxable ({data.vatRate}%)</option>
                    <option value="none">No VAT</option>
                  </select>
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={label}>Money received into *</label>
                <select data-field="account" className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Select cash or bank account</option>
                  {data.cashBankAccounts.map((g) =>
                    g.children.length === 0 ? (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ) : (
                      <optgroup key={g.id} label={g.name}>
                        {g.children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )
                  )}
                </select>
              </div>
            </>
          ) : (
            <div className="sm:col-span-3">
              <label className={label}>Reason *</label>
              <input data-field="reason" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "write_off" ? "e.g. Destroyed in a fire" : "e.g. Scrapped after breakdown"} />
            </div>
          )}
        </div>

        {asset && amounts && (
          <dl className="mt-5 grid max-w-md gap-1 text-sm">
            <Row k="Cost" v={money(asset.cost)} />
            <Row k="Accumulated depreciation" v={money(asset.accumulated)} />
            <Row k="Net book value" v={money(amounts.netBookValue)} bold />
            {kind === "sale" && (
              <>
                <Row k="Sale price" v={money(proceeds)} />
                {amounts.vat > 0 && <Row k={`VAT (${data.vatRate}%)`} v={money(amounts.vat)} />}
                <Row k="Money received" v={money(amounts.total)} />
              </>
            )}
            <Row k={amounts.gainLoss >= 0 ? "Gain on disposal" : "Loss on disposal"} v={money(Math.abs(amounts.gainLoss))} bold />
          </dl>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {saving ? "Saving..." : kind === "sale" ? "Record sale" : kind === "write_off" ? "Write off asset" : "Record disposal"}
          </button>
        </div>
      </section>

      <section className={`${card} overflow-x-auto`}>
        <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">Sales, disposals and write-offs</h2>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Asset</th>
              <th className="px-4 py-2 font-medium">Buyer</th>
              <th className="px-4 py-2 text-right font-medium">Sale price</th>
              <th className="px-4 py-2 text-right font-medium">Net book value</th>
              <th className="px-4 py-2 text-right font-medium">Gain / (loss)</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.disposals.map((d) => (
              <tr key={d.id} className={`border-t border-[var(--card-border)] ${d.status === "reversed" ? "opacity-50" : ""}`}>
                <td className="px-4 py-2 font-medium">{d.reference}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  <D value={d.disposalDate} />
                </td>
                <td className="px-4 py-2">{KIND_LABEL[d.kind]}</td>
                <td className="px-4 py-2">
                  <Link href={`/assets/${d.assetId}`} className="text-[var(--color-primary)] hover:underline">
                    {d.assetCode}
                  </Link>{" "}
                  {d.assetName}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{d.customerName ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.kind === "sale" ? money(d.saleAmount) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(d.netBookValue)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${d.gainLoss < 0 ? "text-red-600" : ""}`}>{d.gainLoss < 0 ? `(${money(-d.gainLoss)})` : money(d.gainLoss)}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={d.status === "posted" ? "success" : "critical"}>{d.status === "posted" ? "Posted" : "Reversed"}</StatusPill>
                </td>
                <td className="px-4 py-2 text-right">
                  {data.canReverse && d.status === "posted" && (
                    <button type="button" onClick={() => setReversing(d)} className="text-sm text-red-600 hover:underline">
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.disposals.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No asset has been sold, disposed of or written off yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {reversing && <ConfirmDialog message={`Reverse ${reversing.reference}? Its accounting entry is reversed and ${reversing.assetCode} is back on the register.`} onYes={reverse} onNo={() => setReversing(null)} />}
      {done && (
        <InfoDialog
          message={done}
          onOk={() => {
            setDone(null);
            router.refresh();
          }}
        />
      )}
      {dialog}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-[var(--card-border)] pt-1 font-semibold" : ""}`}>
      <dt className="text-[var(--text-secondary)]">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
