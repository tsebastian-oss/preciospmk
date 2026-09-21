"use client";
import styles from "./VictorinoxMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

export default function VictorinoxDownloads() {
  const link = (mode: string) => "/api/brands/victorinox/export?mode=" + mode;
  const track = (mode: string) => trackUsageEvent("download", { module: "victorinox-market", metadata: { mode } });
  return <section className={styles.downloads}>
    <div className={styles.downloadHero}>
      <div><span>EXPORTACIÓN DE DATOS</span><h2>Descarga las bases de Victorinox</h2><p>Mercado vigente, matriz competitiva e histórico, directamente desde Supabase y listos para Excel.</p></div>
      <a href={link("current")} onClick={() => track("current")}>Descargar base vigente ↓</a>
    </div>
    <div className={styles.downloadGrid}>
      <article><span>CSV · ACTUAL</span><h3>Base competitiva</h3><p>Producto, marca, canal, categoría, precio, promoción, stock y fecha.</p><a href={link("current")} onClick={() => track("current")}>Descargar ↓</a></article>
      <article><span>CSV · MATRIZ</span><h3>Matriz agregada</h3><p>Precio promedio por categoría, marca y canal observado.</p><a href={link("matrix")} onClick={() => track("matrix")}>Descargar ↓</a></article>
      <article><span>CSV · HISTÓRICO</span><h3>Evolución competitiva</h3><p>Serie diaria oficial versus la última captura competitiva disponible.</p><a href={link("history")} onClick={() => track("history")}>Descargar ↓</a></article>
    </div>
  </section>;
}
