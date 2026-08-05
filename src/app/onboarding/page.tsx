"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./onboarding.module.css";

type Industry = {
  slug: string;
  name: string;
  description: string;
  retailer_types: string[];
  display_order: number;
};
type Payload = {
  industries?: Industry[];
  industrySlug?: string | null;
  industryName?: string | null;
  industryConfigured?: boolean;
  organizationName?: string;
  error?: string;
};

const ICONS: Record<string, string> = {
  all: "◎", grocery: "▦", food: "◫", soft_drinks: "◉", alcoholic_beverages: "◆",
  textiles: "✦", technology: "⌘", home: "⌂", beauty: "✧", health: "+",
  toys: "◇", sports: "↗", automotive: "◈", pets: "♢", other: "…",
};

export default function OnboardingPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selected, setSelected] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changing = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("change") === "1", []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/enterprise/industry", { cache: "no-store" });
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar las industrias");
        if (!cancelled) {
          setIndustries(payload.industries ?? []);
          setSelected(payload.industrySlug ?? "");
          setOrganizationName(payload.organizationName ?? "");
          if (payload.industryConfigured && !changing) window.location.replace("/");
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "No fue posible cargar la configuración");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [changing]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/enterprise/industry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industrySlug: selected }),
      });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible guardar la industria");
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar la industria");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.loading}>Preparando industrias…</div></main>;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <div className={styles.brand}><div className={styles.mark}>M</div><div><strong>MGP Intelligence</strong><small>Industry setup</small></div></div>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>{changing ? "CONFIGURACIÓN" : "PERSONALIZA TU PLATAFORMA"}</span>
        <h1>¿En qué industria compite tu empresa?</h1>
        <p>Usaremos esta selección para priorizar categorías, productos, variaciones de precio, comparaciones y bases descargables relevantes para tu negocio.</p>
        {organizationName && <div className={styles.context}>Organización: <strong>{organizationName}</strong></div>}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.grid}>
        {industries.map((industry) => <button key={industry.slug} type="button" onClick={() => setSelected(industry.slug)} className={`${styles.card} ${selected === industry.slug ? styles.selected : ""}`}>
          <span className={styles.icon}>{ICONS[industry.slug] ?? "•"}</span>
          <span className={styles.check}>✓</span>
          <b>{industry.name}</b>
          <p>{industry.description}</p>
        </button>)}
      </section>

      <footer className={styles.footer}>
        <p>La industria se combina con los retailers, marcas y categorías contratadas por tu organización. No elimina información; solo define qué universo se presenta por defecto.</p>
        <button className={styles.continue} disabled={!selected || saving} onClick={save}>{saving ? "Guardando…" : changing ? "Guardar cambios" : "Entrar a la plataforma"}</button>
      </footer>
    </div>
  </main>;
}
