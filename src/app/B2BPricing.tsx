"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./B2BPricing.module.css";

type Numeric = number | string | null;
type Provider = {
  providerGroup: string;
  providerName: string;
  observations: Numeric;
  buyers: Numeric;
  amount: Numeric;
  sharePct: Numeric;
  medianUnitPrice: Numeric;
  minUnitPrice: Numeric;
  maxUnitPrice: Numeric;
  latestDate: string | null;
};
type Service = { serviceType: string; observations: Numeric; amount: Numeric; medianUnitPrice: Numeric };
type Observation = {
  id: number;
  providerGroup: string;
  providerName: string;
  buyerName: string | null;
  serviceType: string | null;
  classificationCode: string | null;
  description: string | null;
  quantity: Numeric;
  unit: string | null;
  unitPriceClp: Numeric;
  totalAmountClp: Numeric;
  priceBasis: string | null;
  processDate: string | null;
  sourceUrl: string | null;
  sourceKind: string | null;
};
type Payload = {
  category: string;
  days: number;
  summary: {
    observations?: Numeric;
    providers?: Numeric;
    buyers?: Numeric;
    marketAmount?: Numeric;
    medianUnitPrice?: Numeric;
    latestDate?: string | null;
    lastIngestedAt?: string | null;
  };
  providers: Provider[];
  services: Service[];
  recent: Observation[];
  source: string;
  error?: string;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
function n(value: Numeric) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function date(value?: string | null) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(d); }
function sourceKind(value?: string | null) {
  if (value === "trato_directo") return "Trato directo";
  if (value === "convenio_marco") return "Convenio Marco";
  if (value === "licitacion") return "Licitación";
  return value || "Mercado Público";
}

export default function B2BPricing() {
  const [days, setDays] = useState(365);
  const [provider, setProvider] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/b2b-pricing?category=courier&days=${days}&live=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar Pricing B2B");
      setData(payload);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando Pricing B2B");
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 2, maxPages: 6 }),
      });
      const result = await response.json() as { matched?: number; ingested?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible actualizar Mercado Público");
      setNotice(`Fuente actualizada: ${nf.format(Number(result.matched || 0))} observaciones courier detectadas.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando Mercado Público");
    } finally { setRefreshing(false); }
  };

  const providers = data?.providers ?? [];
  const providerOptions = providers.map((item) => item.providerGroup);
  const rows = useMemo(() => (data?.recent ?? []).filter((row) => provider === "all" || row.providerGroup === provider), [data, provider]);
  const maxShare = Math.max(1, ...providers.map((item) => n(item.sharePct)));

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>B2B PRICE INTELLIGENCE</div>
        <h1>Pricing B2B</h1>
        <p>Inteligencia de precios transados en compras públicas. Primera vertical: courier, mensajería y logística.</p>
      </div>
      <div className={styles.sourceBadge}><i/> MERCADO PÚBLICO · OCDS</div>
    </div>

    <div className={styles.toolbar}>
      <label>Vertical<select value="courier" disabled><option>Courier & Logistics</option></select></label>
      <label>Período<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={90}>90 días</option><option value={180}>180 días</option><option value={365}>12 meses</option><option value={730}>24 meses</option></select></label>
      <label>Proveedor<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">Todos</option>{providerOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <button className={styles.refresh} onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar Mercado Público"}</button>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Cargando inteligencia B2B…</div> : null}

    {!loading && data ? <>
      <div className={styles.kpis}>
        <article><span>Monto observado</span><strong>{compactMoney.format(n(data.summary.marketAmount))}</strong><small>Compras públicas clasificadas como courier</small></article>
        <article><span>Observaciones</span><strong>{nf.format(n(data.summary.observations))}</strong><small>Ítems / adjudicaciones detectadas</small></article>
        <article><span>Proveedores</span><strong>{nf.format(n(data.summary.providers))}</strong><small>Operadores con actividad observada</small></article>
        <article><span>Compradores</span><strong>{nf.format(n(data.summary.buyers))}</strong><small>Organismos públicos distintos</small></article>
        <article><span>Precio unitario mediano</span><strong>{n(data.summary.medianUnitPrice) > 0 ? money.format(n(data.summary.medianUnitPrice)) : "—"}</strong><small>Solo comparables con precio unitario público</small></article>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header><div><span>COMPETITIVE LANDSCAPE</span><h2>Participación por monto observado</h2></div><small>Último dato {date(data.summary.latestDate)}</small></header>
          <div className={styles.providerBars}>{providers.length ? providers.map((item) => <div className={styles.providerRow} key={item.providerGroup}>
            <div className={styles.providerHead}><strong>{item.providerGroup}</strong><span>{n(item.sharePct).toFixed(1)}%</span></div>
            <div className={styles.track}><i style={{ width: `${Math.max(2, n(item.sharePct) / maxShare * 100)}%` }}/></div>
            <div className={styles.providerMeta}><span>{compactMoney.format(n(item.amount))}</span><span>{nf.format(n(item.observations))} obs.</span><span>{nf.format(n(item.buyers))} compradores</span></div>
          </div>) : <div className={styles.empty}>Aún no hay observaciones cargadas. Usa “Actualizar Mercado Público”.</div>}</div>
        </article>

        <article className={styles.card}>
          <header><div><span>SERVICE MIX</span><h2>Tipos de servicio</h2></div></header>
          <div className={styles.services}>{(data.services ?? []).slice(0, 8).map((item) => <div key={item.serviceType}><strong>{item.serviceType}</strong><span>{nf.format(n(item.observations))} obs.</span><b>{compactMoney.format(n(item.amount))}</b></div>)}</div>
          <div className={styles.method}><strong>Cómo leerlo</strong><p>Separamos contratos y órdenes por clasificación ONU, texto del servicio y proveedor. No tratamos un contrato anual como si fuera una tarifa por envío: el campo “base de precio” distingue precio unitario y monto adjudicado.</p></div>
        </article>
      </div>

      <article className={styles.tableCard}>
        <header><div><span>PUBLIC B2B AWARDS</span><h2>Detalle granular de precios públicos</h2></div><small>{rows.length} registros visibles</small></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprador</th><th>Servicio</th><th>Descripción</th><th>Precio unit.</th><th>Monto</th><th>Proceso</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td>{date(row.processDate)}</td><td><b>{row.providerGroup}</b></td><td>{row.buyerName || "—"}</td><td>{row.serviceType || "—"}</td><td className={styles.description}>{row.description || "—"}</td><td>{n(row.unitPriceClp) > 0 ? money.format(n(row.unitPriceClp)) : "—"}</td><td>{n(row.totalAmountClp) > 0 ? money.format(n(row.totalAmountClp)) : "—"}</td><td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{sourceKind(row.sourceKind)} ↗</a> : sourceKind(row.sourceKind)}</td></tr>)}
          {!rows.length ? <tr><td colSpan={8} className={styles.empty}>Sin observaciones para los filtros seleccionados.</td></tr> : null}
        </tbody></table></div>
      </article>

      <div className={styles.footnote}>Fuente: datos públicos de Mercado Público / ChileCompra bajo estándar OCDS. Este módulo representa mercado público observado; no pretende representar contratos privados no publicados. Última ingestión: {date(data.summary.lastIngestedAt)}.</div>
    </> : null}
  </section>;
}
