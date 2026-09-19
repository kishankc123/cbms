"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full text-left text-sm text-[var(--sidebar-text)] hover:text-white px-3 py-2"
    >
      Sign out
    </button>
  );
}
