"use client";

import { useEffect, useState } from "react";
import BrandsVertical from "../BrandsVertical";
import WhatsAppSupport from "../WhatsAppSupport";
import styles from "./panel.module.css";

type PanelAccess = {
  isSaasAdmin?: boolean;
  organizationName?: string;
  brandName?: string | null;
  brandSlug?: string | null;
  clientBrandMode?: boolean;
  landing?: string;
  error?: string;
};

export default function ClientBrandPanelPage() {
  const [access, setAccess] = useState<PanelAccess | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/enterprise/client-panel", { cache: "no-store" });
        const payload = await response.json() as PanelAccess;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar tu panel.");
        if (payload.isSaasAdmin) {
          window.location.replace("/");
          return;
        }
        if (!payload.clientBrandMode || !payload.brandSlug) {
          window.location.replace(payload.landing || "/");
          return;
        }
        if (active) setAccess(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar tu panel.");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.replace("/login");
  }

  if (error) return <main className={styles.state}><div className={styles.error}>{error}</div></main>;
  if (!access?.brandSlug) return <main className={styles.state}>Preparando panel de marca…</main>;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.identity}>
        <div className={styles.mark}>M</div>
        <div><strong>MGP Price Intelligence</strong><span>Panel privado de marca</span></div>
      </div>
      <div className={styles.account}>
        <div><strong>{access.brandName}</strong><span>{access.organizationName}</span></div>
        <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
      </div>
    </header>
    <section className={styles.content}>
      <BrandsVertical initialBrand={access.brandSlug} locked />
    </section>
    <WhatsAppSupport brandName={access.brandName} organizationName={access.organizationName} />
  </main>;
}
