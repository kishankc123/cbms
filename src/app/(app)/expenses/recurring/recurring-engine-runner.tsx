"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runRecurringExpensesEngine } from "./actions";

/**
 * Runs the recurrence engine once when the Recurring Expenses page is visited —
 * the app's stand-in for a cron job (there isn't one anywhere in this codebase).
 * The engine itself is idempotent (unique period keys, expenseId-null checks), so
 * this firing more than once — a fast-refresh remount, two tabs open — is harmless,
 * but the effect still only runs once per mount to keep it from looping.
 */
export function RecurringEngineRunner() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    runRecurringExpensesEngine()
      .then((result) => {
        if (result.scheduled > 0 || result.recognized > 0) router.refresh();
      })
      .catch(() => {
        // Best-effort: a failed run just means the page shows what was already
        // there — the next visit tries again, nothing is lost or duplicated.
      });
  }, [router]);

  return null;
}
