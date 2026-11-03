"use client";

import { signOut } from "next-auth/react";
import { friendlyMessage } from "@/lib/user-facing-errors";

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  const isTenantScope = error.message === "No tenant scope on session";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-4 text-center">
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">
          {isTenantScope ? "No client selected" : "Something went wrong"}
        </h1>
        <p className="text-sm text-gray-500">
          {isTenantScope
            ? "This account isn't scoped to a client, so there are no books to show here. Super Admin support/impersonation mode isn't built yet."
            : friendlyMessage(error.message, error.digest)}
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50 w-full"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
