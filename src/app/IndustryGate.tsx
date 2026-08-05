"use client";

import { ReactNode, useEffect, useState } from "react";

type IndustryContext = {
  industryConfigured?: boolean;
  error?: string;
};

export default function IndustryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("Preparando tu espacio de inteligencia…");

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        const response = await fetch("/api/enterprise/industry", { cache: "no-store" });
        const payload = await response.json() as IndustryContext;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar la configuración de industria");
        if (!payload.industryConfigured) {
          window.location.replace("/onboarding");
          return;
        }
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "No fue posible cargar la plataforma");
      }
    }
    void verify();
    return () => { cancelled = true; };
  }, []);

  if (!ready) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#09090d", color: "#f5f5f7", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 460, padding: 32 }}>
        <div style={{ width: 42, height: 42, margin: "0 auto 18px", borderRadius: 14, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#7c3aed,#ec4899)", fontWeight: 800 }}>M</div>
        <strong style={{ display: "block", fontSize: 20, marginBottom: 8 }}>MGP Intelligence</strong>
        <span style={{ color: "#a1a1aa", fontSize: 14 }}>{message}</span>
      </div>
    </main>;
  }

  return <>{children}</>;
}
