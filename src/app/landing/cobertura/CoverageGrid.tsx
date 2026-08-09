"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./coverage.module.css";

type Retailer = {
  name: string;
  retailerType: string;
  products: number;
  validPriceProducts: number;
  freshnessStatus: string;
  latestObservedAt: string | null;
  ageHours: number | string | null;
};
type Payload = { generatedAt?: string; retailers?: Retailer[]; error?: string };

const TYPE_LABELS: Record<string, string> = { supermarket: "Supermercado", pharmacy: "Farmacia", department_store: "Multitienda" };
const TYPE_ORDER: Record<string, number> = { supermarket: 1, pharmacy: 2, department_store: 3 };

function freshness(item: Retailer) {
  if (item.freshnessStatus === "fresh") return { label: "Actualización activa", tone: styles.fresh };
  if (item.freshnessStatus === "warning") return { label: "Actualización en revisión", tone: styles.warning };
  return { label: "Fuente temporalmente degradada", tone: styles.stale };
}

function date(value: string | null) {
  if (!value) return "Sin fecha disponible";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function CoverageGrid() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/public/coverage", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Payload;
        if (!response.ok) throw new Error(data.error || "No fue posible cargar la cobertura.");
        setPayload(data);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "No fue posible cargar la cobertura."));
  }, []);

  const retailers = useMemo(() => [...(payload?.retailers ?? [])].sort((a, b) => {
    const type = (TYPE_ORDER[a.retailerType] ?? 9) - (TYPE_ORDER[b.retailerType] ?? 9);
    return type || b.products - a.products;
  }), [payload]);

  if (error) return <div className={styles.state}>{error}</div>;
  if (!payload) return <div className={styles.state}>Cargando cobertura disponible…</div>;

  const active = retailers.filter((item) => item.freshnessStatus === "fresh").length;
  const products = retailers.reduce((sum, item) => sum + Number(item.products || 0), 0);

  return <div>
    <div className={styles.summary}>
      <article><span>Retailers visibles</span><strong>{retailers.length}</strong><small>con cobertura publicada</small></article>
      <article><span>Fuentes activas</span><strong>{active}</strong><small>con actualización reciente</small></article>
      <article><span>SKU por retailer</span><strong>{new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 }).format(products)}</strong><small>suma de catálogos monitoreados</small></article>
    </div>
    <div className={styles.grid}>
      {retailers.map((item) => {
        const status = freshness(item);
        const validPct = item.products > 0 ? Math.round(item.validPriceProducts / item.products * 100) : 0;
        return <article className={styles.card} key={item.name}>
          <header><span>{TYPE_LABELS[item.retailerType] ?? item.retailerType}</span><b className={status.tone}><i/>{status.label}</b></header>
          <h3>{item.name}</h3>
          <strong>{new Intl.NumberFormat("es-CL").format(item.products)} SKU</strong>
          <p>{validPct}% con precio válido en el snapshot operativo.</p>
          <footer>Última observación: {date(item.latestObservedAt)}</footer>
        </article>;
      })}
    </div>
    <p className={styles.note}>La cobertura corresponde a catálogos públicos observados por la plataforma y puede variar por cambios de surtido, disponibilidad o estructura de cada sitio fuente. Las fuentes en revisión se mantienen visibles para transparentar el estado operativo.</p>
  </div>;
}
