"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./B2CRegionalPricing.module.css";

type PriceMap = Record<string, number>;

type ZoneRow = {
  zone: string;
  completeRegions: number;
  prices: PriceMap;
  leader: string | null;
  leaderPrice: number | null;
  chilexpressPremiumPct: number | null;
};

type RegionRow = {
  region: string;
  zone: string;
  complete: boolean;
  providerCount: number;
  prices: PriceMap;
  leader: string | null;
  leaderPrice: number | null;
  chilexpressPremiumPct: number | null;
  latestDate: string | null;
};

type Payload = {
  origin: string;
  weightKg: number;
  delivery: string;
  service: string;
  providers: string[];
  coverage: {
    completeRegions?: number;
    totalRegions?: number;
    latestDate?: string | null;
  };
  zones: ZoneRow[];
  regions: RegionRow[];
  notes?: string[];
};

const PROVIDERS = ["Chilexpress", "Starken", "Blue Express", "CorreosChile"] as const;\nconst providerLabel = (provider: string) => provider === "Chilexpress" ? "Chilexpress · Estándar" : provider;
const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const pct = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

function price(value: number | undefined | null) {
  return value && value > 0 ? money.format(value) : "—";
}

function premium(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.05) return "0,0%";
  return `${value > 0 ? "+" : ""}${pct.format(value)}%`;
}

function premiumTone(value: number | null | undefined) {
  if (value === null || value === undefined) return styles.neutral;
  if (value > 3) return styles.bad;
  if (value < -3) return styles.good;
  return styles.neutral;
}

export default function B2CRegionalPricing() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("Todas");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/b2c-pricing/regions?days=30&weight=0.5", {
          cache: "no-store",
        });
        const result = await response.json() as Payload & { error?: string };
        if (!response.ok) throw new Error(result.error || "No fue posible cargar el benchmark B2C");
        if (!cancelled) {
          setPayload(result);
          setNotice("");
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Error cargando benchmark B2C");
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  const regions = useMemo(
    () => (payload?.regions ?? []).filter((row) => zone === "Todas" || row.zone === zone),
    [payload, zone],
  );

  return <div className={styles.wrap}>
    <section className={styles.explainer}>
      <div>
        <span>B2C · BENCHMARK HOMOLOGADO</span>
        <h2>El mismo envío, comparado en los 4 couriers</h2>
        <p>Origen fijo en Santiago Centro, entrega a domicilio y paquete de 0,5 kg. La referencia Chilexpress usada hoy corresponde al servicio Estándar; Básico y Prioritario se tratarán como niveles de servicio separados. Los promedios por zona usan solo regiones donde existen precios para los cuatro couriers.</p>
      </div>
      <div className={styles.coverage}>
        <b>{payload?.coverage?.completeRegions ?? 0}/{payload?.coverage?.totalRegions ?? 16}</b>
        <span>regiones comparables 4/4</span>
      </div>
    </section>

    <section className={styles.controls}>
      <label>Origen
        <select value="Santiago Centro" disabled>
          <option>Santiago Centro</option>
        </select>
      </label>
      <label>Paquete homologado
        <select value="0.5" disabled>
          <option value="0.5">0–0,5 kg · XS</option>
        </select>
      </label>
      <label>Entrega
        <select value="Domicilio" disabled>
          <option>Domicilio</option>
        </select>
      </label>
      <div className={styles.method}>
        <span>METODOLOGÍA</span>
        <b>Precio final publicado · promedio simple por región</b>
      </div>
    </section>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Calculando benchmark B2C homologado…</div> : null}

    {!loading && payload ? <>
      <section className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <span>RESUMEN EJECUTIVO</span>
            <h3>Precio promedio por zona</h3>
            <p>Norte, Centro y Sur calculados sobre la misma canasta regional comparable.</p>
          </div>
          <small>Ref. {payload.weightKg} kg · {payload.delivery} · Chilexpress Estándar</small>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.zoneTable}>
            <thead><tr>
              <th>Zona</th>
              {PROVIDERS.map((provider) => <th key={provider}>{providerLabel(provider)}</th>)}
              <th>Líder</th>
              <th>Chilexpress vs líder</th>
              <th>Cobertura</th>
            </tr></thead>
            <tbody>
              {payload.zones.map((row) => <tr key={row.zone}>
                <td><b>{row.zone}</b></td>
                {PROVIDERS.map((provider) => <td key={provider} className={provider === "Chilexpress" ? styles.chilexpress : ""}>{price(row.prices?.[provider])}</td>)}
                <td><span className={styles.leader}>{row.leader || "—"}</span></td>
                <td><span className={`${styles.badge} ${premiumTone(row.chilexpressPremiumPct)}`}>{premium(row.chilexpressPremiumPct)}</span></td>
                <td>{row.completeRegions} regiones</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <span>DETALLE REGIONAL</span>
            <h3>Precio por región</h3>
            <p>Selecciona una macrozona para leer rápidamente dónde se concentra el gap.</p>
          </div>
          <div className={styles.zoneTabs}>
            {["Todas", "Norte", "Centro", "Sur"].map((item) =>
              <button key={item} type="button" className={zone === item ? styles.active : ""} onClick={() => setZone(item)}>{item}</button>
            )}
          </div>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.regionTable}>
            <thead><tr>
              <th>Región</th>
              <th>Zona</th>
              {PROVIDERS.map((provider) => <th key={provider}>{providerLabel(provider)}</th>)}
              <th>Líder</th>
              <th>Chilexpress vs líder</th>
              <th>Estado</th>
            </tr></thead>
            <tbody>
              {regions.map((row) => <tr key={row.region}>
                <td><b>{row.region}</b></td>
                <td><span className={styles.zonePill}>{row.zone}</span></td>
                {PROVIDERS.map((provider) => <td key={provider} className={provider === "Chilexpress" ? styles.chilexpress : ""}>{price(row.prices?.[provider])}</td>)}
                <td>{row.leader || "—"}</td>
                <td><span className={`${styles.badge} ${premiumTone(row.chilexpressPremiumPct)}`}>{premium(row.chilexpressPremiumPct)}</span></td>
                <td><span className={row.complete ? styles.complete : styles.partial}>{row.complete ? "4/4 comparable" : `${row.providerCount}/4 parcial`}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.reading}>
        <div>
          <span>Cómo leerlo</span>
          <b>El precio de zona no mezcla pesos ni tipos de entrega.</b>
          <p>Se promedian únicamente las regiones con cobertura completa para los cuatro couriers.</p>
        </div>
        <div>
          <span>CorreosChile</span>
          <b>INTRA / CERCA / LEJOS se traduce a región.</b>
          <p>Desde RM, las regiones extremas oficiales se asignan a LEJOS; RM a INTRA y el resto a CERCA.</p>
        </div>
        <div>
          <span>Siguiente capa</span>
          <b>Más pesos cuando exista cobertura 4/4.</b>
          <p>Por ahora 0,5 kg es el perfil realmente homologado en los cuatro competidores.</p>
        </div>
      </section>
    </> : null}
  </div>;
}
