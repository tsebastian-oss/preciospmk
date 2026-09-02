"use client";

// COURIER_SEGMENTED_ACCORDION_V1
// COURIER_COMPETITIVE_TABLE_V1

import { useCallback, useEffect, useMemo, useState } from "react";
import B2BProfitabilitySimulator from "./B2BProfitabilitySimulator";
import B2BDecisionLab from "./B2BDecisionLab";
import styles from "./CourierCompetitiveTable.module.css";

type Layer = "simulator" | "b2b" | "decisions";
type Numeric = number | string | null;
type MacroZone = "Norte" | "Centro" | "Sur";

type B2BTimeSeriesPoint = {
  date?: string | null;
  company?: string | null;
  plan?: string | null;
  channel?: string | null;
  preferredPlan?: boolean | null;
  origin?: string | null;
  destination?: string | null;
  weightBand?: string | null;
  weightKg?: Numeric;
  serviceType?: string | null;
  priceClp?: Numeric;
  observations?: Numeric;
  confidence?: Numeric;
};

type B2BTimeSeriesPayload = {
  points?: B2BTimeSeriesPoint[];
  error?: string;
};

type RegionalB2BCell = {
  price: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

const B2B_COMPANIES = ["Chilexpress", "Starken", "Blue Express", "CorreosChile"] as const;
const MACRO_ZONES: MacroZone[] = ["Norte", "Centro", "Sur"];
const B2B_MIN_SOURCE_CONFIDENCE = 90;
const B2B_MIN_CELL_CONFIDENCE = 82;

const ZONE_REFERENCE_DESTINATIONS: Record<MacroZone, string[]> = {
  Norte: ["Arica", "Iquique", "Antofagasta", "Copiapó", "La Serena"],
  Centro: ["Santiago", "Valparaíso", "Rancagua", "Talca"],
  Sur: ["Chillán", "Concepción", "Temuco", "Valdivia", "Puerto Montt"],
};

const COMPANY_PRIMARY_PYME_PLAN: Record<string, string[]> = {
  Chilexpress: ["Chilexpress"],
  "Blue Express": ["Blue Express Ecommerce 1–500", "Blue Express B2C / Público"],
  Starken: ["Starken Tarifa Simple"],
  CorreosChile: [
    "CorreosChile Aliados Bronce 10%",
    "CorreosChile Aliados Crecimiento 15%",
    "CorreosChile Aliados Consolidado 20%",
    "CorreosChile Aliados Gran volumen 25%",
  ],
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const pct = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

function n(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/\s+/g, " ")
    .trim();
}

function macroZoneForDestination(value: string | null | undefined): MacroZone | null {
  const key = cleanText(value);
  if (!key || key.startsWith("zona ")) return null;

  if (["arica", "iquique", "antofagasta", "calama", "copiapo", "la serena", "coquimbo", "ovalle"].some((item) => key.includes(item))) return "Norte";
  if (["santiago", "valparaiso", "vina del mar", "rancagua", "talca", "curico", "san antonio", "los andes"].some((item) => key.includes(item))) return "Centro";
  if (["chillan", "concepcion", "los angeles", "temuco", "valdivia", "osorno", "puerto montt", "castro", "coyhaique", "punta arenas"].some((item) => key.includes(item))) return "Sur";
  return null;
}

function augustToDecemberKeys() {
  return ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
}

function monthShortLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "short" }).format(parsed).replace(".", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function companyLabel(company: string) {
  return company === "CorreosChile" ? "Correos Chile" : company;
}

function selectBestPymePlan(company: string, plans: Map<string, B2BTimeSeriesPoint[]>) {
  const preferred = COMPANY_PRIMARY_PYME_PLAN[company] || [];
  for (const wanted of preferred) {
    if (plans.has(wanted)) return { plan: wanted, rows: plans.get(wanted) ?? [] };
  }

  const ranked = Array.from(plans.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    const avgA = a[1].reduce((sum, row) => sum + n(row.confidence), 0) / Math.max(1, a[1].length);
    const avgB = b[1].reduce((sum, row) => sum + n(row.confidence), 0) / Math.max(1, b[1].length);
    return avgB - avgA;
  });

  if (!ranked.length) return null;
  return { plan: ranked[0][0], rows: ranked[0][1] };
}

