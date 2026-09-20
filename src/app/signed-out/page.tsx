"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";

// Landing spot when a still-signed token is no longer valid (account disabled,
// password reset elsewhere...). Clears the session so /login doesn't bounce
// straight back into the app.
export default function SignedOutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">Your session has ended. Redirecting to sign in...</p>
    </div>
  );
}
