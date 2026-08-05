"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ContextData = { activeOrganizationId?: string | null };
type AlertEvent = {
  id: number;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  status: "new" | "acknowledged" | "resolved" | "suppressed";
  detected_at: string;
};
type Feed = { events: AlertEvent[]; unread: number };

const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });

export default function EnterpriseAlertCenter() {
  const [target, setTarget] = useState<Element | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [feed, setFeed] = useState<Feed>({ events: [], unread: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sideStatus = document.querySelector(".app-shell .side-status");
    if (!sideStatus) return;
    setTarget(sideStatus);
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ContextData> : null)
      .then((context) => setOrganizationId(context?.activeOrganizationId ?? ""))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    const load = () => fetch(`/api/enterprise/alert-events?organizationId=${encodeURIComponent(organizationId)}&limit=12`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<Feed> : null)
      .then((result) => { if (active && result) setFeed(result); })
      .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [organizationId]);

  const latest = useMemo(() => feed.events.slice(0, 8), [feed.events]);

  async function acknowledge(eventId: number) {
    const response = await fetch("/api/enterprise/alert-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, eventId, status: "acknowledged" }),
    });
    if (!response.ok) return;
    setFeed((current) => ({
      unread: Math.max(0, current.unread - 1),
      events: current.events.map((event) => event.id === eventId ? { ...event, status: "acknowledged" } : event),
    }));
  }

  if (!target || !organizationId) return null;

  return <>
    {createPortal(<button
      type="button"
      onClick={() => setOpen((value) => !value)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 10,
        padding: "9px 10px",
        border: "1px solid rgba(217,72,255,.18)",
        borderRadius: 10,
        color: "#fff",
        background: "rgba(217,72,255,.055)",
        fontSize: 9,
        fontWeight: 850,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: feed.unread ? "#ff8294" : "#6ff0b2" }} /> Alertas enterprise</span>
      <b style={{ minWidth: 20, padding: "3px 6px", borderRadius: 999, color: feed.unread ? "#ffb1bd" : "#8d8c9f", background: feed.unread ? "rgba(255,130,148,.1)" : "rgba(255,255,255,.04)", fontSize: 8 }}>{feed.unread}</b>
    </button>, target)}

    {open && <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 1500, width: "min(410px,calc(100vw - 32px))", maxHeight: "70vh", overflow: "auto", padding: 16, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, color: "#fff", background: "linear-gradient(145deg,#181825,#0e0e18)", boxShadow: "0 28px 80px rgba(0,0,0,.48)", fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 13 }}><div><span style={{ color: "#d988f2", fontSize: 8, fontWeight: 900, letterSpacing: ".1em" }}>MONITOR AUTOMÁTICO</span><h3 style={{ margin: "6px 0 0", fontSize: 17 }}>Alertas y riesgos</h3></div><button onClick={() => setOpen(false)} style={{ border: 0, color: "#aaa9ba", background: "transparent", fontSize: 20 }}>×</button></div>
      {latest.length ? <div style={{ display: "grid", gap: 9 }}>{latest.map((event) => <article key={event.id} style={{ padding: 12, border: `1px solid ${event.severity === "critical" || event.severity === "high" ? "rgba(255,130,148,.22)" : "rgba(255,255,255,.07)"}`, borderRadius: 12, background: event.status === "new" ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.015)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: event.severity === "critical" || event.severity === "high" ? "#ff9cac" : "#d988f2", fontSize: 7, fontWeight: 900, textTransform: "uppercase" }}>{event.severity} · {event.alert_type}</span><small style={{ color: "#77768a", fontSize: 7 }}>{date.format(new Date(event.detected_at))}</small></div>
        <strong style={{ display: "block", marginTop: 7, fontSize: 10 }}>{event.title}</strong><p style={{ margin: "5px 0 0", color: "#9a99aa", fontSize: 9, lineHeight: 1.5 }}>{event.message}</p>
        {event.status === "new" && <button onClick={() => void acknowledge(event.id)} style={{ marginTop: 9, padding: "6px 8px", border: "1px solid rgba(111,240,178,.17)", borderRadius: 8, color: "#6ff0b2", background: "rgba(111,240,178,.05)", fontSize: 7, fontWeight: 850 }}>Marcar revisada</button>}
      </article>)}</div> : <div style={{ padding: 28, textAlign: "center", color: "#858497", border: "1px dashed rgba(255,255,255,.09)", borderRadius: 12, fontSize: 9 }}>No hay alertas activas para esta organización.</div>}
      <a href="/enterprise" style={{ display: "block", marginTop: 13, padding: 10, borderRadius: 10, color: "#fff", background: "linear-gradient(135deg,#d948ff,#7b61ff)", textAlign: "center", textDecoration: "none", fontSize: 9, fontWeight: 850 }}>Abrir Enterprise Control</a>
    </div>}
  </>;
}
