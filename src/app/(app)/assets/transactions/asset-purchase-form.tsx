"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/calendar/date-picker";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { useProblem, type FieldRules } from "@/components/problem-dialog";
import { InfoDialog } from "../../inventory/info-dialog";
import { RecordPayModal } from "../../purchases/record-pay-modal";
import { assetPurchaseAmounts } from "@/lib/assets/amounts";
import { todayIso } from "@/lib/calendar";
import { createAssetPurchase, type AssetPurchaseFormData } from "../actions";
import { METHOD_LABEL, money } from "../shared";

type PaymentLine = { accountId: string; amount: number; modeId?: string | null };
type Method = "straight_line" | "declining_balance" | "none";

const BILL_TYPES = [
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "no_bill", label: "No bill" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
] as const;

const input = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const section = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4";
const label = "mb-1 block text-xs text-gray-500";

// Which field a message from the server is about, so the cursor can be put there after the message is read.
const SERVER_RULES: FieldRules = [
  [/asset code/i, '[data-field="code"]'],
  [/asset name/i, '[data-field="name"]'],
  [/categor/i, '[data-field="category"]'],
  [/location/i, '[data-field="location"]'],
  [/available-for-use/i, "#ap-available"],
  [/purchase date|closed period|period/i, "#ap-date"],
  [/supplier/i, '[data-field="supplier"]'],
  [/bill number|invoice number|already recorded/i, '[data-field="invoice"]'],
  [/purchase price/i, '[data-field="price"]'],
  [/freight/i, '[data-field="freight"]'],
  [/installation/i, '[data-field="installation"]'],
  [/other cost/i, '[data-field="other"]'],
  [/useful life/i, '[data-field="years"]'],
  [/residual/i, '[data-field="residual"]'],
  [/start date/i, "#ap-start"],
  [/payment|cash or bank/i, '[data-field="pay"]'],
];

const num = (v: string) => (v.trim() === "" ? 0 : Number(v) || 0);

