"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./WeightedPricePulsePortal.module.css";

type StorePulse = {
  supermarket: string;
  variationPct: number | null;
  weightedCurrent: number | null;
  weightedPrevious: number | null;
  matchedSkus: number;
  currentSkus: number;
  previousSkus: number;
  coveragePct: number | null;
  status: "ready" | "building";
  confidence: "high" | "medium" | "low" | "building";
  latestObservationAt: string | null;
};

type PulsePayload = {
  data: StorePulse[];
  asOfDate: string | null;
  previousDate: string | null;
  partialDay: boolean;
  latestObservationAt: string | null;
  method: string;
  weighting: string;
  outlierTreatment: string;
  currency: string;
  error?: string;
};

const STORE_ORDER = ["Jumbo", "Santa Isabel", "Lider"];
const integer = new Intl.NumberFormat("es-CL");
const POLLING_MS = 30_000;

function percentage(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function shortDate(value: string | null) {
  if (!value) return "ayer";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" })
    .format(new Date(`${value}T12:00:00`))
    .replace(".", "");
}

function timeLabel(value: string | null) {
  if (!value) return "esperando captura";
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function confidenceLabel(value: StorePulse["confidence"]) {
  if (value === "high") return "Base alta";
  if (value === "medium") return "Base media";
  if (value === "low") return "Base inicial";
  return "Construyendo";
}

function toneFor(store: StorePulse) {
  if (store.status !== "ready" || store.variationPct === null) return "building";
  if (store.variationPct > 0.05) return "up";
  if (store.variationPct < -0.05) return "down";
  return "neutral";
}

function markerPosition(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 50;
  const clamped = Math.max(-8, Math.min(8, value));
  return 50 + (clamped / 8) * 45;
}

export default function WeightedPricePulsePortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [payload, setPayload] = useState<PulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let activeTarget: HTMLElement | null = null;

    const syncTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>(".hero-console");
      if (nextTarget === activeTarget) return;
      activeTarget?.classList.remove(styles.replaced);
      activeTarget = nextTarget;
      activeTarget?.classList.add(styles.replaced);
      setTarget(activeTarget);
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      activeTarget?.classList.remove(styles.replaced);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let inFlight = false;

    const load = async (initial: boolean) => {
      if (disposed || inFlight) return;
      inFlight = true;
      controller?.abort();
      controller = new AbortController();
      if (initial) setLoading(true);
      else setSyncing(true);

      try {
        const response = await fetch(`/api/weighted-price-pulse?live=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as PulsePayload;
        if (!response.ok) throw new Error(data.error || "No fue posible cargar la variación ponderada");
        if (disposed) return;
        setPayload(data);
        setError("");
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (!disposed) setError(reason instanceof Error ? reason.message : "No fue posible cargar la variación ponderada");
      } finally {
        inFlight = false;
        if (!disposed) {
          setLoading(false);
          setSyncing(false);
        }
      }
    };

    void load(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, POLLING_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [target]);

  const stores = useMemo(() => STORE_ORDER.map((supermarket) => payload?.data.find((item) => item.supermarket === supermarket) ?? {
    supermarket,
    variationPct: null,
    weightedCurrent: null,
    weightedPrevious: null,
    matchedSkus: 0,
    currentSkus: 0,
    previousSkus: 0,
    coveragePct: null,
    status: "building" as const,
    confidence: "building" as const,
    latestObservationAt: null,
  }), [payload]);

  if (!target) return null;

  return createPortal(
    <section className={styles.card} aria-label="Variación ponderada de precios por cadena">
      <header className={styles.header}>
        <div><span>MARKET PULSE</span><small>Canasta comparable</small></div>
        <b><i className={syncing ? styles.syncing : ""} />LIVE</b>
      </header>

      <div className={styles.title}>
        <strong>Variación ponderada</strong>
        <p>Precio de los mismos SKU versus {shortDate(payload?.previousDate ?? null)}</p>
      </div>

      {error && !payload ? <div className={styles.error}>{error}</div> : <div className={styles.storeGrid}>
        {stores.map((store) => {
          const tone = toneFor(store);
          const ready = store.status === "ready" && store.variationPct !== null;
          return <article key={store.supermarket} className={`${styles.storeCard} ${styles[tone]}`}>
            <div className={styles.storeHead}><span>{store.supermarket}</span><b>{confidenceLabel(store.confidence)}</b></div>
            <strong>{loading && !payload ? "—" : ready ? percentage(store.variationPct) : "—"}</strong>
            <p>{ready ? (store.variationPct ?? 0) > 0.05 ? "Sube vs ayer" : (store.variationPct ?? 0) < -0.05 ? "Baja vs ayer" : "Sin cambio relevante" : "Base comparable en construcción"}</p>
            <div className={styles.scale} aria-hidden><i /><span style={{ left: `${markerPosition(ready ? store.variationPct : null)}%` }} /></div>
            <small>{store.matchedSkus > 0 ? `${integer.format(store.matchedSkus)} SKU · ${store.coveragePct?.toFixed(1) ?? "0,0"}% cobertura` : `${integer.format(store.currentSkus)} SKU capturados hoy`}</small>
          </article>;
        })}
      </div>}

      <footer className={styles.footer}>
        <div><span>Índice ponderado</span><strong>Mismos SKU · valor de ayer como peso</strong></div>
        <small>Actualizado {timeLabel(payload?.latestObservationAt ?? null)} · extremos recortados</small>
      </footer>
    </section>,
    target,
  );
}
