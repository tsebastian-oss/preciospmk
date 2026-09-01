"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./chilexpress.module.css";

type ApiRow = {
  profileKey?: string;
  serviceType?: string;
  weightBand?: string;
  distanceBand?: string;
  providerGroup?: string;
  providerName?: string;
  medianShipmentPrice?: number | string | null;
  medianPricePerKg?: number | string | null;
  marketMedianShipmentPrice?: number | string | null;
  indexVsMarket?: number | string | null;
  latestDate?: string | null;
  originLabel?: string | null;
  destinationLabel?: string | null;
  sourceKinds?: string[];
  sourceLayers?: string[];
};

type Payload = {
  normalized?: { rows?: ApiRow[]; summary?: Record<string, unknown> };
  summary?: Record<string, unknown>;
  error?: string;
};

type RouteRow = {
  destination: string;
  weightBand: string;
  distanceBand: string;
  serviceType: string;
  chilexpress: number;
  competitor: number;
  competitorName: string;
  index: number;
  gap: number;
  latestDate: string;
  source: string;
};

type Message = { role: "user" | "assistant"; content: string };

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const NF = new Intl.NumberFormat("es-CL");

const FALLBACK: RouteRow[] = [
  ["Santiago Centro","0–0,5 kg","Sin distancia","Domicilio estándar / express",5975,3100,"Blue Express","2026-08-24"],
  ["Rancagua","0–0,5 kg","50–200 km","Domicilio estándar / express",11172,4000,"Blue Express","2026-08-24"],
  ["Valparaíso","0–0,5 kg","50–200 km","Domicilio estándar / express",10494,3900,"Blue Express","2026-08-24"],
  ["Talca","0–0,5 kg","200–500 km","Domicilio estándar / express",11812,4200,"Blue Express","2026-08-24"],
  ["Chillán","0–0,5 kg","200–500 km","Domicilio estándar / express",10768,4600,"Blue Express","2026-08-24"],
  ["Concepción","0–0,5 kg","200–500 km","Domicilio estándar / express",10768,4700,"Blue Express","2026-08-24"],
  ["La Serena","0–0,5 kg","200–500 km","Domicilio estándar / express",12092,4600,"Blue Express","2026-08-24"],
  ["Copiapó","0–0,5 kg","500–1.000 km","Domicilio estándar / express",12092,4850,"Blue Express","2026-08-24"],
  ["Temuco","0–0,5 kg","500–1.000 km","Domicilio estándar / express",11812,4950,"Blue Express","2026-08-24"],
  ["Valdivia","0–0,5 kg","500–1.000 km","Domicilio estándar / express",11812,5300,"Blue Express","2026-08-24"],
  ["Puerto Montt","0–0,5 kg","500–1.000 km","Domicilio estándar / express",13652,5300,"Blue Express","2026-08-24"],
  ["Antofagasta","0–0,5 kg","1.000+ km","Domicilio estándar / express",31144,6300,"Blue Express","2026-08-24"],
  ["Iquique","0–0,5 kg","1.000+ km","Domicilio estándar / express",35798,6550,"Blue Express","2026-08-24"],
  ["Arica","0–0,5 kg","1.000+ km","Domicilio estándar / express",35798,7150,"Blue Express","2026-08-24"],
].map(([destination, weightBand, distanceBand, serviceType, chilexpress, competitor, competitorName, latestDate]) => {
  const chx = Number(chilexpress);
  const comp = Number(competitor);
  return {
    destination: String(destination),
    weightBand: String(weightBand),
    distanceBand: String(distanceBand),
    serviceType: String(serviceType),
    chilexpress: chx,
    competitor: comp,
    competitorName: String(competitorName),
    index: comp > 0 ? Math.round((chx / comp) * 1000) / 10 : 0,
    gap: chx - comp,
    latestDate: String(latestDate),
    source: "Tarifa pública observada",
  };
});

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]) {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dateLabel(value: string) {
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function normalizeLive(rows: ApiRow[]): RouteRow[] {
  const exact = rows.filter((row) => row.providerGroup && row.destinationLabel && num(row.medianShipmentPrice) > 0);
  const map = new Map<string, ApiRow[]>();
  for (const row of exact) {
    const key = [row.originLabel || "Santiago Centro", row.destinationLabel, row.weightBand || "", row.serviceType || ""].join("|");
    const bucket = map.get(key) ?? [];
    bucket.push(row);
    map.set(key, bucket);
  }
  const out: RouteRow[] = [];
  for (const group of map.values()) {
    const own = group.find((row) => row.providerGroup?.toLowerCase() === "chilexpress");
    if (!own) continue;
    const competitors = group.filter((row) => row.providerGroup?.toLowerCase() !== "chilexpress" && num(row.medianShipmentPrice) > 0);
    if (!competitors.length) continue;
    const compPrice = median(competitors.map((row) => num(row.medianShipmentPrice)));
    const compNames = [...new Set(competitors.map((row) => row.providerGroup || "Mercado"))];
    const ownPrice = num(own.medianShipmentPrice);
    out.push({
      destination: own.destinationLabel || "—",
      weightBand: own.weightBand || "—",
      distanceBand: own.distanceBand || "—",
      serviceType: own.serviceType || "Courier",
      chilexpress: ownPrice,
      competitor: compPrice,
      competitorName: compNames.join(" / "),
      index: compPrice > 0 ? Math.round((ownPrice / compPrice) * 1000) / 10 : 0,
      gap: ownPrice - compPrice,
      latestDate: own.latestDate || competitors[0]?.latestDate || "2026-08-24",
      source: Array.isArray(own.sourceKinds) && own.sourceKinds.length ? own.sourceKinds.join(", ") : "Tarifa pública observada",
    });
  }
  const dedup = new Map<string, RouteRow>();
  for (const row of out) {
    const key = [row.destination, row.weightBand, row.serviceType].join("|");
    if (!dedup.has(key)) dedup.set(key, row);
  }
  return [...dedup.values()].sort((a, b) => a.index - b.index);
}

function tone(index: number) {
  if (index >= 180) return "critical";
  if (index >= 130) return "danger";
  if (index >= 105) return "warn";
  if (index < 95) return "good";
  return "neutral";
}

function opportunity(index: number) {
  if (index >= 180) return "Revisión urgente";
  if (index >= 130) return "Premium alto";
  if (index >= 105) return "Premium moderado";
  if (index < 95) return "Espacio potencial";
  return "Paridad";
}

function localAnswer(question: string, rows: RouteRow[]) {
  const q = question.toLocaleLowerCase("es-CL");
  const sorted = [...rows].sort((a, b) => b.index - a.index);
  const avg = rows.length ? rows.reduce((s, r) => s + r.index, 0) / rows.length : 0;
  const max = sorted[0];
  const min = [...rows].sort((a, b) => a.index - b.index)[0];
  if (q.includes("más caro") || q.includes("premium") || q.includes("riesgo")) {
    return `Conclusión: Chilexpress está por encima del benchmark en la muestra comparable.\n\n• Mayor premium: ${max?.destination || "—"} — índice ${max?.index.toFixed(0) || "—"} (mercado = 100).\n• Gap por envío: ${max ? CLP.format(max.gap) : "—"}.\n• Índice promedio de la muestra: ${avg.toFixed(0)}.\n\nPrioridad sugerida: revisar primero rutas con índice superior a 180 y validar si el diferencial se explica por SLA, cobertura, seguros o atributos de servicio.`;
  }
  if (q.includes("subir") || q.includes("aumentar")) {
    const candidates = rows.filter((r) => r.index < 95);
    return candidates.length
      ? `Hay ${candidates.length} rutas con índice bajo 95 donde podría existir espacio para aumentar precio sin superar el benchmark actual. Conviene validar elasticidad y mix antes de ejecutar.`
      : "No veo rutas con índice bajo 95 en la cobertura comparable actual. Con estos datos, la prioridad no sería subir tarifa sino entender y gestionar los premiums existentes.";
  }
  if (q.includes("blue")) {
    return `Chilexpress vs Blue Express: el índice promedio comparable es ${avg.toFixed(0)}. La menor brecha está en ${min?.destination || "—"} (índice ${min?.index.toFixed(0) || "—"}) y la mayor en ${max?.destination || "—"} (índice ${max?.index.toFixed(0) || "—"}).`;
  }
  return `La muestra contiene ${rows.length} rutas comparables. El índice promedio Chilexpress vs benchmark es ${avg.toFixed(0)}. La principal alerta está en ${max?.destination || "—"}, con índice ${max?.index.toFixed(0) || "—"}. Puedes preguntarme por rutas, premiums, riesgo competitivo o espacios para ajustar tarifa.`;
}

export default function ChilexpressDemoPage() {
  const [rows, setRows] = useState<RouteRow[]>(FALLBACK);
  const [sourceMode, setSourceMode] = useState<"live" | "snapshot">("snapshot");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "benchmark" | "heatmap" | "opportunities" | "history" | "copilot">("overview");
  const [query, setQuery] = useState("");
  const [distance, setDistance] = useState("all");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Soy el Pricing Copilot de la demo Chilexpress. Puedo analizar premiums, brechas por ruta y prioridades de revisión usando exclusivamente la cobertura disponible." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/b2b-pricing?category=courier&days=1095&layer=best", { cache: "no-store" });
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar datos");
        const live = normalizeLive(payload.normalized?.rows ?? []);
        if (active && live.length >= 4) {
          setRows(live);
          setSourceMode("live");
        }
      } catch {
        if (active) {
          setRows(FALLBACK);
          setSourceMode("snapshot");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    if (distance !== "all" && row.distanceBand !== distance) return false;
    if (query.trim() && !`${row.destination} ${row.competitorName} ${row.serviceType}`.toLocaleLowerCase("es-CL").includes(query.trim().toLocaleLowerCase("es-CL"))) return false;
    return true;
  }), [rows, query, distance]);

  const stats = useMemo(() => {
    const indices = rows.map((r) => r.index).filter((v) => v > 0);
    const avg = indices.length ? indices.reduce((a, b) => a + b, 0) / indices.length : 0;
    const risk = rows.filter((r) => r.index >= 130).length;
    const upside = rows.filter((r) => r.index < 95).length;
    const latest = [...rows].map((r) => r.latestDate).sort().at(-1) || "2026-08-24";
    return { avg, risk, upside, latest };
  }, [rows]);

  const distances = useMemo(() => ["all", ...new Set(rows.map((r) => r.distanceBand))], [rows]);
  const sortedRisk = useMemo(() => [...rows].sort((a, b) => b.index - a.index), [rows]);

  async function ask(question: string) {
    const clean = question.trim();
    if (!clean || chatLoading) return;
    const next = [...messages, { role: "user" as const, content: clean }].slice(-10);
    setMessages(next);
    setChatInput("");
    setChatLoading(true);
    try {
      const response = await fetch("/api/chilexpress-pricing-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, routes: rows }),
        cache: "no-store",
      });
      const payload = await response.json() as { answer?: string };
      const answer = response.ok && payload.answer ? payload.answer : localAnswer(clean, rows);
      setMessages((current) => [...current, { role: "assistant", content: answer }].slice(-12));
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: localAnswer(clean, rows) }].slice(-12));
    } finally {
      setChatLoading(false);
    }
  }

  function submitChat(event: FormEvent) {
    event.preventDefault();
    void ask(chatInput);
  }

  return <main className={styles.page}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.mark}>M</div>
        <div><strong>MGP Pricing Intelligence</strong><span>Logistics Edition</span></div>
      </div>
      <div className={styles.client}>
        <span>CLIENT DEMO</span>
        <strong>Chilexpress</strong>
        <small>Pricing Intelligence Workspace</small>
      </div>
      <nav className={styles.nav}>
        {[
          ["overview","Overview","⌂"],
          ["benchmark","Benchmark","⇄"],
          ["heatmap","Price Index Map","▦"],
          ["opportunities","Opportunities","↗"],
          ["history","Evolución","⌁"],
          ["copilot","AI Copilot","✦"],
        ].map(([key,label,icon]) => <button key={key} className={tab === key ? styles.activeNav : ""} onClick={() => setTab(key as typeof tab)}><span>{icon}</span>{label}</button>)}
      </nav>
      <div className={styles.sidebarFoot}>
        <span className={sourceMode === "live" ? styles.liveDot : styles.snapshotDot}/>
        <div><strong>{sourceMode === "live" ? "Datos conectados" : "Snapshot de respaldo"}</strong><small>{dateLabel(stats.latest)}</small></div>
      </div>
    </aside>

    <section className={styles.content}>
      <header className={styles.topbar}>
        <div><span className={styles.eyebrow}>MGP × CHILEXPRESS</span><h1>Courier Pricing Intelligence</h1><p>Benchmark competitivo y detección de brechas tarifarias con evidencia pública normalizada.</p></div>
        <div className={styles.topActions}><span>{loading ? "Actualizando…" : sourceMode === "live" ? "Live data" : "Stable demo snapshot"}</span><button onClick={() => setTab("copilot")}>Preguntar al Copilot ✦</button></div>
      </header>

      {tab === "overview" && <>
        <div className={styles.kpis}>
          <article><span>Price Index promedio</span><strong>{stats.avg.toFixed(0)}</strong><small>benchmark competidor = 100</small></article>
          <article><span>Rutas comparables</span><strong>{NF.format(rows.length)}</strong><small>Santiago → destinos nacionales</small></article>
          <article><span>Premiums altos</span><strong>{NF.format(stats.risk)}</strong><small>índice ≥ 130</small></article>
          <article><span>Espacios potenciales</span><strong>{NF.format(stats.upside)}</strong><small>índice &lt; 95</small></article>
        </div>

        <div className={styles.heroGrid}>
          <article className={styles.panel}>
            <header><div><span>EXECUTIVE VIEW</span><h2>Posicionamiento competitivo</h2></div><b>Último corte · {dateLabel(stats.latest)}</b></header>
            <div className={styles.bigIndex}><strong>{stats.avg.toFixed(0)}</strong><span>Price Index</span><small>Un índice sobre 100 indica que Chilexpress está por encima del benchmark comparable.</small></div>
            <div className={styles.indexScale}><i style={{ width: `${Math.min(100, stats.avg / 2.4)}%` }}/></div>
            <div className={styles.callout}>
              <strong>Lectura ejecutiva</strong>
              <p>La cobertura actual muestra un premium relevante de Chilexpress frente a la tarifa pública comparable de Blue Express en envíos de hasta 0,5 kg. El valor de la plataforma está en identificar dónde esa brecha es estructural, dónde responde a atributos de servicio y dónde requiere acción comercial.</p>
            </div>
          </article>

          <article className={styles.panel}>
            <header><div><span>TOP ALERTS</span><h2>Rutas a revisar primero</h2></div><b>{stats.risk} alertas</b></header>
            <div className={styles.alertList}>
              {sortedRisk.slice(0, 5).map((row, i) => <div key={row.destination}><span className={styles.rank}>{String(i + 1).padStart(2, "0")}</span><div><strong>{row.destination}</strong><small>{row.weightBand} · {row.distanceBand}</small></div><b className={styles[tone(row.index)]}>{row.index.toFixed(0)}</b></div>)}
            </div>
          </article>
        </div>

        <article className={styles.panel}>
          <header><div><span>MARKET MATRIX</span><h2>Comparación rápida por destino</h2></div><button className={styles.linkButton} onClick={() => setTab("benchmark")}>Ver matriz completa →</button></header>
          <div className={styles.tableWrap}><table><thead><tr><th>Destino</th><th>Chilexpress</th><th>Benchmark</th><th>Gap</th><th>Index</th><th>Lectura</th></tr></thead><tbody>
            {sortedRisk.slice(0, 7).map((row) => <tr key={row.destination}><td><strong>{row.destination}</strong><small>{row.distanceBand}</small></td><td>{CLP.format(row.chilexpress)}</td><td>{CLP.format(row.competitor)}<small>{row.competitorName}</small></td><td>+{CLP.format(row.gap).replace("$","$")}</td><td><b className={styles[tone(row.index)]}>{row.index.toFixed(0)}</b></td><td>{opportunity(row.index)}</td></tr>)}
          </tbody></table></div>
        </article>
      </>}

      {tab === "benchmark" && <>
        <div className={styles.sectionTitle}><div><span>BENCHMARK</span><h2>Matriz comparativa de tarifas</h2><p>Comparación homogénea por ruta, banda de peso y tipo de servicio.</p></div></div>
        <div className={styles.filters}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar destino o competidor…" />
          <select value={distance} onChange={(e) => setDistance(e.target.value)}>{distances.map((d) => <option key={d} value={d}>{d === "all" ? "Todas las distancias" : d}</option>)}</select>
          <div className={styles.filterTag}>Peso: <strong>0–0,5 kg</strong></div>
          <div className={styles.filterTag}>Origen: <strong>Santiago</strong></div>
        </div>
        <article className={styles.panel}>
          <div className={styles.tableWrap}><table><thead><tr><th>Ruta</th><th>Peso</th><th>Chilexpress</th><th>Benchmark</th><th>Gap $</th><th>Price Index</th><th>Acción sugerida</th></tr></thead><tbody>
            {filtered.map((row) => <tr key={`${row.destination}-${row.weightBand}`}><td><strong>Santiago → {row.destination}</strong><small>{row.serviceType}</small></td><td>{row.weightBand}</td><td>{CLP.format(row.chilexpress)}</td><td>{CLP.format(row.competitor)}<small>{row.competitorName}</small></td><td>+{CLP.format(row.gap)}</td><td><b className={styles[tone(row.index)]}>{row.index.toFixed(0)}</b></td><td>{opportunity(row.index)}</td></tr>)}
          </tbody></table></div>
        </article>
      </>}

      {tab === "heatmap" && <>
        <div className={styles.sectionTitle}><div><span>PRICE INDEX MAP</span><h2>Mapa de brechas por corredor</h2><p>Visualización ejecutiva para priorizar dónde profundizar análisis.</p></div></div>
        <article className={styles.panel}>
          <div className={styles.legend}><span><i className={styles.goodBg}/> &lt;95 Espacio</span><span><i className={styles.neutralBg}/> 95–104 Paridad</span><span><i className={styles.warnBg}/> 105–129 Premium</span><span><i className={styles.dangerBg}/> 130–179 Alto</span><span><i className={styles.criticalBg}/> 180+ Crítico</span></div>
          <div className={styles.heatGrid}>
            {rows.slice().sort((a,b)=>a.index-b.index).map((row) => <div key={row.destination} className={`${styles.heatCell} ${styles[tone(row.index)+"Cell"]}`}><span>{row.destination}</span><strong>{row.index.toFixed(0)}</strong><small>{CLP.format(row.chilexpress)} vs {CLP.format(row.competitor)}</small></div>)}
          </div>
        </article>
      </>}

      {tab === "opportunities" && <>
        <div className={styles.sectionTitle}><div><span>OPPORTUNITIES</span><h2>Prioridades accionables</h2><p>La plataforma separa riesgo competitivo de espacios para capturar valor.</p></div></div>
        <div className={styles.opCards}>
          <article><span>RIESGO COMPETITIVO</span><strong>{stats.risk}</strong><p>rutas con índice ≥130. Requieren explicar premium, revisar producto comparable y validar conversión.</p></article>
          <article><span>ESPACIO DE ALZA</span><strong>{stats.upside}</strong><p>rutas bajo índice 95. Con la muestra actual no aparecen espacios evidentes para subir tarifa.</p></article>
          <article><span>MAYOR GAP</span><strong>{sortedRisk[0] ? CLP.format(sortedRisk[0].gap) : "—"}</strong><p>{sortedRisk[0]?.destination || "—"} · diferencia por envío comparable.</p></article>
        </div>
        <article className={styles.panel}>
          <header><div><span>ACTION QUEUE</span><h2>Cola priorizada de revisión</h2></div></header>
          <div className={styles.actionList}>{sortedRisk.map((row) => <div key={row.destination}><span className={styles[tone(row.index)]}>{row.index.toFixed(0)}</span><div><strong>Santiago → {row.destination}</strong><small>{row.distanceBand} · gap {CLP.format(row.gap)}</small></div><b>{opportunity(row.index)}</b><button onClick={() => { setTab("copilot"); void ask(`Analiza la ruta Santiago a ${row.destination} y dime qué revisar.`); }}>Analizar ✦</button></div>)}</div>
        </article>
      </>}

      {tab === "history" && <>
        <div className={styles.sectionTitle}><div><span>EVOLUCIÓN</span><h2>Histórico y evidencia temporal</h2><p>La serie se construye desde cada captura validada. No interpolamos fechas sin observación.</p></div></div>
        <div className={styles.historyGrid}>
          <article className={styles.panel}><header><div><span>PUBLIC RATE SNAPSHOT</span><h2>Tarifas públicas comparables</h2></div></header><div className={styles.timeline}><i/><div><strong>24 ago 2026</strong><p>Chilexpress y Blue Express · cobertura comparable Santiago → principales destinos · hasta 0,5 kg.</p></div></div></article>
          <article className={styles.panel}><header><div><span>B2B EVIDENCE</span><h2>Mercado Público</h2></div></header><div className={styles.timeline}><i/><div><strong>26 dic 2025</strong><p>CorreosChile · tarifario regional B2B observado en evidencia pública. Se mantiene separado de tarifa comercial pública.</p></div></div></article>
        </div>
        <article className={styles.panel}>
          <div className={styles.emptyHistory}><strong>El histórico continuo se poblará con cada corte.</strong><p>La demo evita fabricar una línea de tiempo donde no existe evidencia. Cuando haya nuevos snapshots, esta vista mostrará evolución por ruta, peso, proveedor e índice competitivo.</p></div>
        </article>
      </>}

      {tab === "copilot" && <>
        <div className={styles.sectionTitle}><div><span>AI COPILOT</span><h2>Analista conversacional de pricing</h2><p>Responde usando únicamente la cobertura disponible en la demo.</p></div></div>
        <article className={styles.chat}>
          <div className={styles.chatHeader}><div><span className={styles.aiOrb}>✦</span><div><strong>MGP Pricing Copilot</strong><small>Logistics Intelligence</small></div></div><span className={styles.aiStatus}>● Online</span></div>
          <div className={styles.messages}>
            {messages.map((message, i) => <div key={i} className={message.role === "user" ? styles.userMsg : styles.aiMsg}><span>{message.role === "user" ? "Tú" : "MGP"}</span><p>{message.content}</p></div>)}
            {chatLoading && <div className={styles.aiMsg}><span>MGP</span><p>Analizando la matriz competitiva…</p></div>}
          </div>
          <div className={styles.quickPrompts}>
            {["¿Dónde somos más caros que el mercado?","Compara Chilexpress vs Blue Express","¿Dónde podríamos subir precios?","¿Cuál es el principal riesgo competitivo?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={chatLoading}>{q}</button>)}
          </div>
          <form className={styles.composer} onSubmit={submitChat}><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Pregunta por rutas, gaps, premiums o acciones…" /><button disabled={!chatInput.trim() || chatLoading}>{chatLoading ? "…" : "Enviar ↗"}</button></form>
        </article>
      </>}

      <footer className={styles.footer}>Fuentes: tarifas públicas observadas y evidencia B2B pública normalizada. Los comparables se muestran solo cuando existe contexto suficiente de ruta, peso y servicio. MGP Pricing Intelligence · Demo Chilexpress.</footer>
    </section>
  </main>;
}
