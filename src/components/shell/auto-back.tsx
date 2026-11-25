"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { backTarget } from "@/lib/back-target";

/**
 * The round back button in the top bar, for every page below a section page. It goes to the page one level up (see lib/back-target.ts). A page that already
 * shows its own back button (marked data-page-back) keeps that one and this stays out of the way, so there are never two. It stays hidden until the page
 * has been checked, so a page with its own button never shows this one for a moment.
 */
export function AutoBack() {
  const pathname = usePathname();
  const target = backTarget(pathname);
  const [ownBack, setOwnBack] = useState(true);

  useEffect(() => {
    const main = document.querySelector("main");
    const check = () => setOwnBack(Boolean(main?.querySelector("[data-page-back]")));
    check();
    // A page can finish drawing a moment later; keep looking for a few seconds, then stop.
    if (!main) return;
    const watch = new MutationObserver(check);
    watch.observe(main, { childList: true, subtree: true });
    const stop = window.setTimeout(() => watch.disconnect(), 4000);
    return () => {
      watch.disconnect();
      window.clearTimeout(stop);
    };
  }, [pathname]);

  if (!target || ownBack) return null;
  return <BackButton href={target.href} label={target.label} className="mr-1 print:hidden" />;
}
