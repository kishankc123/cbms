"use client";

import { useEffect, useMemo, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import type { ExpenseCheckResult, ExpenseImportSettings, ExpenseOverrides, ExpenseReviewResult, ExpenseRunInput } from "@/lib/expenses/import/types";
import type { CategoryDecision, SupplierDecision } from "@/lib/purchases/import/types";
import { CheckDialog } from "../../sales/import/check-dialog";
import { DoneStep, type DoneResult } from "../../sales/import/done-step";
import { HistoryList } from "../../sales/import/history-list";
import { expenseColumnGuide } from "@/lib/sales/import/column-guide";
import { UploadStep } from "../../sales/import/upload-step";
import { checkExpenses, downloadExpenseTemplate, finishExpenses, getExpenseImportSetup, importExpensesChunk, prepareExpenses, reviewExpenses, undoExpenseImport, type ExpenseImportSetup } from "./actions";
import { ReviewStep } from "./review-step";

type Step = "upload" | "review" | "done";
export type ExpenseFile = { name: string; base64: string };

const MAX_FILE_BYTES = 2.5 * 1024 * 1024;
const SLICE = 10;

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file couldn't be read."));
    reader.readAsDataURL(file);
  });
}

// Import Purchases: Upload -> Review -> Done, the same flow as Import Sales. The posting is done in slices (with a progress
// bar) so a long file can't run past the time one request is allowed.
export function ImportExpenses() {
  const { reportError, dialog } = useProblem();
  const [setup, setSetup] = useState<ExpenseImportSetup | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<ExpenseFile | null>(null);
  const [settings, setSettings] = useState<ExpenseImportSettings>({ amountsIncludeVat: false, defaultBillType: "vat", paidMode: "file", defaultAccountId: null, defaultCategoryId: null });
  const [review, setReview] = useState<ExpenseReviewResult | null>(null);
  const [supplierDecisions, setSupplierDecisions] = useState<Record<string, SupplierDecision>>({});
  const [categoryDecisions, setCategoryDecisions] = useState<Record<string, CategoryDecision>>({});
  const [skipRows, setSkipRows] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<ExpenseOverrides>({});
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [checkResult, setCheckResult] = useState<ExpenseCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<DoneResult | null>(null);

  useEffect(() => {
    let live = true;
    getExpenseImportSetup()
      .then((s) => {
        if (!live) return;
        setSetup(s);
        // A VAT-registered organization usually buys on VAT bills; otherwise PAN bills are the common case.
        setSettings((cur) => ({ ...cur, defaultBillType: s.vatClaimable ? "vat" : "pan" }));
      })
      .catch((e) => live && reportError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runReview(f: ExpenseFile, s: ExpenseImportSettings, o: ExpenseOverrides = overrides) {
    setBusy(true);
    try {
      const r = await reviewExpenses({ fileName: f.name, base64: f.base64, settings: s, overrides: o });
      setReview(r);
      return r;
    } catch (e) {
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
      setSupplierDecisions({});
      setCategoryDecisions({});
      setSkipRows([]);
      setOverrides({});
      setIncludeDuplicates(false);
      // The review reads the template's columns; a file that doesn't follow the template is refused here, with the reason.
      if (await runReview(f, settings, {})) {
        setFile(f);
        setStep("review");
      }
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  const changeSettings = (s: ExpenseImportSettings) => {
    setSettings(s);
    if (file) void runReview(file, s);
  };
  const changeOverrides = (o: ExpenseOverrides) => {
    setOverrides(o);
    if (file) void runReview(file, settings, o);
  };

  // What the review's rows come to once the decisions made here are applied (the server confirms it all again on import).
  const effective = useMemo(() => {
    if (!review) return null;
    const skipped = new Set(skipRows);
    return review.rows.map((r) => {
      let status = r.status;
      const sd = r.supplierKey ? supplierDecisions[r.supplierKey] : undefined;
      const cd = r.categoryKey ? categoryDecisions[r.categoryKey] : undefined;
      if (skipped.has(r.rowNumber) || sd?.action === "skip" || cd?.action === "skip") status = "skipped";
      else if (status === "attention" && r.issues.length > 0 && r.issues.every((i) => (i === "supplier" && r.supplierKey && sd) || (i === "category" && r.categoryKey && cd))) status = "ready";
      return { ...r, status };
    });
  }, [review, supplierDecisions, categoryDecisions, skipRows]);

  const toImport = effective ? effective.filter((r) => r.status === "ready" || (includeDuplicates && r.status === "duplicate")).length : 0;
  const runInput = (): ExpenseRunInput => ({ fileName: file!.name, base64: file!.base64, settings, supplierDecisions, categoryDecisions, skipRows, includeDuplicates, overrides });

  async function doCheck() {
    if (!file) return;
    setBusy(true);
    try {
      setCheckResult(await checkExpenses(runInput()));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!file || !effective) return;
    setCheckResult(null);
    setBusy(true);
    try {
      const input = runInput();
      const prep = await prepareExpenses(input);
      if (!prep.ok) return reportError(new Error(prep.error));

      let imported = 0;
      let stopped: { rowNumber: number; message: string } | null = null;
      setProgress({ done: 0, total: prep.rowNumbers.length });
      for (let i = 0; i < prep.rowNumbers.length && !stopped; i += SLICE) {
        const r = await importExpensesChunk({ ...input, supplierDecisions: prep.supplierDecisions, importId: prep.importId, rowNumbers: prep.rowNumbers.slice(i, i + SLICE) });
        if (!r.ok) {
          stopped = { rowNumber: prep.rowNumbers[i], message: r.error };
          break;
        }
        imported += r.imported;
        stopped = r.stopped;
        setProgress({ done: imported, total: prep.rowNumbers.length });
      }
      const done = await finishExpenses({ importId: prep.importId, stopped: Boolean(stopped) });
      setResult({ imported: done?.imported ?? imported, total: done?.total ?? 0, skipped: prep.skipped, stopped, created: prep.suppliersCreated });
      setStep("done");
      getExpenseImportSetup().then(setSetup).catch(() => {});
    } catch (e) {
      reportError(e);
    } finally {
      setProgress(null);
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
    await runReview(file, settings);
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setReview(null);
    setResult(null);
    setSupplierDecisions({});
    setCategoryDecisions({});
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
            guide={expenseColumnGuide()}
            onFile={onFile}
            onTemplate={downloadExpenseTemplate}
            rowNoun="expense"
            pasteExample={"Date\tSupplier\tCategory\tAmount\n15/04/2083\tHimal Traders\tStationery\t5000"}
            notes={[
              "Download the template, paste your rows into it and upload it. Dates are written dd/mm/yyyy (AD or BS). An expense paid in parts uses the extra Paid amount and account columns.",
              "Suppliers and categories in the file are matched to yours; new suppliers are created only if you tick them.",
              "Expenses post exactly like Add Expense: VAT, TDS, payments and your audit rules all apply.",
              "You can undo a whole import afterwards.",
            ]}
          />
          {setup && setup.history.length > 0 && <HistoryList history={setup.history} canUndo={setup.canUndo} onChanged={() => getExpenseImportSetup().then(setSetup)} onUndo={undoExpenseImport} noun="expense" />}
        </>
      )}

      {step === "review" && file && (
        <>
          {progress && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
              <p className="text-sm text-[var(--text-primary)]">
                Importing... {progress.done} of {progress.total} expenses
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--surface-muted-bg)]">
                <div className="h-full bg-[var(--color-primary)] transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}
          <ReviewStep
            file={file}
            setup={setup}
            settings={settings}
            onSettings={changeSettings}
            review={review}
            rows={effective}
            supplierDecisions={supplierDecisions}
            onSupplierDecisions={setSupplierDecisions}
            categoryDecisions={categoryDecisions}
            onCategoryDecisions={setCategoryDecisions}
            skipRows={skipRows}
            onSkipRows={setSkipRows}
            overrides={overrides}
            onOverrides={changeOverrides}
            includeDuplicates={includeDuplicates}
            onIncludeDuplicates={setIncludeDuplicates}
            toImport={toImport}
            busy={busy}
            onImport={doImport}
            onCheck={doCheck}
            onBack={reset}
          />
        </>
      )}

      {step === "done" && result && <DoneStep result={result} onAnother={reset} onFix={fixRest} noun="expense" viewHref="/expenses" createdLabel="New suppliers created" />}
      {checkResult && (
        <CheckDialog
          result={{ wouldImport: checkResult.wouldImport, total: checkResult.total, tax: checkResult.tax, newParties: checkResult.suppliersToCreate, skipped: checkResult.skipped }}
          busy={busy}
          onClose={() => setCheckResult(null)}
          onImport={doImport}
          noun="expense"
          partyLabel="suppliers"
        />
      )}
      {dialog}
    </div>
  );
}
