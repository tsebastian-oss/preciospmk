"use client";

import { useEffect, useState } from "react";
import AutomotiveIntelligence from "../AutomotiveIntelligence";
import WhatsAppSupport from "../WhatsAppSupport";
import styles from "../panel/panel.module.css";

type PanelAccess = {
  isSaasAdmin?: boolean;
  organizationName?: string;
  clientAutomotiveMode?: boolean;
  clientPanelKind?: string | null;
  landing?: string;
  error?: string;
};

export default function AutomotivePanelPage() {
  const [access, setAccess] = useState<PanelAccess | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/enterprise/client-panel", { cache: "no-store" });
        const payload = await response.json() as PanelAccess;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar Automotive Intelligence.");
        if (!payload.isSaasAdmin && !payload.clientAutomotiveMode) {
          window.location.replace(payload.landing || "/");
          return;
        }
        if (active) setAccess(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar Automotive Intelligence.");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.replace("/login?client=automotive");
  }

  if (error) return <main className={styles.state}><div className={styles.error} role="alert">{error}</div></main>;
  if (!access) return <main className={styles.state} role="status" aria-live="polite">Preparando Automotive Intelligence…</main>;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.identity}>
        <div className={styles.mark}>A</div>
        <div><strong>MGP Automotive Intelligence</strong><span>Market & pricing intelligence · Chile</span></div>
      </div>
      <div className={styles.account}>
        <div><strong>Automotive Intelligence</strong><span>{access.organizationName || "MGP"}</span></div>
        <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
      </div>
    </header>
    <section className={styles.content}>
      <AutomotiveIntelligence />
    </section>
    <WhatsAppSupport brandName="Automotive Intelligence" organizationName={access.organizationName || "MGP"} />
  </main>;
}
