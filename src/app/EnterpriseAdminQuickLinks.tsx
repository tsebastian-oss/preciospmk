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
  return createPortal(<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
    <a href="/admin/ai" style={{ padding: "8px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 9, color: "#aaa9ba", background: "rgba(255,255,255,.025)", textAlign: "center", textDecoration: "none", fontSize: 7, fontWeight: 800 }}>IA ADMIN</a>
    <a href="/admin/notifications" style={{ padding: "8px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 9, color: "#aaa9ba", background: "rgba(255,255,255,.025)", textAlign: "center", textDecoration: "none", fontSize: 7, fontWeight: 800 }}>EMAIL ADMIN</a>
  </div>, target);
}
