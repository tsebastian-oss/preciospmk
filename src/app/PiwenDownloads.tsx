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
        <p>Base vigente competitiva e histórico granular de cada corrida, listos para Excel, análisis propios o presentaciones.</p>
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
        <span>CSV · HISTÓRICO GRANULAR</span>
        <h3>Todas las corridas, fila por observación</h3>
        <p>Descarga cada captura histórica con corrida, fecha/hora, fuente, canal, marca, retailer, SKU, precios, $/kg, promoción, stock y URL.</p>
        <a href={href("history")} onClick={()=>track("historico-granular-completo")}>Descargar histórico granular ↓</a>
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
      Las descargas respetan el acceso privado de la cuenta Piwén. El histórico granular conserva una fila por observación de cada corrida disponible: no reemplaza mediciones anteriores y separa Piwén.cl, supermercados y MercadoLibre. La columna “Comparable directo” permite reproducir el benchmark o construir análisis propios con el universo completo.
    </div>
  </div>;
}
