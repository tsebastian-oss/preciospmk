"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { beaconUsageEvent, trackUsageEvent } from "@/lib/usage-client";

function deviceLabel() {
  if (typeof window === "undefined") return "unknown";
  if (window.innerWidth < 768) return "mobile";
  if (window.innerWidth < 1180) return "tablet";
  return "desktop";
}

function safeClickLabel(element: HTMLElement) {
  if (element.closest('form, [class*="chat"], [class*="message"], [class*="history"]')) return null;
  const explicit = element.getAttribute("data-usage-label") || element.getAttribute("aria-label") || element.getAttribute("title");
  const text = explicit || element.textContent || "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean && clean.length <= 70 ? clean : null;
}

function moduleFromPath(path: string) {
  if (path.includes("/admin/")) return "admin";
  if (path.includes("/workspace")) return "workspace";
  return "platform";
}

export default function UsageTracker() {
  const pathname = usePathname();
  const lastTick = useRef(Date.now());
  const started = useRef(false);

  useEffect(() => {
    const metadata = { device: deviceLabel(), userAgent: navigator.userAgent };
    if (!started.current) {
      started.current = true;
      trackUsageEvent("session_start", { module: moduleFromPath(pathname), path: pathname, metadata });
    }
    trackUsageEvent("page_view", { module: moduleFromPath(pathname), path: pathname, metadata: { device: deviceLabel() } });
  }, [pathname]);

  useEffect(() => {
    lastTick.current = Date.now();

    const heartbeat = () => {
      if (document.visibilityState !== "visible") {
        lastTick.current = Date.now();
        return;
      }
      const now = Date.now();
      const elapsed = Math.max(0, Math.min(60000, now - lastTick.current));
      lastTick.current = now;
      trackUsageEvent("heartbeat", { module: moduleFromPath(window.location.pathname), durationMs: elapsed, metadata: { device: deviceLabel() } });
    };

    const interval = window.setInterval(heartbeat, 30000);

    const visibility = () => {
      if (document.visibilityState === "visible") {
        lastTick.current = Date.now();
      } else {
        heartbeat();
      }
    };

    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("a,button,[role='button'],[data-usage-action]") : null;
      if (!target) return;
      const eventName = target.getAttribute("data-usage-action") || "click";
      const module = target.getAttribute("data-usage-module") || moduleFromPath(window.location.pathname);
      const label = safeClickLabel(target);
      const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") : null;
      trackUsageEvent(eventName, {
        module,
        metadata: {
          ...(label ? { label } : {}),
          ...(href && href.startsWith("/") ? { href: href.slice(0, 300) } : {}),
        },
      });
    };

    const pageHide = () => {
      const elapsed = document.visibilityState === "visible"
        ? Math.max(0, Math.min(60000, Date.now() - lastTick.current))
        : 0;
      beaconUsageEvent("session_end", { module: moduleFromPath(window.location.pathname), durationMs: elapsed, metadata: { device: deviceLabel() } });
    };

    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", click, true);
    window.addEventListener("pagehide", pageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", click, true);
      window.removeEventListener("pagehide", pageHide);
    };
  }, []);

  return null;
}
