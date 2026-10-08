"use client";

import { useState } from "react";
import { resendVerification } from "../verify-email/actions";

export function VerifyBanner({ emailProblem }: { emailProblem?: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function resend() {
    const r = await resendVerification();
    setMsg(r.ok ? "Verification email sent." : r.error ?? "Could not send.");
  }

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <span>
        Please verify your email address. You can&apos;t invite other users until it is verified.
        {emailProblem && <strong className="ml-1 text-red-700">The verification email could not be sent: {emailProblem} Use Resend email to try again.</strong>}
      </span>
      <span className="flex items-center gap-3">
        {msg && <span className="text-xs">{msg}</span>}
        <button type="button" onClick={resend} className="font-medium underline">
          Resend email
        </button>
      </span>
    </div>
  );
}
