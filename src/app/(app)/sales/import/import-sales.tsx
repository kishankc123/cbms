"use client";

import { useEffect, useMemo, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import type { SalesColumnMapping } from "@/lib/sales/import/fields";
import type { CheckResult, DateOptions, FileAnalysis, GroupDecision, ImportSettings, Overrides, ReviewResult, RunResult } from "@/lib/sales/import/types";
import { analyzeFile, checkImport, downloadTemplate, getImportSetup, reviewFile, runImport, undoImport, type ImportSetup } from "./actions";
import { CheckDialog } from "./check-dialog";
import { DoneStep } from "./done-step";
import { HistoryList } from "./history-list";
import { ReviewStep } from "./review-step";
import { salesColumnGuide } from "@/lib/sales/import/column-guide";
import { UploadStep } from "./upload-step";

type Step = "upload" | "review" | "done";
export type File = { name: string; base64: string };

const DEFAULT_SETTINGS: ImportSettings = { amountsIncludeVat: false, defaultBillType: "taxable", paidMode: "file", defaultAccountId: null };
const DEFAULT_DATES: DateOptions = { choice: "auto", dayFirst: true, allowMixed: false };
export const MAX_FILE_BYTES = 2.5 * 1024 * 1024;

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file couldn't be read."));
    reader.readAsDataURL(file);
  });
}

