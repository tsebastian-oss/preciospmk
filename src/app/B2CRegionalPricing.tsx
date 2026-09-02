"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./B2CRegionalPricing.module.css";

type PriceMap = Record<string, number>;

type RegionRow = {
  region: string;
  zone: string;
  complete: boolean;
  providerCount: number;
  prices: PriceMap;
  leader: string | null;
  leaderPrice: number | null;
  latestDate: string | null;
};

type ZoneRow = {
  zone: string;
  providerCount?: number;
  prices: PriceMap;
  leader: string | null;
  leaderPrice: number | null;
  coverageByProvider?: Record<string, number>;
};

type ServicePayload = {
  origin: string;
  weightKg: number;
  delivery: string;
  service: "Básico" | "Estándar" | "Prioritario";
  coverage: {
    completeRegions?: number;
    comparableRegions?: number;
    totalRegions?: number;
    latestDate?: string | null;
  };
  slaMap?: Record<string, string>;
  zones: ZoneRow[];
  regions: RegionRow[];
};

type MultiServicePayload = {
  weightKg: number;
  days: number;
  services: {
    Básico: ServicePayload | null;
    Estándar: ServicePayload | null;
    Prioritario: ServicePayload | null;
  };
  methodology?: {
    comparison?: string;
    slaWarning?: string;
    missingPolicy?: string;
  };
  error?: string;
};

const CX_SERVICES = ["Básico", "Estándar", "Prioritario"] as const;
const COMPETITORS = ["Starken", "Blue Express", "CorreosChile"] as const;

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

function gapPct(competitorPrice: number | undefined, cxPrice: number | undefined) {
  if (!competitorPrice || !cxPrice || competitorPrice <= 0 || cxPrice <= 0) return null;
  return (competitorPrice / cxPrice - 1) * 100;
}

function gapCopy(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.05) return "0,0%";
  return `${value > 0 ? "+" : ""}${pct.format(value)}%`;
}

function gapTone(value: number | null) {
  if (value == null) return styles.neutral;
  if (value > 3) return styles.bad;
  if (value < -3) return styles.good;
  return styles.neutral;
}

function regionMap(payload: ServicePayload | null | undefined) {
  return new Map((payload?.regions ?? []).map((row) => [row.region, row]));
}

function zoneMap(payload: ServicePayload | null | undefined) {
  return new Map((payload?.zones ?? []).map((row) => [row.zone, row]));
}

function comparisonCell(competitorPrice: number | undefined, cxPrices: Record<string, number | undefined>) {
  return <div className={styles.compareStack}>
    {CX_SERVICES.map((service) => {
      const value = gapPct(competitorPrice, cxPrices[service]);
      return <span key={service} className={`${styles.badge} ${gapTone(value)}`}>
        vs {service}: {gapCopy(value)}
      </span>;
    })}
  </div>;
}

