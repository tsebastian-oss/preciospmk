"use client";
import { useState, type MouseEvent } from "react";
import styles from "./VictorinoxMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

export default function VictorinoxDownloads() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const link = (mode: string) => "/api/brands/victorinox/export?mode=" + mode;
  async function download(event: MouseEvent<HTMLAnchorElement>, mode: string) {
    event.preventDefault();
    if (busy) return;
    setBusy(mode);
    setError("");
    try {
      const response = await fetch(link(mode), { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "No fue posible generar la descarga.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `victorinox-${mode}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      trackUsageEvent("download", { module: "victorinox-market", metadata: { mode } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible generar la descarga.");
    } finally {
      setBusy(null);
    }
  }
  const action = (mode: string, label: string) => <a href={link(mode)} aria-disabled={Boolean(busy)} onClick={(event) => void download(event, mode)}>{busy === mode ? "Preparando…" : label}</a>;
  return <section className={styles.downloads}>
    <div className={styles.downloadHero}>
      <div><span>EXPORTACIÓN DE DATOS</span><h2>Descarga las bases de Victorinox</h2><p>Mercado vigente, matriz competitiva e histórico, directamente desde Supabase y listos para Excel.</p></div>
      {action("current", "Descargar base vigente ↓")}
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    <div className={styles.downloadGrid}>
      <article><span>CSV · ACTUAL</span><h3>Base competitiva</h3><p>Producto, marca, canal, categoría, precio, promoción, stock y fecha.</p>{action("current", "Descargar ↓")}</article>
      <article><span>CSV · MATRIZ</span><h3>Matriz agregada</h3><p>Precio promedio por categoría, marca y canal observado.</p>{action("matrix", "Descargar ↓")}</article>
      <article><span>CSV · HISTÓRICO</span><h3>Evolución vs benchmark actual</h3><p>Serie diaria oficial versus la última captura competitiva disponible.</p>{action("history", "Descargar ↓")}</article>
    </div>
  </section>;
}
