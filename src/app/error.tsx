"use client";

import { signOut } from "next-auth/react";
import { friendlyMessage } from "@/lib/user-facing-errors";

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  const isTenantScope = error.message === "No tenant scope on session";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8 space-y-4 text-center">
        <h1 className="text-lg font-semibold text-gray-900">
          {isTenantScope ? "No client selected" : "Something went wrong"}
        </h1>
        <p className="text-sm text-gray-500">
          {isTenantScope
            ? "This account isn't scoped to a client, so there are no books to show here. Super Admin support/impersonation mode isn't built yet."
            : friendlyMessage(error.message, error.digest)}
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded py-2 text-sm font-medium"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
