"use client";

import { useState } from "react";
import DashboardContextChat, { type DashboardAiContext } from "./DashboardContextChat";
import styles from "./ClickHouseLanding.module.css";

export default function ClickHouseLanding() {
  const [context,setContext] = useState<DashboardAiContext|null>(null);
  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span>PRICE INTELLIGENCE</span><h1>Inteligencia de precios</h1><p>Consulta el mercado con GPT-5.6 Sol o abre un análisis específico desde el menú. Los módulos analíticos se cargan solo cuando los seleccionas.</p></div>
      <div className={styles.source}><i/>CLICKHOUSE READY</div>
    </header>
    <div className={styles.layout}>
      <section className={styles.chat}><DashboardContextChat filters={{retailer:"",category:"",brand:"",days:30}} activeContext={context} onContextChange={setContext}/></section>
      <aside className={styles.guide}>
        <span>ANÁLISIS BAJO DEMANDA</span>
        <h2>El dashboard ya no precarga todo</h2>
        <p>Selecciona en el menú izquierdo solo el análisis que necesitas. Cada vista ejecuta su propia consulta en ClickHouse.</p>
        <div><b>01</b><strong>Evolución de precios</strong><small>Series históricas por retailer.</small></div>
        <div><b>02</b><strong>Benchmark retailers</strong><small>Medianas y rangos de precio.</small></div>
        <div><b>03</b><strong>Cobertura y brechas</strong><small>Profundidad, disponibilidad y dispersión.</small></div>
        <div><b>04</b><strong>Movimientos y alertas</strong><small>Cambios diarios accionables.</small></div>
      </aside>
    </div>
    <footer>Supabase se mantiene para autenticación y permisos. La analítica visible se resuelve desde ClickHouse.</footer>
  </section>;
}
