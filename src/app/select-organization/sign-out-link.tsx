"use client";

import { signOut } from "next-auth/react";

export function SignOutLink() {
  return (
    <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="text-gray-500 hover:text-gray-700">
      Sign out
    </button>
  );
}
