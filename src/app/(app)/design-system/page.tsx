import { guardView } from "@/components/page-guard";
import { DesignSystemDemo } from "./design-system-demo";

// A reference page for the shared components (src/components/ui): not part of the menu. Open it at /design-system to
// check a component in both themes before using it on a screen. Shown to anyone who can open Settings.
export default async function DesignSystemPage() {
  const denied = await guardView("settings");
  if (denied) return denied;
  return <DesignSystemDemo />;
}
