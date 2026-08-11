"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ClickHouseDownloads.module.css";

type Props = { filters?: { supermarket?: string; category?: string; brand?: string } };
type Option = { value: string; observations: number };
type Meta = {
  source: "clickhouse";
  firstDate: string | null;
  lastDate: string | null;
  observations: number;
  products: number;
  retailers: Option[];
  categories: Option[];
  brands: Option[];
  error?: string;
};

const integer = new Intl.NumberFormat("es-CL");
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clampStart(firstDate: string, lastDate: string) {
  return shiftDate(lastDate, -29) < firstDate ? firstDate : shiftDate(lastDate, -29);
}

export default function ClickHouseDownloads({ filters }: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [retailer, setRetailer] = useState(filters?.supermarket ?? "");
  const [category, setCategory] = useState(filters?.category ?? "");
  const [brand, setBrand] = useState(filters?.brand ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/clickhouse-export?mode=meta&live=${Date.now()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Meta;
        if (!response.ok || data.source !== "clickhouse") throw new Error(data.error || "No fue posible cargar la disponibilidad de la base.");
        setMeta(data);
        if (data.firstDate && data.lastDate) {
          setStartDate((current) => current || clampStart(data.firstDate!, data.lastDate!));
          setEndDate((current) => current || data.lastDate!);
        }
        setError("");
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "No fue posible cargar la descarga.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const ready = Boolean(meta?.firstDate && meta?.lastDate && startDate && endDate && startDate <= endDate);
  const selectedLabel = useMemo(() => [retailer || "Todos los retailers", category || "Todas las categorías", brand || "Todas las marcas"].join(" · "), [retailer, category, brand]);

  function download() {
    if (!ready) return;
    const params = new URLSearchParams({ startDate, endDate });
    if (retailer) params.set("retailer", retailer);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    const anchor = document.createElement("a");
    anchor.href = `/api/clickhouse-export?${params.toString()}`;
    anchor.download = "";
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return <section className={styles.dashboard}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>DATA EXPORTS</span>
        <h1>Descarga de bases</h1>
        <p>Exporta el histórico de precios directamente desde ClickHouse en un CSV amigable para Excel.</p>
      </div>
      <div className={styles.status}>
        <span className={styles.liveDot}/>
        <div><small>FUENTE DE DATOS</small><strong>ClickHouse · streaming</strong></div>
        <div className={styles.badge}><i>▥</i><span><small>POWERED BY</small><strong>ClickHouse</strong></span></div>
      </div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.kpis}>
      <article><span>Observaciones disponibles</span><strong>{loading ? "—" : compact.format(meta?.observations ?? 0)}</strong><small>Histórico autorizado</small></article>
      <article><span>Productos</span><strong>{loading ? "—" : compact.format(meta?.products ?? 0)}</strong><small>SKU con histórico</small></article>
      <article><span>Primera fecha</span><strong>{meta?.firstDate ?? "—"}</strong><small>Inicio disponible</small></article>
      <article><span>Última fecha</span><strong>{meta?.lastDate ?? "—"}</strong><small>Última observación disponible</small></article>
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <header><span>CONFIGURAR DESCARGA</span><h2>Base histórica de precios</h2><p>El archivo comienza a descargarse mientras ClickHouse lo genera; no se construye primero en memoria.</p></header>
        <div className={styles.form}>
          <label><span>Desde</span><input type="date" min={meta?.firstDate ?? undefined} max={meta?.lastDate ?? undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label>
          <label><span>Hasta</span><input type="date" min={meta?.firstDate ?? undefined} max={meta?.lastDate ?? undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label>
          <label><span>Retailer</span><select value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="">Todos los retailers</option>{(meta?.retailers ?? []).map((item) => <option key={item.value} value={item.value}>{item.value} · {integer.format(item.observations)}</option>)}</select></label>
          <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{category && !meta?.categories.some((item) => item.value === category) && <option value={category}>{category}</option>}{(meta?.categories ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></label>
          <label><span>Marca</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{brand && !meta?.brands.some((item) => item.value === brand) && <option value={brand}>{brand}</option>}{(meta?.brands ?? []).map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></label>
        </div>
        <div className={styles.selection}><span>SELECCIÓN</span><strong>{selectedLabel}</strong><small>{startDate || "—"} → {endDate || "—"}</small></div>
        <button className={styles.download} disabled={!ready || loading} onClick={download}>↓ Descargar CSV para Excel</button>
      </article>

      <aside className={styles.card}>
        <header><span>FORMATO AMIGABLE</span><h2>Listo para trabajar</h2><p>UTF-8, encabezados en español y separador reconocido automáticamente por Excel.</p></header>
        <div className={styles.features}>
          <div><b>01</b><span><strong>Streaming</strong><small>La descarga empieza sin esperar a que Vercel arme todo el archivo.</small></span></div>
          <div><b>02</b><span><strong>Columnas legibles</strong><small>Fecha, retailer, SKU, producto, marca, categoría, precios, stock y URL.</small></span></div>
          <div><b>03</b><span><strong>Permisos aplicados</strong><small>Solo incluye industria, retailers, marcas y categorías autorizadas.</small></span></div>
          <div><b>04</b><span><strong>Hasta 366 días</strong><small>Puedes descargar el histórico disponible sin depender del worker de Supabase.</small></span></div>
        </div>
      </aside>
    </section>

    <footer className={styles.note}><i/>Analítica y exportación: ClickHouse. Supabase se usa únicamente para autenticar y aplicar permisos de la organización.</footer>
  </section>;
}
