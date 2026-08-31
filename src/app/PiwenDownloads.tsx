"use client";

import styles from "./PiwenDownloads.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

const FAMILIES = ["Almendras", "Castañas de cajú", "Pistachos"] as const;

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
        <p>Base vigente competitiva y serie histórica normalizada a $/kg, listas para Excel, análisis o presentaciones.</p>
      </div>
      <a href={href("current")} onClick={()=>track("base-vigente-completa")}>Descargar base vigente ↓</a>
    </section>

    <section className={styles.grid}>
      <article>
        <span>CSV · MERCADO ACTUAL</span>
        <h3>Base competitiva vigente</h3>
        <p>Marca, retailer, producto, familia, formato, gramos, precio, $/kg, promoción, stock, fecha y URL.</p>
        <a href={href("current")} onClick={()=>track("base-vigente-completa")}>Descargar completa ↓</a>
      </article>

      <article>
        <span>CSV · HISTÓRICO</span>
        <h3>Serie histórica $/kg</h3>
        <p>Piwén, Alto La Cruz y Millantú por fecha y categoría, incluyendo el número de SKU y retailers considerados.</p>
        <a href={href("history")} onClick={()=>track("historico-completo")}>Descargar histórico ↓</a>
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
            <a href={href("history", family)} onClick={()=>track("historico-"+family)}>Histórico ↓</a>
          </div>
        </article>)}
      </div>
    </section>

    <div className={styles.note}>
      Las descargas respetan el acceso privado de la cuenta Piwén. La serie histórica identifica por separado el censo de supermercados y las referencias públicas de Piwén disponibles antes del crawler D2C continuo.
    </div>
  </div>;
}
