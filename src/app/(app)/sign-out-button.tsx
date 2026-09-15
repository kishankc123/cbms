"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full text-left text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
    >
      Sign out
    </button>
  );
}
