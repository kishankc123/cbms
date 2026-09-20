"use client";

import { useState } from "react";
import Link from "next/link";
import { verifyEmail } from "../actions";

export function VerifyForm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("loading");
    const r = await verifyEmail(token);
    if (r.ok) setState("done");
    else {
      setError(r.error ?? "Verification failed.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-green-700">Your email is verified.</p>
        <Link href="/dashboard" className="text-sm text-[var(--color-primary)] hover:underline">
          Continue
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Confirm that this is your email address.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={run} disabled={state === "loading"} className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium disabled:opacity-50">
        {state === "loading" ? "Verifying..." : "Verify email"}
      </button>
    </div>
  );
}