function buildRegionalB2B(points: B2BTimeSeriesPoint[], monthKeys: string[]) {
  type Bucket = { pymePlans: Map<string, B2BTimeSeriesPoint[]>; enterprise: B2BTimeSeriesPoint[] };
  const buckets = new Map<string, Bucket>();
  const monthSet = new Set(monthKeys);

  for (const point of points) {
    const month = String(point.date || "").slice(0, 7);
    if (!monthSet.has(month)) continue;

    const company = String(point.company || "");
    if (!(B2B_COMPANIES as readonly string[]).includes(company)) continue;

    const weight = n(point.weightKg);
    if (!(weight > 0 && weight <= 0.5001)) continue;
    if (n(point.confidence) < B2B_MIN_SOURCE_CONFIDENCE) continue;

    const origin = cleanText(point.origin);
    if (!origin.includes("santiago")) continue;

    const service = cleanText(point.serviceType);
    const isDomicile = service.includes("domic");
    const isGenericEnterprise =
      point.channel === "Mercado Público" &&
      !["punto", "sucursal", "agencia"].some((term) => service.includes(term));
    if (!isDomicile && !isGenericEnterprise) continue;

    const zone = macroZoneForDestination(point.destination);
    if (!zone) continue;

    const isPyme = point.channel === "Pyme / Emprendedores";
    const isEnterprise = point.channel === "Mercado Público";
    if (!isPyme && !isEnterprise) continue;
    if (!(n(point.priceClp) > 0)) continue;

    const key = `${zone}|${company}|${month}`;
    const bucket = buckets.get(key) ?? {
      pymePlans: new Map<string, B2BTimeSeriesPoint[]>(),
      enterprise: [],
    };

    if (isPyme) {
      const planKey = String(point.plan || "Pyme");
      bucket.pymePlans.set(planKey, [...(bucket.pymePlans.get(planKey) ?? []), point]);
    } else {
      bucket.enterprise.push(point);
    }

    buckets.set(key, bucket);
  }

  const cells = new Map<string, RegionalB2BCell>();

  for (const [key, bucket] of buckets.entries()) {
    const [, company] = key.split("|");
    const chosenPyme = selectBestPymePlan(company, bucket.pymePlans);
    const selected = chosenPyme?.rows?.length ? chosenPyme.rows : bucket.enterprise;
    if (!selected.length) continue;

    const sorted = [...selected].sort((a, b) => n(a.priceClp) - n(b.priceClp));
    const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
    const robust = trim > 0 ? sorted.slice(trim, sorted.length - trim) : sorted;

    let weightedPrice = 0;
    let weightedConfidence = 0;
    let totalWeight = 0;
    let observations = 0;
    const destinations = new Set<string>();

    for (const point of robust) {
      const confidence = n(point.confidence);
      const weightFactor = Math.max(0.5, confidence / 100);
      weightedPrice += n(point.priceClp) * weightFactor;
      weightedConfidence += confidence * weightFactor;
      totalWeight += weightFactor;
      observations += Math.max(1, n(point.observations));
      if (point.destination) destinations.add(cleanText(point.destination));
    }

    if (!(totalWeight > 0)) continue;

    const [zone] = key.split("|") as [MacroZone, string, string];
    const sourceConfidence = weightedConfidence / totalWeight;
    const targetCount = ZONE_REFERENCE_DESTINATIONS[zone].length;
    const coverage = Math.min(100, (destinations.size / Math.max(1, targetCount)) * 100);
    const sourceQuality = chosenPyme?.rows?.length ? 100 : 92;
    const cellConfidence = Math.round(sourceConfidence * 0.72 + coverage * 0.23 + sourceQuality * 0.05);
    if (cellConfidence < B2B_MIN_CELL_CONFIDENCE) continue;

    cells.set(key, {
      price: Math.round(weightedPrice / totalWeight),
      confidence: cellConfidence,
      destinations: destinations.size,
      observations,
      channel: chosenPyme?.rows?.length ? "Pyme" : "Empresa",
      plan: chosenPyme?.plan || "Mercado Público",
    });
  }

  return cells;
}

