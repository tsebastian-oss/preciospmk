"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./B2BPricing.module.css";

type Numeric = number | string | null;
type Metric = "shipment" | "kg" | "km" | "kgkm" | "index";
type Layer = "public" | "b2b" | "best";

type ComparableRow = {
  profileKey: string; serviceType: string | null; weightBand: string | null; distanceBand: string | null;
  providerGroup: string; providerName: string; medianShipmentPrice: Numeric; medianPricePerKg: Numeric;
  medianPricePerKm: Numeric; medianPricePerKgKm: Numeric; marketMedianShipmentPrice: Numeric;
  marketMedianPricePerKg: Numeric; marketMedianPricePerKm: Numeric; marketMedianPricePerKgKm: Numeric;
  providersInProfile: Numeric; indexVsMarket: Numeric; latestDate: string | null; confidence: Numeric;
  originLabel: string | null; destinationLabel: string | null; sourceKinds?: string[]; sourceLayers?: string[];
};
type Observation = { id: number; providerGroup: string; buyerName: string | null; serviceType: string | null; description: string | null; unitPriceClp: Numeric; totalAmountClp: Numeric; processDate: string | null; sourceUrl: string | null; sourceKind: string | null; };
type Payload = { layer?: Layer; summary: Record<string, Numeric> & { latestDate?: string | null; lastIngestedAt?: string | null }; providers: Array<{ providerGroup: string }>; recent: Observation[]; normalized?: { layer?: Layer; summary: Record<string, Numeric> & { latestDate?: string | null }; rows: ComparableRow[]; }; annexes?: Record<string, Numeric>; error?: string; };

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const WEIGHT_BANDS = ["0–0,5 kg", "0,51–1,5 kg", "1,51–3 kg", "3,01–6 kg", "6,01–10 kg", "10,1–15 kg", "15+ kg"];
const DISTANCE_BANDS = ["0–50 km", "50–200 km", "200–500 km", "500–1.000 km", "1.000+ km"];
const COURIER_ORDER = ["Chilexpress", "Blue Express", "Starken", "CorreosChile"];
function n(value: Numeric | undefined) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function date(value?: string | null) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(d); }
function metricValue(row: ComparableRow, metric: Metric) { if (metric === "kg") return n(row.medianPricePerKg); if (metric === "km") return n(row.medianPricePerKm); if (metric === "kgkm") return n(row.medianPricePerKgKm); if (metric === "index") return n(row.indexVsMarket); return n(row.medianShipmentPrice); }
function marketValue(row: ComparableRow, metric: Metric) { if (metric === "kg") return n(row.marketMedianPricePerKg); if (metric === "km") return n(row.marketMedianPricePerKm); if (metric === "kgkm") return n(row.marketMedianPricePerKgKm); if (metric === "index") return 100; return n(row.marketMedianShipmentPrice); }
function formatMetric(value: number, metric: Metric) { if (!value) return "—"; return metric === "index" ? decimal.format(value) : money.format(value); }
function layerLabel(layer: Layer) { if (layer === "b2b") return "B2B observado · Mercado Público"; if (layer === "best") return "Mejor precio observado"; return "Tarifa comercial pública"; }

