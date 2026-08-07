"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function EnterpriseAdminQuickLinks() {
  const [target, setTarget] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const nav = document.querySelector(".sidebar nav");
    if (!nav) return;
    setTarget(nav);
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ isSaasAdmin?: boolean }> : null)
      .then((data) => setVisible(Boolean(data?.isSaasAdmin)))
      .catch(() => undefined);
  }, []);

  if (!target || !visible) return null;
  const linkStyle = { padding: "8px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 9, color: "#aaa9ba", background: "rgba(255,255,255,.025)", textAlign: "center" as const, textDecoration: "none", fontSize: 7, fontWeight: 800 };
  return createPortal(<div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, marginTop: 6 }}>
    <a href="/admin/trials" style={{ ...linkStyle, color: "#c7c1ff", borderColor: "rgba(109,93,252,.32)", background: "rgba(109,93,252,.08)" }}>TRIALS / CRM</a>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <a href="/admin/ai" style={linkStyle}>IA ADMIN</a>
      <a href="/admin/notifications" style={linkStyle}>EMAIL ADMIN</a>
    </div>
  </div>, target);
}