export default function B2BPricing() {
  const [layer, setLayer] = useState<Layer>("b2b");
  const [regionalPoints, setRegionalPoints] = useState<B2BTimeSeriesPoint[]>([]);
  const [regionalLoading, setRegionalLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("2026-09");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);

  const regionalMonths = useMemo(() => augustToDecemberKeys(), []);

  const loadRegional = useCallback(async () => {
    setRegionalLoading(true);
    try {
      const response = await fetch(
        "/api/b2b-pricing/timeseries?category=courier&days=1095&layer=b2b",
        { cache: "no-store" },
      );
      const result = await response.json() as B2BTimeSeriesPayload;
      if (!response.ok) throw new Error(result.error || "No fue posible cargar histórico regional B2B");
      setRegionalPoints(result.points ?? []);
    } catch (error) {
      setRegionalPoints([]);
      setNotice(error instanceof Error ? error.message : "No fue posible cargar histórico regional B2B");
    } finally {
      setRegionalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (layer === "b2b" || layer === "decisions") void loadRegional();
  }, [layer, loadRegional]);

  const regionalCells = useMemo(
    () => buildRegionalB2B(regionalPoints, regionalMonths),
    [regionalPoints, regionalMonths],
  );

  const chartZones = useMemo(() => {
    return MACRO_ZONES.map((zone) => {
      const rows = B2B_COMPANIES.map((company) => {
        const cell = regionalCells.get(`${zone}|${company}|${selectedMonth}`);
        if (!cell) return null;
        return {
          company,
          label: companyLabel(company),
          ...cell,
        };
      }).filter(Boolean) as Array<RegionalB2BCell & { company: string; label: string }>;

      rows.sort((a, b) => a.price - b.price);
      return { zone, rows };
    });
  }, [regionalCells, selectedMonth]);

  const insightSummary = useMemo(() => {
    const summaries = chartZones.map(({ zone, rows }) => {
      const leader = rows[0] ?? null;
      const chilexpress = rows.find((row) => row.company === "Chilexpress") ?? null;
      const premium =
        leader && chilexpress && leader.price > 0
          ? (chilexpress.price / leader.price - 1) * 100
          : null;
      return { zone, leader, chilexpress, premium };
    });

    const valid = summaries.filter((item) => item.premium !== null);
    const mostPremium = [...valid].sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity))[0] ?? null;
    const mostCompetitive = [...valid].sort((a, b) => (a.premium ?? Infinity) - (b.premium ?? Infinity))[0] ?? null;
    const threat = mostPremium?.leader?.company !== "Chilexpress" ? mostPremium?.leader ?? null : null;

    return { mostPremium, mostCompetitive, threat };
  }, [chartZones]);

  const historicalContext = useMemo(() => {
    const rows: Array<Record<string, unknown>> = [];
    for (const month of regionalMonths) {
      for (const zone of MACRO_ZONES) {
        for (const company of B2B_COMPANIES) {
          const cell = regionalCells.get(`${zone}|${company}|${month}`);
          if (!cell) continue;
          rows.push({
            month,
            zone,
            company: companyLabel(company),
            priceClp: cell.price,
            confidence: cell.confidence,
            destinations: cell.destinations,
            observations: cell.observations,
            channel: cell.channel,
            plan: cell.plan,
          });
        }
      }
    }
    return rows;
  }, [regionalCells, regionalMonths]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const requestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 2, maxPages: 4 }),
      } as const;

      const [marketResponse, publicResponse, annexResponse] = await Promise.all([
        fetch("/api/b2b-pricing/refresh", requestInit),
        fetch("/api/b2b-pricing/public-rates/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        fetch("/api/b2b-pricing/market-public-rates/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ]);

      if (!marketResponse.ok || !publicResponse.ok || !annexResponse.ok) {
        throw new Error("Una de las fuentes no pudo actualizarse");
      }

      setNotice("Fuentes actualizadas. Posicionamiento e insights recalculados.");
      await loadRegional();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes");
    } finally {
      setRefreshing(false);
    }
  };

  const askAssistant = async (preset?: string) => {
    const question = (preset ?? assistantQuestion).trim();
    if (!question || assistantLoading) return;

    const nextMessages: AssistantMessage[] = [
      ...assistantMessages,
      { role: "user" as const, content: question },
    ].slice(-10);

    setAssistantMessages(nextMessages);
    setAssistantQuestion("");
    setAssistantLoading(true);

    try {
      const response = await fetch("/api/b2b-pricing/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          selectedMonth,
          rows: historicalContext,
        }),
      });

      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible consultar el asistente.");

      setAssistantMessages((current) => [
        ...current,
        { role: "assistant" as const, content: result.answer || "Sin respuesta." },
      ].slice(-10));
    } catch (error) {
      setAssistantMessages((current) => [
        ...current,
        {
          role: "assistant" as const,
          content: error instanceof Error ? error.message : "No fue posible consultar el asistente.",
        },
      ].slice(-10));
    } finally {
      setAssistantLoading(false);
    }
  };

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>COURIER & LOGISTICS · COMPETITIVE PRICING</div>
        <h1>Matriz competitiva</h1>
        <p>Benchmark de precios B2B por macrozona, con histórico mensual, posición competitiva e inteligencia accionable para Chilexpress.</p>
      </div>
      <div className={styles.sourceBadge}><i/> PRECIOS VERIFICADOS</div>
    </div>

    <div className={styles.segmentTabs}>
      <button type="button" className={layer === "b2b" ? styles.active : ""} onClick={() => setLayer("b2b")}>
        Censo B2B
        <span>Precios, posicionamiento e inteligencia</span>
      </button>
      <button type="button" className={layer === "simulator" ? styles.active : ""} onClick={() => setLayer("simulator")}>
        Simulador
        <span>Precio, costo y margen competitivo</span>
      </button>
      <button type="button" className={layer === "decisions" ? styles.active : ""} onClick={() => setLayer("decisions")}>
        Decisiones
        <span>Oportunidades, impacto y precio recomendado</span>
      </button>
    </div>

    {layer === "simulator" ? <B2BProfitabilitySimulator/> : layer === "decisions" ? <B2BDecisionLab
      zones={chartZones}
      selectedMonth={selectedMonth}
      months={regionalMonths}
      onMonthChange={setSelectedMonth}
    /> : <>
      <article className={`${styles.card} ${styles.regionalCard}`}>
        <header className={styles.regionalHeader}>
          <div>
            <span className={styles.eyebrow}>B2B · MACROZONAS</span>
            <h2>Precio promedio censado por zona</h2>
            <p>Benchmark homogéneo: origen Santiago, paquete ≤ 0,5 kg, entrega a domicilio y tarifa Pyme/Empresa. Se prioriza Pyme; si no existe, se usa evidencia empresarial.</p>
          </div>
          <div className={styles.regionalRules}>
            <span>≤ 0,5 KG</span>
            <span>DOMICILIO</span>
            <span>ORIGEN SANTIAGO</span>
            <span>FUENTE ≥ 90%</span>
          </div>
        </header>

        {regionalLoading ? <div className={styles.loading}>Calculando matriz B2B de alta confianza…</div> : null}

        <div className={styles.regionalStack}>
          {MACRO_ZONES.map((zone) => <section className={styles.regionBlock} key={zone}>
            <div className={styles.regionBlockHeader}>
              <div><span>MACROZONA</span><h3>{zone}</h3></div>
              <small>{ZONE_REFERENCE_DESTINATIONS[zone].join(" · ")}</small>
            </div>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.regionalTable}`}>
                <thead>
                  <tr><th>Marca</th>{regionalMonths.map((month) => <th key={`${zone}-${month}`}>{monthShortLabel(month)}</th>)}</tr>
                </thead>
                <tbody>
                  {B2B_COMPANIES.map((company) => <tr key={`${zone}-${company}`}>
                    <td><strong>{companyLabel(company)}</strong></td>
                    {regionalMonths.map((month) => {
                      const cell = regionalCells.get(`${zone}|${company}|${month}`);
                      return <td
                        key={`${zone}-${company}-${month}`}
                        className={cell ? styles.regionalCell : styles.regionalEmpty}
                        title={cell ? `${cell.plan} · ${cell.observations} observaciones · ${cell.destinations} destinos` : "Sin censo comparable"}
                      >
                        {cell ? <>
                          <strong>{money.format(cell.price)}</strong>
                          <small>{cell.confidence}% confianza · {cell.destinations} destino{cell.destinations === 1 ? "" : "s"}</small>
                          <em>{cell.channel}</em>
                        </> : <>
                          <strong>—</strong>
                          <small>sin censo comparable</small>
                        </>}
                      </td>;
                    })}
                  </tr>)}
                </tbody>
              </table>
            </div>
          </section>)}
        </div>

        <div className={styles.methodNote}>
          Promedio robusto ponderado por confianza. No se imputan meses ni rutas inexistentes y no se mezclan tarifas punto/sucursal con domicilio. Si una marca no tiene Pyme comparable, se usa Empresa/Mercado Público.
        </div>
      </article>

      <article className={`${styles.card} ${styles.positioningCard}`}>
        <div className={styles.positioningHeader}>
          <div>
            <span className={styles.eyebrow}>POSICIONAMIENTO COMPETITIVO</span>
            <h2>¿Quién está más caro y más barato por macrozona?</h2>
            <p>Ranking de precio medio comparable para el mes seleccionado. Chilexpress se destaca para facilitar lectura ejecutiva.</p>
          </div>
          <div className={styles.positioningControls}>
            <label>Mes
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                {regionalMonths.map((month) => <option key={month} value={month}>{monthShortLabel(month)} 2026</option>)}
              </select>
            </label>
            <button type="button" className={styles.refresh} onClick={refresh} disabled={refreshing}>
              {refreshing ? "Actualizando…" : "Actualizar fuentes"}
            </button>
          </div>
        </div>

        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <div className={styles.positioningGrid}>
          {chartZones.map(({ zone, rows }) => {
            const maxPrice = Math.max(...rows.map((row) => row.price), 1);
            return <section key={zone} className={styles.positioningZone}>
              <div className={styles.positioningZoneHead}>
                <div><span>MACROZONA</span><h3>{zone}</h3></div>
                <small>{rows.length ? `${rows.length} marcas comparables` : "Sin censo comparable"}</small>
              </div>

              <div className={styles.positioningRows}>
                {rows.map((row, index) => {
                  const width = Math.max(10, Math.round((row.price / maxPrice) * 100));
                  const leaderPrice = rows[0]?.price ?? row.price;
                  const premium = leaderPrice > 0 ? (row.price / leaderPrice - 1) * 100 : 0;

                  return <div key={`${zone}-${row.company}`} className={styles.positioningRow}>
                    <div className={styles.positioningMeta}>
                      <div>
                        <b className={row.company === "Chilexpress" ? styles.chilexpressLabel : ""}>#{index + 1} · {row.label}</b>
                        <small>{row.plan} · {row.confidence}% confianza</small>
                      </div>
                      <div className={styles.positioningPrice}>
                        <strong>{money.format(row.price)}</strong>
                        <small>{index === 0 ? "líder" : `+${pct.format(premium)}% vs líder`}</small>
                      </div>
                    </div>
                    <div className={styles.positioningTrack}>
                      <div
                        className={row.company === "Chilexpress" ? styles.positioningBarChilexpress : styles.positioningBar}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>;
                })}

                {!rows.length ? <div className={styles.positioningEmpty}>Aún no hay data comparable para este mes.</div> : null}
              </div>
            </section>;
          })}
        </div>

        <div className={styles.executiveInsights}>
          <article>
            <span>Mayor premium Chilexpress</span>
            <strong>{insightSummary.mostPremium?.zone ?? "—"}</strong>
            <small>{insightSummary.mostPremium?.premium !== null && insightSummary.mostPremium?.premium !== undefined ? `+${pct.format(insightSummary.mostPremium.premium)}% vs líder` : "sin comparación"}</small>
          </article>
          <article>
            <span>Zona más competitiva</span>
            <strong>{insightSummary.mostCompetitive?.zone ?? "—"}</strong>
            <small>{insightSummary.mostCompetitive?.premium !== null && insightSummary.mostCompetitive?.premium !== undefined ? `+${pct.format(insightSummary.mostCompetitive.premium)}% vs líder` : "sin comparación"}</small>
          </article>
          <article>
            <span>Principal presión de precio</span>
            <strong>{insightSummary.threat ? companyLabel(insightSummary.threat.company) : "—"}</strong>
            <small>{insightSummary.mostPremium?.zone ? `más agresivo en ${insightSummary.mostPremium.zone}` : "sin comparación"}</small>
          </article>
        </div>
      </article>

      <article className={`${styles.card} ${styles.aiCard}`}>
        <div className={styles.aiHeader}>
          <div>
            <span className={styles.eyebrow}>MGP PRICING COPILOT</span>
            <h2>Asistente inteligente de Pricing Courier</h2>
            <p>Lee la data real de agosto–diciembre, compara posiciones de precio y recomienda cómo actuar sin inventar costos, elasticidades ni márgenes.</p>
          </div>
          <div className={styles.aiStatus}><i/> IA CON CONTEXTO DEL DASHBOARD</div>
        </div>

        <div className={styles.aiSuggestions}>
          {[
            "Dame 3 recomendaciones concretas para Chilexpress",
            "¿Dónde estamos demasiado premium?",
            "¿Qué competidor nos presiona más?",
            "Resume el posicionamiento para presentarlo al cliente",
          ].map((suggestion) => <button
            key={suggestion}
            type="button"
            disabled={assistantLoading}
            onClick={() => void askAssistant(suggestion)}
          >{suggestion}</button>)}
        </div>

        <div className={styles.aiConversation}>
          {!assistantMessages.length ? <div className={styles.aiPlaceholder}>
            <strong>Pregunta lo que quieras sobre la posición competitiva.</strong>
            <span>Ejemplo: “¿Qué harías con los precios de Chilexpress en Norte?”</span>
          </div> : null}

          {assistantMessages.map((message, index) => <div
            key={`${message.role}-${index}`}
            className={message.role === "user" ? styles.aiUserMessage : styles.aiAssistantMessage}
          >
            <span>{message.role === "user" ? "Tú" : "MGP Pricing Copilot"}</span>
            <p>{message.content}</p>
          </div>)}

          {assistantLoading ? <div className={styles.aiTyping}>Analizando precios, brechas y evidencia…</div> : null}
        </div>

        <div className={styles.aiComposer}>
          <input
            value={assistantQuestion}
            onChange={(event) => setAssistantQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askAssistant();
              }
            }}
            placeholder="Ej: ¿En qué zona Chilexpress debería revisar su precio y por qué?"
          />
          <button
            type="button"
            onClick={() => void askAssistant()}
            disabled={assistantLoading || !assistantQuestion.trim()}
          >
            {assistantLoading ? "Analizando…" : "Preguntar"}
          </button>
        </div>
      </article>
    </>}
  </section>;
}
