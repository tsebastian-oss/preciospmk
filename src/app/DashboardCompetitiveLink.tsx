"use client";

import { useEffect, useState } from "react";

export default function DashboardCompetitiveLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(Boolean(document.querySelector(".app-shell")));
  }, []);

  if (!visible) return null;

  return <a
    href="/competitive-analysis"
    aria-label="Abrir Competitive Pricing Intelligence"
    style={{
      position: "fixed",
      right: 22,
      bottom: 22,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "13px 17px",
      borderRadius: 999,
      background: "#132f38",
      color: "white",
      textDecoration: "none",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: 13,
      fontWeight: 800,
      boxShadow: "0 14px 35px rgba(15, 44, 52, .28)",
      border: "1px solid rgba(255,255,255,.16)",
    }}
  >
    <span style={{ display: "grid", placeItems: "center", width: 25, height: 25, borderRadius: "50%", background: "#1a9b83" }}>AI</span>
    Competitive Pricing
  </a>;
}