// Import Sales: Upload -> Review -> Done. The file stays in the browser and is sent with each step; the server re-reads and
// re-checks it every time, so what is shown is always what would be posted.
export function ImportSales() {
  const { reportError, dialog } = useProblem();
  const [setup, setSetup] = useState<ImportSetup | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const [mapping, setMapping] = useState<SalesColumnMapping>({});
  const [dateOptions, setDateOptions] = useState<DateOptions>(DEFAULT_DATES);
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_SETTINGS);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, GroupDecision>>({});
  const [skipRows, setSkipRows] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Extract<RunResult, { ok: true }> | null>(null);

  useEffect(() => {
    let live = true;
    getImportSetup().then((s) => live && setSetup(s)).catch((e) => live && reportError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runReview(f: File, m: SalesColumnMapping, d: DateOptions, s: ImportSettings, o: Overrides = overrides) {
    setBusy(true);
    try {
      const r = await reviewFile({ fileName: f.name, base64: f.base64, mapping: m, dateOptions: d, settings: s, overrides: o });
      setReview(r);
      return r;
    } catch (e) {
      // A missing column is a message to act on in the column panel, not a crash.
      setReview(null);
      reportError(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onFile(picked: Blob & { name: string }) {
    if (picked.size > MAX_FILE_BYTES) return reportError(new Error("That file is larger than 2.5 MB. Split it and import the parts one at a time."));
    setBusy(true);
    try {
      const f = { name: picked.name, base64: await readBase64(picked) };
      const a = await analyzeFile({ fileName: f.name, base64: f.base64 });
      setFile(f);
      setAnalysis(a);
      setMapping(a.mapping);
      setDateOptions(DEFAULT_DATES);
      setDecisions({});
      setSkipRows([]);
      setOverrides({});
      setIncludeDuplicates(false);
      setStep("review");
      if (a.mappingComplete && !a.dates.blocking) await runReview(f, a.mapping, DEFAULT_DATES, settings, {});
      else setReview(null);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  const changeMapping = (m: SalesColumnMapping) => {
    setMapping(m);
    if (file) void runReview(file, m, dateOptions, settings);
  };
  const changeDates = (d: DateOptions) => {
    setDateOptions(d);
    if (file) void runReview(file, mapping, d, settings);
  };
  const changeOverrides = (o: Overrides) => {
    setOverrides(o);
    if (file) void runReview(file, mapping, dateOptions, settings, o);
  };
  const changeSettings = (s: ImportSettings) => {
    setSettings(s);
    if (file) void runReview(file, mapping, dateOptions, s);
  };

  // What the review's rows come to once the decisions made here are applied (the server confirms it all again on import).
  const effective = useMemo(() => {
    if (!review) return null;
    const skipped = new Set(skipRows);
    return review.rows.map((r) => {
      let status = r.status;
      const d = r.customerKey ? decisions[r.customerKey] : undefined;
      if (skipped.has(r.rowNumber)) status = "skipped";
      else if (d?.action === "skip") status = "skipped";
      else if (status === "attention" && r.issues.length === 1 && r.issues[0] === "customer" && r.customerKey && d) status = "ready";
      return { ...r, status };
    });
  }, [review, decisions, skipRows]);

  const toImport = effective ? effective.filter((r) => r.status === "ready" || (includeDuplicates && r.status === "duplicate")).length : 0;

  async function doCheck() {
    if (!file) return;
    setBusy(true);
    try {
      setCheckResult(await checkImport({ fileName: file.name, base64: file.base64, mapping, dateOptions, settings, decisions, skipRows, includeDuplicates, overrides }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  // Back to the review with the same file and decisions: what was imported now shows as already in the books, and the
  // rows that were refused are still there to correct.
  async function fixRest() {
    if (!file) return;
    setResult(null);
    setStep("review");
    setIncludeDuplicates(false);
    await runReview(file, mapping, dateOptions, settings);
  }

  async function doImport() {
    if (!file || !effective) return;
    setCheckResult(null);
    setBusy(true);
    try {
      const r = await runImport({ fileName: file.name, base64: file.base64, mapping, dateOptions, settings, decisions, skipRows, includeDuplicates, overrides });
      if (!r.ok) return reportError(new Error(r.error));
      setResult(r);
      setStep("done");
      getImportSetup().then(setSetup).catch(() => {});
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setAnalysis(null);
    setReview(null);
    setResult(null);
    setDecisions({});
    setSkipRows([]);
    setOverrides({});
  }

  const steps: [Step, string][] = [
    ["upload", "1  Upload"],
    ["review", "2  Review"],
    ["done", "3  Done"],
  ];

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map(([id, label]) => (
          <li key={id} className={`rounded-full px-3 py-1 ${step === id ? "bg-[var(--color-primary)] text-white" : "bg-[var(--surface-muted-bg)] text-[var(--text-secondary)]"}`}>
            {label}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <>
          <UploadStep
            busy={busy}
            guide={salesColumnGuide()}
            onFile={onFile}
            onTemplate={downloadTemplate}
            rowNoun="invoice"
            pasteExample={"Date\tCustomer\tAmount\n2083-04-15\tHimal Enterprises\t10000"}
            notes={[
              "Columns and dates (AD or BS) are matched for you. You only fix what can't be read.",
              "Customers in the file are matched to yours; new names are created only if you tick them.",
              "Invoices are numbered automatically, continuing your sequence, and post exactly like Multi-Invoice.",
              "You can undo a whole import afterwards.",
            ]}
          />
          {setup && setup.history.length > 0 && <HistoryList history={setup.history} canUndo={setup.canUndo} onChanged={() => getImportSetup().then(setSetup)} onUndo={undoImport} noun="invoice" />}
        </>
      )}

      {step === "review" && file && analysis && (
        <ReviewStep
          file={file}
          analysis={analysis}
          setup={setup}
          mapping={mapping}
          onMapping={changeMapping}
          dateOptions={dateOptions}
          onDates={changeDates}
          settings={settings}
          onSettings={changeSettings}
          review={review}
          rows={effective}
          decisions={decisions}
          onDecisions={setDecisions}
          skipRows={skipRows}
          onSkipRows={setSkipRows}
          overrides={overrides}
          onOverrides={changeOverrides}
          onCheck={doCheck}
          includeDuplicates={includeDuplicates}
          onIncludeDuplicates={setIncludeDuplicates}
          toImport={toImport}
          busy={busy}
          onImport={doImport}
          onBack={reset}
        />
      )}

      {step === "done" && result && (
        <DoneStep result={{ ...result, created: result.customersCreated }} onAnother={reset} onFix={fixRest} noun="invoice" viewHref="/sales/invoices" createdLabel="New customers created" />
      )}
      {checkResult && (
        <CheckDialog
          result={{ wouldImport: checkResult.wouldImport, total: checkResult.total, tax: checkResult.tax, newParties: checkResult.customersToCreate, skipped: checkResult.skipped }}
          busy={busy}
          onClose={() => setCheckResult(null)}
          onImport={doImport}
          noun="invoice"
          partyLabel="customers"
        />
      )}
      {dialog}
    </div>
  );
}
