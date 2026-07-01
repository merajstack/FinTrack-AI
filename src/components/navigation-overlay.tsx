"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GooeyLoader } from "@/components/ui/loader-10";

function isInternalNavigation(targetHref: string) {
  if (!targetHref) return false;
  if (targetHref.startsWith("#")) return false;
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(targetHref)) return false;

  try {
    const targetUrl = new URL(targetHref, window.location.href);
    return targetUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function NavigationOverlay() {
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  useEffect(() => {
    const showOverlay = () => setIsNavigating(true);

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!isInternalNavigation(href)) return;

      const nextUrl = new URL(href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search && nextUrl.hash === currentUrl.hash) {
        return;
      }

      showOverlay();
    };

    const handleSubmit = () => showOverlay();

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  if (!isNavigating) return null;

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center px-6"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(242, 240, 235, 0.66)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      />

      <div className="relative flex min-h-[220px] w-full max-w-sm flex-col items-center justify-center gap-4 border-4 border-black bg-[color:var(--card)] px-8 py-10 shadow-[10px_10px_0_#111]">
        <div className="flex h-20 w-20 items-center justify-center border-4 border-black bg-[color:var(--accent)] shadow-[6px_6px_0_#111]">
          <img src="/favicon.ico" alt="FinTrack" className="h-12 w-12 object-contain" />
        </div>

        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[color:var(--fg)]">
            Loading next page
          </p>
          <GooeyLoader
            className="scale-75 origin-center"
            primaryColor="#111111"
            secondaryColor="#ff4f00"
            borderColor="#111111"
          />
        </div>
      </div>
    </div>
  );
}