export function AssetPurchaseForm({ data }: { data: AssetPurchaseFormData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [vendors, addVendor] = useWithAdded(data.vendors);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [description, setDescription] = useState("");

  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [availableDate, setAvailableDate] = useState(todayIso());
  const [availableTouched, setAvailableTouched] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [reference, setReference] = useState("");
  const [document, setDocument] = useState("");
  const [billType, setBillType] = useState<(typeof BILL_TYPES)[number]["value"]>(data.vatClaimable ? "vat" : "pan");

  const [price, setPrice] = useState("");
  const [freight, setFreight] = useState("");
  const [installation, setInstallation] = useState("");
  const [other, setOther] = useState("");

  const [method, setMethod] = useState<Method>("straight_line");
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [residual, setResidual] = useState("");
  const [residualTouched, setResidualTouched] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTouched, setStartTouched] = useState(false);

  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [showPay, setShowPay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ assetId: string; assetCode: string } | null>(null);

  const category = data.categories.find((c) => c.id === categoryId);
  const vatRate = billType === "vat" ? data.vatRate : 0;
  const costs = { purchasePrice: num(price), freightCost: num(freight), installationCost: num(installation), otherCost: num(other) };
  const amounts = assetPurchaseAmounts(costs, vatRate, data.vatClaimable);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(amounts.total - paid, 0);
  const lifeMonths = num(years) * 12 + num(months);

  // A residual value left untouched follows the category's percentage of whatever the cost works out to.
  const residualValue = residualTouched ? num(residual) : Math.round(((category?.residualPercent ?? 0) / 100) * amounts.capitalizedCost * 100) / 100;
  const effectiveStart = startTouched ? startDate : availableDate;

  function chooseCategory(id: string) {
    setCategoryId(id);
    const c = data.categories.find((x) => x.id === id);
    if (!c) return;
    setMethod(c.method);
    setYears(c.lifeMonths ? String(Math.floor(c.lifeMonths / 12)) : "");
    setMonths(c.lifeMonths ? String(c.lifeMonths % 12 || "") : "");
    setResidualTouched(false);
  }

  function reset() {
    setName("");
    setCode("");
    setCategoryId("");
    setLocationId("");
    setDescription("");
    setPurchaseDate(todayIso());
    setAvailableDate(todayIso());
    setAvailableTouched(false);
    setVendorId("");
    setInvoiceNumber("");
    setPoNumber("");
    setReference("");
    setDocument("");
    setPrice("");
    setFreight("");
    setInstallation("");
    setOther("");
    setMethod("straight_line");
    setYears("");
    setMonths("");
    setResidual("");
    setResidualTouched(false);
    setStartDate("");
    setStartTouched(false);
    setPayments([]);
  }

  async function save() {
    // Quick checks in page order, so the message appears before a round trip.
    if (!name.trim()) return report("Enter the asset name.", '[data-field="name"]');
    if (!categoryId) return report("Choose an asset category.", '[data-field="category"]');
    if (!vendorId) return report("Select the supplier you bought this asset from.", '[data-field="supplier"]');
    if (!(costs.purchasePrice > 0)) return report("Enter the purchase price.", '[data-field="price"]');
    if (method !== "none" && lifeMonths < 1) return report("Enter the useful life (at least one month).", '[data-field="years"]');

    setSaving(true);
    try {
      const result = await createAssetPurchase({
        name,
        description,
        categoryId,
        locationId: locationId || null,
        assetCode: code,
        purchaseDate,
        availableForUseDate: availableDate,
        vendorId,
        invoiceNumber,
        purchaseOrderNumber: poNumber,
        purchaseReference: reference,
        supportingDocument: document,
        billType,
        ...costs,
        method,
        usefulLifeMonths: method === "none" ? null : lifeMonths,
        residualValue: method === "none" ? 0 : residualValue,
        depreciationStartDate: method === "none" ? null : effectiveStart || availableDate,
        payments,
      });
      if (!result.ok) return report(result.error, SERVER_RULES.find(([re]) => re.test(result.error))?.[1] ?? null);
      setSaved({ assetId: result.assetId, assetCode: result.assetCode });
      reset();
    } catch (e) {
      reportError(e, SERVER_RULES);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Asset details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={label}>Asset name *</label>
            <input data-field="name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dell Latitude laptop" />
          </div>
          <div>
            <label className={label}>Asset code</label>
            <input data-field="code" className={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder={data.autoGenerateCode ? `${data.nextCode} (automatic)` : "Enter a code"} />
          </div>
          <div>
            <label className={label}>Accounting category *</label>
            <select data-field="category" className={input} value={categoryId} onChange={(e) => chooseCategory(e.target.value)}>
              <option value="">Select category</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Location</label>
            <select data-field="location" className={input} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">No location</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className={label}>Description</label>
            <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </section>

      <section className={section}>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Purchase</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className={label}>Purchase date *</label>
            <DatePicker
              id="ap-date"
              max={todayIso()}
              value={purchaseDate}
              onChange={(v) => {
                setPurchaseDate(v);
                if (!availableTouched || availableDate < v) setAvailableDate(v);
              }}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Available-for-use date *</label>
            <DatePicker
              id="ap-available"
              min={purchaseDate}
              value={availableDate}
              onChange={(v) => {
                setAvailableDate(v);
                setAvailableTouched(true);
              }}
              className={input}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Supplier *</label>
            <div data-field="supplier" data-opens>
              <SupplierSelect value={vendorId} options={vendors} onChange={setVendorId} onAdded={addVendor} className={input} />
            </div>
          </div>
          <div>
            <label className={label}>Invoice number</label>
            <input data-field="invoice" className={input} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Automatic if empty" />
          </div>
          <div>
            <label className={label}>Purchase order number</label>
            <input className={input} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div>
            <label className={label}>Purchase reference</label>
            <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bill type</label>
            <select className={input} value={billType} onChange={(e) => setBillType(e.target.value as typeof billType)}>
              {BILL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className={label}>Supporting document (reference)</label>
            <input className={input} value={document} onChange={(e) => setDocument(e.target.value)} placeholder="Link or file name" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={section}>
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Cost</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Purchase price *</label>
              <input data-field="price" type="number" min="0" step="0.01" className={input} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className={label}>Freight</label>
              <input data-field="freight" type="number" min="0" step="0.01" className={input} value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div>
              <label className={label}>Installation</label>
              <input data-field="installation" type="number" min="0" step="0.01" className={input} value={installation} onChange={(e) => setInstallation(e.target.value)} />
            </div>
            <div>
              <label className={label}>Other directly attributable cost</label>
              <input data-field="other" type="number" min="0" step="0.01" className={input} value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--text-secondary)]">Invoice subtotal</dt>
              <dd className="tabular-nums">{money(amounts.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-secondary)]">VAT {vatRate > 0 ? `(${vatRate}%)` : ""}</dt>
              <dd className="tabular-nums">{money(amounts.vat)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-secondary)]">Invoice total</dt>
              <dd className="tabular-nums">{money(amounts.total)}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--card-border)] pt-2 font-semibold">
              <dt className="text-[var(--text-primary)]">Capitalized cost</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">{money(amounts.capitalizedCost)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {amounts.vat > 0
              ? data.vatClaimable
                ? "Recoverable input VAT is booked to Tax Receivable, not to the asset's cost."
                : "Your organization isn't VAT-registered, so this VAT can't be claimed and is added to the asset's cost."
              : "No VAT on this bill."}
          </p>
        </section>

        <section className={section}>
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Accounting depreciation</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Method</label>
              <select className={input} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {Object.entries(METHOD_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            {method !== "none" && (
              <>
                <div>
                  <label className={label}>Useful life</label>
                  <div className="flex items-center gap-2">
                    <input data-field="years" type="number" min="0" step="1" className={input} value={years} onChange={(e) => setYears(e.target.value)} placeholder="Years" />
                    <input type="number" min="0" max="11" step="1" className={input} value={months} onChange={(e) => setMonths(e.target.value)} placeholder="Months" />
                  </div>
                </div>
                <div>
                  <label className={label}>Residual value</label>
                  <input
                    data-field="residual"
                    type="number"
                    min="0"
                    step="0.01"
                    className={input}
                    value={residualTouched ? residual : residualValue || ""}
                    onChange={(e) => {
                      setResidual(e.target.value);
                      setResidualTouched(true);
                    }}
                  />
                </div>
                <div>
                  <label className={label}>Depreciation start date</label>
                  <DatePicker
                    id="ap-start"
                    value={effectiveStart}
                    onChange={(v) => {
                      setStartDate(v);
                      setStartTouched(true);
                    }}
                    className={input}
                  />
                </div>
              </>
            )}
          </div>
          {method !== "none" && lifeMonths > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {METHOD_LABEL[method]} over {lifeMonths} month{lifeMonths === 1 ? "" : "s"}. Defaults come from the category and can be changed here.
            </p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className={`${section} w-72`}>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Settlement</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Payment status</span>
              <span className={paid <= 0 ? "font-medium text-gray-500" : outstanding <= 0.005 ? "font-medium text-green-700" : "font-medium text-amber-700"}>{paid <= 0 ? "Unpaid" : outstanding <= 0.005 ? "Paid" : "Partially paid"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Paid</span>
              <span className="tabular-nums">{money(paid)}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--card-border)] pt-1.5 font-semibold">
              <span className="text-[var(--text-primary)]">Outstanding</span>
              <span className="tabular-nums text-[var(--text-primary)]">{money(outstanding)}</span>
            </div>
          </div>
        </section>
        <div className="ml-auto flex items-center gap-3 self-end">
          <button type="button" data-field="pay" onClick={() => setShowPay(true)} className="whitespace-nowrap rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
            {payments.length > 0 ? "Edit Pay" : "Record Pay"}
          </button>
          <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50">
            {saving ? "Saving..." : "Save purchase"}
          </button>
        </div>
      </div>

      {showPay && (
        <RecordPayModal
          total={amounts.total}
          cashBankAccounts={data.cashBankAccounts}
          allVendors={vendors}
          vendorBalances={data.vendorBalances}
          initialVendorId={vendorId}
          initialLines={payments}
          saving={false}
          onCancel={() => setShowPay(false)}
          onConfirm={(p, chosenVendorId) => {
            setPayments(p);
            if (chosenVendorId) setVendorId(chosenVendorId);
            setShowPay(false);
          }}
        />
      )}

      {saved && (
        <InfoDialog
          message={`Asset ${saved.assetCode} was purchased and recorded.`}
          onOk={() => {
            const id = saved.assetId;
            setSaved(null);
            router.push(`/assets/${id}`);
          }}
        />
      )}
      {dialog}
    </div>
  );
}
