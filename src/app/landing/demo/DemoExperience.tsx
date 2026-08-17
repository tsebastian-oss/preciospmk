"use client";

import { useState } from "react";
import { DashboardPreview } from "../MarketingShell";
import styles from "./demo.module.css";

const TABS = [
  { id: "home", label: "Asistente & Inicio", title: "Empieza con una lectura ejecutiva del mercado", copy: "La vista inicial reúne contexto de la plataforma y permite consultar con IA la información disponible para tu organización." },
  { id: "prices", label: "Precios", title: "Revisa evolución, brechas y movimientos", copy: "Analiza históricos, diferencias entre retailers y alzas o bajas detectadas dentro del universo monitoreado." },
  { id: "categories", label: "Categorías", title: "Entiende cómo está compuesta una categoría", copy: "Revisa evolución, mix de marcas, productos y composición por retailer desde la vista de Análisis de categorías." },
  { id: "verticals", label: "Brands + Automotriz", title: "Profundiza con verticales Enterprise", copy: "Brands permite revisar competencia, precios y presencia; Automotriz muestra modelos, versiones, bonos, precio final y variaciones." },
  { id: "data", label: "Datos", title: "Descarga y valida la actualización", copy: "Exporta CSV preparado para Excel y revisa el estado de las fuentes antes de usar la información." },
] as const;
type Tab = typeof TABS[number]["id"];

export default function DemoExperience() {
  const [tab, setTab] = useState<Tab>("home");
  const active = TABS.find((item) => item.id === tab)!;
  return <div className={styles.shell}>
    <div className={styles.tabs}>{TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.active : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className={styles.copy}><span>DEMO GUIADA</span><h2>{active.title}</h2><p>{active.copy}</p><small>La visualización es demostrativa. La plataforma real muestra datos y módulos según el plan, las fuentes y el alcance configurado.</small></div>
    <div className={styles.preview}><DashboardPreview compact={tab !== "home"} /></div>
  </div>;
}
