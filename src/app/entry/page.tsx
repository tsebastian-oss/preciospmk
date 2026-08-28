"use client";

import { useEffect, useState } from "react";

type LandingPayload = {
  landing?: string;
  error?: string;
};

export default function EntryPage() {
  const [message, setMessage] = useState("Preparando tu panel…");

  useEffect(() => {
    let active = true;
    async function resolveLanding() {
      try {
        const response = await fetch("/api/enterprise/client-panel", { cache: "no-store" });
        const payload = await response.json() as LandingPayload;
        if (!response.ok) throw new Error(payload.error || "No fue posible resolver tu acceso.");
        window.location.replace(payload.landing || "/");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "No fue posible cargar tu cuenta.");
      }
    }
    void resolveLanding();
    return () => { active = false; };
  }, []);

  return <main style={{
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#080b12",
    color: "#f8fafc",
    fontFamily: "Inter, Arial, sans-serif",
  }}>
    <div style={{ textAlign: "center", padding: 32 }}>
      <div style={{
        width: 44,
        height: 44,
        display: "grid",
        placeItems: "center",
        margin: "0 auto 16px",
        borderRadius: 14,
        background: "linear-gradient(135deg,#2563eb,#10b981)",
        fontWeight: 900,
      }}>M</div>
      <strong style={{ display: "block", marginBottom: 7 }}>MGP Price Intelligence</strong>
      <span style={{ color: "#94a3b8", fontSize: 13 }}>{message}</span>
    </div>
  </main>;
}
