"use client";

import styles from "./PiwenDownloads.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

const FAMILIES = ["Almendras", "Castañas de cajú", "Pistachos", "Mixes", "Nueces", "Maní", "Avellanas", "Semillas", "Fruta deshidratada"] as const;

function href(mode: "current" | "history", family?: string) {
  const query = new URLSearchParams({ mode });
  if (family) query.set("family", family);
  return "/api/brands/piwen/export?" + query.toString();
}

export default function PiwenDownloads() {
  function track(label: string) {
    trackUsageEvent("download", { module: "piwen-downloads", metadata: { label } });
  }

  return <div className={styles.stack}>
    <section className={styles.hero}>
      <div>
        <span>DATA EXPORT</span>
        <h2>Descarga las bases de Piwén</h2>
        <p>Descarga la base maestra con todas las observaciones históricas capturadas por corrida. La base vigente se mantiene separada como snapshot actual.</p>
      </div>
      <a href={href("history")} onClick={()=>track("historico-granular-completo-hero")}>Descargar histórico completo ↓</a>
    </section>

    <section className={styles.grid}>
      <article>
        <span>CSV · SNAPSHOT ACTUAL</span>
        <h3>Base vigente</h3>
        <p>Solo el estado vigente disponible: marca, retailer, producto, familia, formato, gramos, precio, $/kg, promoción, stock, fecha y URL. Esta base es deliberadamente más pequeña que el histórico.</p>
        <a href={href("current")} onClick={()=>track("base-vigente-completa")}>Descargar snapshot vigente ↓</a>
      </article>

      <article>
        <span>CSV · BASE MAESTRA HISTÓRICA</span>
        <h3>Todas las corridas, fila por observación</h3>
        <p>Incluye cada captura disponible de supermercados, Piwén.cl y MercadoLibre: corrida, fecha/hora, fuente, canal, marca, retailer, SKU, precios, $/kg, promoción, stock y URL.</p>
        <a href={href("history")} onClick={()=>track("historico-granular-completo")}>Descargar base maestra ↓</a>
      </article>
    </section>

    <section className={styles.familySection}>
      <div className={styles.title}>
        <div><span>DESCARGAS POR CATEGORÍA</span><h3>Bases separadas por producto</h3></div>
        <small>CSV compatible con Excel</small>
      </div>
      <div className={styles.familyGrid}>
        {FAMILIES.map((family) => <article key={family}>
          <strong>{family}</strong>
          <p>Descarga el mercado actual o la evolución histórica solamente para esta categoría.</p>
          <div>
            <a href={href("current", family)} onClick={()=>track("vigente-"+family)}>Base vigente ↓</a>
            <a href={href("history", family)} onClick={()=>track("historico-granular-"+family)}>Histórico granular ↓</a>
          </div>
        </article>)}
      </div>
    </section>

    <div className={styles.note}>
      La base maestra histórica conserva una fila por observación de cada corrida disponible y no reemplaza mediciones anteriores. El snapshot vigente es más pequeño por diseño. El histórico separa Piwén.cl, supermercados y MercadoLibre, e incluye la columna “Comparable directo” para poder reproducir el benchmark o trabajar con el universo completo.
    </div>
  </div>;
}