export default function B2CRegionalPricing() {
  const [payload, setPayload] = useState<MultiServicePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [zone, setZone] = useState("Todas");
  const [weight, setWeight] = useState<number>(0.5);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/b2c-pricing/multi-service?days=30&weight=${weight}`, {
          cache: "no-store",
        });
        const result = await response.json() as MultiServicePayload;
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
  }, [weight]);

  const standard = payload?.services?.Estándar ?? null;
  const basic = payload?.services?.Básico ?? null;
  const priority = payload?.services?.Prioritario ?? null;

  const standardRegions = useMemo(
    () => (standard?.regions ?? []).filter((row) => zone === "Todas" || row.zone === zone),
    [standard, zone],
  );

  const basicRegions = useMemo(() => regionMap(basic), [basic]);
  const priorityRegions = useMemo(() => regionMap(priority), [priority]);
  const basicZones = useMemo(() => zoneMap(basic), [basic]);
  const priorityZones = useMemo(() => zoneMap(priority), [priority]);

  const cxCoverage = CX_SERVICES.map((service) => {
    const servicePayload = payload?.services?.[service];
    const count = (servicePayload?.regions ?? []).filter((row) => Number(row.prices?.Chilexpress ?? 0) > 0).length;
    return { service, count };
  });

  return <div className={styles.wrap}>
    <section className={styles.explainer}>
      <div>
        <span>B2C · MATRIZ MULTI-SERVICIO CHILEXPRESS</span>
        <h2>Competencia vs Básico, Estándar y Prioritario</h2>
        <p>Para cada ruta mostramos los tres precios Chilexpress por separado y enfrentamos la tarifa pública observada de cada competidor contra los tres niveles. Si un precio Chilexpress no fue capturado, queda vacío: no se infiere ni se aplica un descuento supuesto.</p>
      </div>
      <div className={styles.coverage}>
        <b>{cxCoverage.map((item) => `${item.service.slice(0, 1)} ${item.count}/16`).join(" · ")}</b>
        <span>rutas con precio Chilexpress capturado</span>
      </div>
    </section>

    <section className={styles.controls}>
      <label>Origen
        <select value="Santiago Centro" disabled>
          <option>Santiago Centro</option>
        </select>
      </label>
      <label>Peso homologado
        <select value={weight} onChange={(event) => setWeight(Number(event.target.value))}>
          <option value={0.5}>0–0,5 kg</option>
          <option value={3}>hasta 3 kg</option>
          <option value={6}>hasta 6 kg</option>
        </select>
      </label>
      <div className={styles.method}>
        <span>LÓGICA DE COMPARACIÓN</span>
        <b>Competidor observado vs 3 tarifas Chilexpress</b>
      </div>
    </section>

    {standard?.slaMap ? <section className={styles.slaMap}>
      {CX_SERVICES.map((service) => <div key={service}>
        <span>Chilexpress · {service}</span>
        <b>{payload?.services?.[service]?.slaMap?.Chilexpress || "Sin precio/SLA capturado aún"}</b>
      </div>)}
      <div>
        <span>Competidores</span>
        <b>Se conserva su tarifa pública observada y se compara en precio contra cada nivel Chilexpress.</b>
      </div>
    </section> : null}

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Calculando matriz multi-servicio…</div> : null}

    {!loading && standard ? <>
      <section className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <span>RESUMEN POR ZONA</span>
            <h3>Posición de precio contra los tres servicios Chilexpress</h3>
            <p>La tarifa de Starken, Blue Express y CorreosChile se mantiene una vez por zona; las brechas se calculan contra Básico, Estándar y Prioritario por separado.</p>
          </div>
          <small>Ref. {weight} kg · domicilio</small>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.multiTable}>
            <thead><tr>
              <th>Zona</th>
              <th>CX Básico</th>
              <th>CX Estándar</th>
              <th>CX Prioritario</th>
              {COMPETITORS.map((competitor) => <th key={competitor}>{competitor}<br/>Precio + gap vs CX</th>)}
            </tr></thead>
            <tbody>
              {(standard.zones ?? []).map((row) => {
                const basicRow = basicZones.get(row.zone);
                const priorityRow = priorityZones.get(row.zone);
                const cxPrices = {
                  Básico: basicRow?.prices?.Chilexpress,
                  Estándar: row.prices?.Chilexpress,
                  Prioritario: priorityRow?.prices?.Chilexpress,
                };
                return <tr key={row.zone}>
                  <td><b>{row.zone}</b></td>
                  <td className={styles.chilexpress}>{price(cxPrices.Básico)}</td>
                  <td className={styles.chilexpress}>{price(cxPrices.Estándar)}</td>
                  <td className={styles.chilexpress}>{price(cxPrices.Prioritario)}</td>
                  {COMPETITORS.map((competitor) => <td key={competitor}>
                    <strong>{price(row.prices?.[competitor])}</strong>
                    {comparisonCell(row.prices?.[competitor], cxPrices)}
                  </td>)}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <span>DETALLE POR RUTA</span>
            <h3>Comparativa granular por región</h3>
            <p>Cada porcentaje responde a: precio competidor / precio Chilexpress − 1. Un valor negativo significa que el competidor es más barato; positivo, que es más caro.</p>
          </div>
          <div className={styles.zoneTabs}>
            {["Todas", "Norte", "Centro", "Sur"].map((item) =>
              <button key={item} type="button" className={zone === item ? styles.active : ""} onClick={() => setZone(item)}>{item}</button>
            )}
          </div>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.multiTable}>
            <thead><tr>
              <th>Región</th>
              <th>Zona</th>
              <th>CX Básico</th>
              <th>CX Estándar</th>
              <th>CX Prioritario</th>
              {COMPETITORS.map((competitor) => <th key={competitor}>{competitor}<br/>Precio + gap vs CX</th>)}
              <th>Última ref.</th>
            </tr></thead>
            <tbody>
              {standardRegions.map((row) => {
                const basicRow = basicRegions.get(row.region);
                const priorityRow = priorityRegions.get(row.region);
                const cxPrices = {
                  Básico: basicRow?.prices?.Chilexpress,
                  Estándar: row.prices?.Chilexpress,
                  Prioritario: priorityRow?.prices?.Chilexpress,
                };
                return <tr key={row.region}>
                  <td><b>{row.region}</b></td>
                  <td><span className={styles.zonePill}>{row.zone}</span></td>
                  <td className={styles.chilexpress}>{price(cxPrices.Básico)}</td>
                  <td className={styles.chilexpress}>{price(cxPrices.Estándar)}</td>
                  <td className={styles.chilexpress}>{price(cxPrices.Prioritario)}</td>
                  {COMPETITORS.map((competitor) => <td key={competitor}>
                    <strong>{price(row.prices?.[competitor])}</strong>
                    {comparisonCell(row.prices?.[competitor], cxPrices)}
                  </td>)}
                  <td>{row.latestDate || "—"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.reading}>
        <div>
          <span>Lectura comercial</span>
          <b>Una misma tarifa competidora se enfrenta a los tres precios Chilexpress.</b>
          <p>Esto permite ver, por ejemplo, si Blue es más barato que Estándar pero más caro que Básico, o si Prioritario sostiene un premium por velocidad.</p>
        </div>
        <div>
          <span>Disciplina de datos</span>
          <b>No completamos Básico/Prioritario con supuestos.</b>
          <p>Mientras el cotizador no entregue una observación válida para ese nivel y ruta, la celda aparece vacía.</p>
        </div>
        <div>
          <span>SLA</span>
          <b>Precio y nivel de servicio siguen separados.</b>
          <p>La comparación muestra posición de precio. No afirma equivalencia de promesa de entrega cuando el competidor no publica un SLA idéntico.</p>
        </div>
      </section>
    </> : null}
  </div>;
}
