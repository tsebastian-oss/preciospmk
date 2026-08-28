export type UsageEventOptions = {
  module?: string | null;
  path?: string | null;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

const SESSION_KEY = "mgp_usage_session_id";

function fallbackId() {
  return "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12);
}

export function usageSessionId() {
  if (typeof window === "undefined") return "";
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId();
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function payload(eventName: string, options: UsageEventOptions = {}) {
  return {
    sessionId: usageSessionId(),
    eventName,
    module: options.module ?? null,
    path: options.path ?? (typeof window !== "undefined" ? window.location.pathname : null),
    durationMs: Math.max(0, Math.min(60000, Math.round(options.durationMs ?? 0))),
    metadata: options.metadata ?? {},
  };
}

export function trackUsageEvent(eventName: string, options: UsageEventOptions = {}) {
  if (typeof window === "undefined") return;
  void fetch("/api/usage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(payload(eventName, options)),
  }).catch(() => undefined);
}

export function beaconUsageEvent(eventName: string, options: UsageEventOptions = {}) {
  if (typeof window === "undefined" || !navigator.sendBeacon) {
    trackUsageEvent(eventName, options);
    return;
  }
  const body = new Blob([JSON.stringify(payload(eventName, options))], { type: "application/json" });
  navigator.sendBeacon("/api/usage", body);
}