export default function B2BPricing() {
  const [days, setDays] = useState(365); const [layer, setLayer] = useState<Layer>("public"); const [metric, setMetric] = useState<Metric>("shipment");
  const [weightBand, setWeightBand] = useState("all"); const [distanceBand, setDistanceBand] = useState("all"); const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [notice, setNotice] = useState("");

  const load = useCallback(async () => { setLoading(true); try { const response = await fetch(`/api/b2b-pricing?category=courier&days=${days}&layer=${layer}&live=${Date.now()}`, { cache: "no-store" }); const payload = await response.json() as Payload; if (!response.ok) throw new Error(payload.error || "No fue posible cargar Pricing B2B"); setData(payload); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando Pricing B2B"); } finally { setLoading(false); } }, [days, layer]);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); setNotice(""); try { const response = await fetch("/api/b2b-pricing/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ months: 6, maxPages: 12, includeAnnexes: true }) }); const result = await response.json() as { matched?: number; error?: string }; if (!response.ok) throw new Error(result.error || "No fue posible actualizar fuentes B2B"); setNotice(`Fuentes actualizadas: ${nf.format(Number(result.matched || 0))} procesos courier revisados.`); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Error actualizando fuentes B2B"); } finally { setRefreshing(false); } };

  const normalized = data?.normalized ?? { summary: {}, rows: [] };
  const filteredRows = useMemo(() => (normalized.rows ?? []).filter((row) => (weightBand === "all" || row.weightBand === weightBand) && (distanceBand === "all" || row.distanceBand === distanceBand)), [normalized.rows, weightBand, distanceBand]);
  const couriers = useMemo(() => Array.from(new Set(filteredRows.map((row) => row.providerGroup))).sort((a,b) => { const ai=COURIER_ORDER.indexOf(a), bi=COURIER_ORDER.indexOf(b); if (ai>=0 || bi>=0) return (ai<0?99:ai)-(bi<0?99:bi); return a.localeCompare(b); }), [filteredRows]);
  const matrix = useMemo(() => { const map = new Map<string, ComparableRow[]>(); for (const row of filteredRows) map.set(row.profileKey, [...(map.get(row.profileKey) ?? []), row]); return Array.from(map.entries()).map(([profileKey, rows]) => ({ profileKey, rows })); }, [filteredRows]);

  return <section className={styles.shell}>
    <div className={styles.hero}><div><div className={styles.eyebrow}>B2B PRICE INTELLIGENCE</div><h1>Pricing B2B</h1><p>Matriz competitiva por ruta y peso. Compara tarifa pública, pricing B2B observado en Mercado Público o el mejor precio comparable disponible.</p></div><div className={styles.sourceBadge}><i/> {layerLabel(layer).toUpperCase()}</div></div>
    <div className={styles.toolbar}>
      <label>Capa de precio<select value={layer} onChange={(e) => setLayer(e.target.value as Layer)}><option value="public">Tarifa comercial pública</option><option value="b2b">B2B observado · Mercado Público</option><option value="best">Mejor precio observado</option></select></label>
      <label>Métrica<select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}><option value="shipment">Precio / envío</option><option value="kg">$/kg</option><option value="km">$/km</option><option value="kgkm">$/kg-km</option><option value="index">Índice vs mercado</option></select></label>
      <label>Período<select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={90}>90 días</option><option value={180}>180 días</option><option value={365}>12 meses</option><option value={730}>24 meses</option></select></label>
      <label>Peso<select value={weightBand} onChange={(e) => setWeightBand(e.target.value)}><option value="all">Todos</option>{WEIGHT_BANDS.map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Distancia<select value={distanceBand} onChange={(e) => setDistanceBand(e.target.value)}><option value="all">Todas</option>{DISTANCE_BANDS.map(v => <option key={v}>{v}</option>)}</select></label>
      <button className={styles.refresh} onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar fuentes"}</button>
    </div>
    {notice ? <div className={styles.notice}>{notice}</div> : null}{loading ? <div className={styles.loading}>Cargando matriz competitiva…</div> : null}
    {!loading && data ? <>
      <article className={styles.normalizedCard}>
        <header className={styles.normalizedHeader}><div><span>COMPETITOR PRICING MATRIX</span><h2>{layerLabel(layer)}</h2><p>Una tarifa de Mercado Público solo entra en esta matriz cuando el anexo u orden permite identificar una unidad comparable por ruta, peso o servicio. Contratos globales y adjudicaciones de $1 quedan fuera.</p></div><div className={styles.logicBadge}>{metric === "index" ? "100 = MEDIANA" : "MEDIANA COMPARABLE POR FILA"}</div></header>
        <div className={styles.normalizedKpis}><div><span>Tarifas comparables</span><strong>{nf.format(n(normalized.summary.comparableRows))}</strong><small>{layerLabel(layer)}</small></div><div><span>Perfiles</span><strong>{nf.format(n(normalized.summary.profiles))}</strong><small>Ruta + peso + servicio</small></div><div><span>Operadores</span><strong>{nf.format(n(normalized.summary.providers))}</strong><small>Con tarifas en esta capa</small></div><div><span>Anexos B2B</span><strong>{nf.format(n(data.annexes?.processed ?? data.annexes?.total ?? 0))}</strong><small>Documentos procesados</small></div></div>
        <div className={styles.tableWrap}><table className={styles.benchmarkTable}><thead><tr><th>Ruta / perfil</th>{couriers.map(c => <th key={c}>{c}</th>)}<th>Mediana mercado</th></tr></thead><tbody>
          {matrix.map(({profileKey, rows}) => { const ref=rows[0], market=marketValue(ref,metric), route=`${ref.originLabel || "?"} → ${ref.destinationLabel || "?"}`, values=rows.map(r=>metricValue(r,metric)).filter(v=>v>0), best=values.length?Math.min(...values):0; return <tr key={profileKey}><td><b>{route}</b><div className={styles.subline}>{ref.weightBand || "Sin peso"} · {ref.serviceType || "Courier"} · {ref.distanceBand || ""}</div></td>{couriers.map(c=>{ const row=rows.find(r=>r.providerGroup===c); if(!row) return <td key={c}>—</td>; const value=metricValue(row,metric), gap=metric==="index"?value-100:market>0?(value/market-1)*100:0, tone=gap<=-5?"#9de2b1":gap>=5?"#ffb0a8":"#e8edf2"; return <td key={c}><b style={{color:tone}}>{formatMetric(value,metric)}</b><div className={styles.subline}>{metric!=="index"&&market>0?`${gap>=0?"+":""}${gap.toFixed(1)}% vs mediana`:`${decimal.format(n(row.confidence))}% confianza`}</div>{value===best&&rows.length>1?<div className={styles.subline}>MENOR TARIFA</div>:null}</td>;})}<td><b>{formatMetric(market,metric)}</b><div className={styles.subline}>{nf.format(n(ref.providersInProfile))} operadores</div></td></tr>; })}
          {!matrix.length ? <tr><td colSpan={Math.max(3,couriers.length+2)} className={styles.empty}><b>No hay tarifas comparables en esta capa todavía.</b><br/>{layer === "b2b" ? "Los procesos y anexos de Mercado Público se muestran aquí solo cuando contienen pricing unitario comparable." : "Prueba otra capa o actualiza fuentes."}</td></tr> : null}
        </tbody></table></div><div className={styles.methodStrip}><b>Regla:</b> “B2B observado” usa únicamente tarifas comparables recuperadas desde órdenes/anexos públicos. “Mejor precio observado” selecciona el menor valor comparable disponible entre las capas comercial pública y B2B.</div>
      </article>
      <div className={styles.kpis}><article><span>Monto público observado</span><strong>{compactMoney.format(n(data.summary.marketAmount))}</strong><small>Contexto Mercado Público</small></article><article><span>Procesos</span><strong>{nf.format(n(data.summary.observations))}</strong><small>Compras públicas detectadas</small></article><article><span>Compradores</span><strong>{nf.format(n(data.summary.buyers))}</strong><small>Organismos públicos</small></article><article><span>Último comparable</span><strong style={{fontSize:16}}>{date(normalized.summary.latestDate)}</strong><small>Capa seleccionada</small></article><article><span>Última ingestión</span><strong style={{fontSize:16}}>{date(data.summary.lastIngestedAt)}</strong><small>Fuentes públicas</small></article></div>
      <article className={styles.tableCard}><header><div><span>PUBLIC PROCUREMENT CONTEXT</span><h2>Contratos y órdenes observadas</h2></div><small>Respaldo; no todos son tarifarios comparables</small></header><div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprador</th><th>Servicio</th><th>Descripción</th><th>Precio unit.</th><th>Monto</th><th>Fuente</th></tr></thead><tbody>{(data.recent??[]).map(row=><tr key={row.id}><td>{date(row.processDate)}</td><td><b>{row.providerGroup}</b></td><td>{row.buyerName||"—"}</td><td>{row.serviceType||"—"}</td><td className={styles.description}>{row.description||"—"}</td><td>{n(row.unitPriceClp)>0?money.format(n(row.unitPriceClp)):"—"}</td><td>{n(row.totalAmountClp)>0?money.format(n(row.totalAmountClp)):"—"}</td><td>{row.sourceUrl?<a href={row.sourceUrl} target="_blank" rel="noreferrer">Mercado Público ↗</a>:"Mercado Público"}</td></tr>)}{!data.recent?.length?<tr><td colSpan={8} className={styles.empty}>Sin registros para el período.</td></tr>:null}</tbody></table></div></article>
    </> : null}
  </section>;
}
