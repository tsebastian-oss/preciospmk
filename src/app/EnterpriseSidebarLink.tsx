"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function EnterpriseSidebarLink() {
  const [target, setTarget] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    const nav = document.querySelector(".sidebar nav");
    if (!nav) return;
    setTarget(nav);
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        setVisible(Boolean(data?.organizations?.length));
        setAdmin(Boolean(data?.isSaasAdmin));
      })
      .catch(() => undefined);
  }, []);

  if (!target || !visible) return null;

  return createPortal(
    <a
      href="/enterprise"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginTop: 10,
        padding: "12px",
        border: "1px solid rgba(111,240,178,.2)",
        borderRadius: 12,
        color: "#fff",
        background: "linear-gradient(90deg,rgba(111,240,178,.09),rgba(123,97,255,.05))",
        textDecoration: "none",
        fontSize: 11,
        fontWeight: 850,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <i style={{ width: 8, height: 8, borderRadius: "50%", background: "#6ff0b2", boxShadow: "0 0 0 4px rgba(111,240,178,.08)" }} />
        Enterprise Control
      </span>
      <small style={{ color: admin ? "#6ff0b2" : "#aaa9ba", fontSize: 8, letterSpacing: ".08em" }}>{admin ? "ADMIN" : "GOV"}</small>
    </a>,
    target,
  );
}
