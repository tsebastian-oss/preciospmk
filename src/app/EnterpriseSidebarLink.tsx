"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Organization = {
  id: string;
  name: string;
  type: "platform" | "retailer" | "brand";
  plan: string;
  role: string;
  settings?: { default_world?: "retailer" | "brand" } | null;
};
type ContextData = {
  isSaasAdmin?: boolean;
  activeOrganizationId?: string | null;
  organizations?: Organization[];
};

export default function EnterpriseSidebarLink() {
  const [target, setTarget] = useState<Element | null>(null);
  const [data, setData] = useState<ContextData | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const nav = document.querySelector(".sidebar nav");
    if (!nav) return;
    setTarget(nav);
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ContextData> : null)
      .then(setData)
      .catch(() => undefined);
  }, []);

  const organizations = data?.organizations ?? [];
  const active = useMemo(
    () => organizations.find((item) => item.id === data?.activeOrganizationId) ?? organizations[0] ?? null,
    [organizations, data?.activeOrganizationId],
  );

  async function switchOrganization(organizationId: string) {
    const next = organizations.find((item) => item.id === organizationId);
    if (!next || next.id === active?.id) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/enterprise/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) throw new Error("No fue posible cambiar de organización");
      const world = next.settings?.default_world ?? (next.type === "brand" ? "brand" : "retailer");
      window.localStorage.setItem("mgp-intelligence-world", world);
      window.localStorage.setItem("mgp-enterprise-organization", organizationId);
      window.location.href = `/#${world === "brand" ? "brand-overview" : "retailer-overview"}`;
    } catch {
      setSwitching(false);
    }
  }

  if (!target || !active) return null;

  return createPortal(
    <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(111,240,178,.18)", borderRadius: 12, background: "linear-gradient(145deg,rgba(111,240,178,.055),rgba(123,97,255,.04))" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ color: "#858497", fontSize: 7, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Tenant activo</span>
        <b style={{ color: data?.isSaasAdmin ? "#6ff0b2" : "#d988f2", fontSize: 7 }}>{data?.isSaasAdmin ? "SAAS ADMIN" : active.role.toUpperCase()}</b>
      </div>
      {organizations.length > 1 ? <select
        aria-label="Organización activa"
        disabled={switching}
        value={active.id}
        onChange={(event) => void switchOrganization(event.target.value)}
        style={{ width: "100%", padding: "8px 9px", border: "1px solid rgba(255,255,255,.1)", borderRadius: 9, color: "#fff", background: "#151521", fontSize: 9 }}
      >
        {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select> : <div style={{ color: "#fff", fontSize: 10, fontWeight: 800 }}>{active.name}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7, color: "#77768a", fontSize: 7, textTransform: "uppercase" }}>
        <span>{active.type}</span><span>{active.plan}</span>
      </div>
      <a
        href="/enterprise"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 9, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,.07)", color: "#fff", textDecoration: "none", fontSize: 9, fontWeight: 850 }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <i style={{ width: 7, height: 7, borderRadius: "50%", background: "#6ff0b2", boxShadow: "0 0 0 3px rgba(111,240,178,.08)" }} />
          Enterprise Control
        </span>
        <small style={{ color: "#aaa9ba", fontSize: 7 }}>{switching ? "CAMBIANDO" : "ABRIR →"}</small>
      </a>
    </div>,
    target,
  );
}
