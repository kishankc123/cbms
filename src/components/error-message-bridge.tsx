"use client";

import { installClientErrorMessages } from "@/lib/user-facing-errors";

// Installed while this module loads, before the page can call any server action, so a failed action's real
// reason reaches the dialog instead of the generic "Minified React error #441". See lib/user-facing-errors.ts.
installClientErrorMessages();

export function ErrorMessageBridge() {
  return null;
}
