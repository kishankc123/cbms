"use client";

import { useState } from "react";
import { resendVerification } from "../verify-email/actions";

// Shown to a signed-in person whose email isn't verified yet: an organization can only add a verified account.
export function VerifyEmailNotice({ emailProblem }: { emailProblem?: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function resend() {
    const r = await resendVerification();
    setMsg(r.ok ? "Verification email sent." : r.error ?? "Could not send.");
  }

  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p>Verify your email address first. We sent you a link; an organization can only add you once it is verified.</p>
      {emailProblem && <p className="font-medium text-red-700">The verification email could not be sent: {emailProblem} Use Resend email to try again.</p>}
      <p className="flex items-center gap-3">
        <button type="button" onClick={resend} className="font-medium underline">
          Resend email
        </button>
        {msg && <span className="text-xs">{msg}</span>}
      </p>
    </div>
  );
}
