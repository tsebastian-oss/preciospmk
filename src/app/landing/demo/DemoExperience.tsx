"use client";

import { useState } from "react";
import { AIPriceMapPreview, BrandPreview, DashboardPreview } from "../MarketingShell";
import styles from "./demo.module.css";

const TABS = [
  { id: "dashboard", label: "Resumen", title: "Lee el mercado en una sola vista", copy: "KPIs, retailers, promociones y tendencias consolidados para tu alcance." },
  { id: "price-map", label: "AI Price Map", title: "Convierte una pregunta en un mapa competitivo", copy: "La IA interpreta la pregunta y organiza comparables, precio relativo y cobertura." },
  { id: "brand", label: "Brand Intelligence", title: "Pregunta por una marca y recibe un diagnóstico", copy: "Revisa precio, promociones, disponibilidad y señales competitivas con contexto de negocio." },
] as const;
type Tab = typeof TABS[number]["id"];

export default function DemoExperience() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const active = TABS.find((item) => item.id === tab)!;
  return <div className={styles.shell}>
    <div className={styles.tabs}>{TABS.map((item) => <button key={item.id} className={tab === item.id ? styles.active : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className={styles.copy}><span>DEMO GUIADA</span><h2>{active.title}</h2><p>{active.copy}</p><small>Esta vista es demostrativa. Una cuenta trial utiliza los retailers y datos reales seleccionados durante onboarding.</small></div>
    <div className={styles.preview}>
      {tab === "dashboard" && <DashboardPreview />}
      {tab === "price-map" && <AIPriceMapPreview />}
      {tab === "brand" && <BrandPreview />}
    </div>
  </div>;
}
