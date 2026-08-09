"use client";

import Link from "next/link";
import { useState } from "react";

export default function TrialExpiredPage() {
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { window.location.replace("/login"); }
  }

  return <main style={{ minHeight: "100vh", background: "linear-gradient(145deg,#04172f,#082c58)", color: "#fff", display: "grid", placeItems: "center", padding: 24, fontFamily: "Inter,system-ui,sans-serif" }}>
    <section style={{ width: "min(720px,100%)", border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.07)", borderRadius: 22, padding: "clamp(28px,5vw,54px)", boxShadow: "0 30px 90px rgba(0,0,0,.28)" }}>
      <div style={{ width: 52, height: 52, borderRadius: 15, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#2384ff,#18b866)", fontWeight: 950, fontSize: 22 }}>M</div>
      <span style={{ display: "block", marginTop: 28, fontSize: 11, letterSpacing: ".1em", fontWeight: 900, color: "#8dc1ff" }}>MGP SUPER PRECIOS · ACCESO PAUSADO</span>
      <h1 style={{ fontSize: "clamp(34px,6vw,54px)", lineHeight: 1, letterSpacing: "-.04em", margin: "12px 0 16px" }}>Tu período de evaluación terminó.</h1>
      <p style={{ color: "#c8d7e9", lineHeight: 1.7, fontSize: 15, maxWidth: 600 }}>Tu configuración, retailers y organización se mantienen registrados. Elige un plan o conversa con MGP para reactivar el acceso sin empezar de cero.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
        <Link href="/landing/precios" style={{ padding: "13px 18px", borderRadius: 10, background: "#18b866", color: "#fff", textDecoration: "none", fontWeight: 850, fontSize: 13 }}>Comparar planes</Link>
        <Link href="/landing/contacto#demo" style={{ padding: "13px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,.25)", color: "#fff", textDecoration: "none", fontWeight: 850, fontSize: 13 }}>Hablar con MGP</Link>
        <button onClick={logout} disabled={loggingOut} style={{ padding: "13px 18px", borderRadius: 10, border: 0, background: "transparent", color: "#b8c9dc", fontWeight: 750, cursor: "pointer" }}>{loggingOut ? "Cerrando…" : "Cerrar sesión"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 32 }}>
        {["Conservas tu organización","Conservas tu alcance","Conservas el historial de IA"].map((text) => <div key={text} style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.05)", color: "#dce8f5", fontSize: 11 }}>✓ {text}</div>)}
      </div>
    </section>
  </main>;
}
