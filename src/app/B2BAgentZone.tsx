"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./B2BAgentZone.module.css";

type AgentType = "report" | "analysis" | "matching" | "market_public" | "custom";

type Agent = {
  id: string;
  name: string;
  agent_type: AgentType;
  objective: string;
  instructions: string;
  data_scopes: string[];
  model: string;
  status: string;
  created_at: string;
};

type AgentResult = {
  title?: string;
  executiveSummary?: string;
  findings?: Array<{ label: string; detail: string; impact: "alto" | "medio" | "bajo" | "informativo" }>;
  comparisons?: Array<{ subject: string; benchmark: string; conclusion: string }>;
  actions?: string[];
  dataQuality?: string[];
};

type AgentRun = {
  id: string;
  agent_id: string;
  status: "running" | "completed" | "error";
  run_instruction?: string | null;
  result_title?: string | null;
  result_summary?: string | null;
  result_json?: AgentResult | null;
  model?: string | null;
  error_message?: string | null;
  started_at?: string;
  finished_at?: string | null;
};

type Props = {
  selectedMonth: string;
  pricingContext: Array<Record<string, unknown>>;
  rawPricingContext: Array<Record<string, unknown>>;
};

const TYPE_LABEL: Record<AgentType, string> = {
  report: "Reporte",
  analysis: "Análisis",
  matching: "Matching",
  market_public: "Mercado Público",
  custom: "Custom",
};

const TEMPLATES: Array<{
  type: AgentType;
  name: string;
  title: string;
  objective: string;
  instructions: string;
  scopes: string[];
  tag: string;
}> = [
  {
    type: "report",
    name: "Reporte Ejecutivo",
    title: "Reporte para Directorio",
    objective: "Preparar un reporte ejecutivo de pricing para Chilexpress con principales cifras, brechas competitivas, riesgos, oportunidades y decisiones recomendadas.",
    instructions: "Prioriza lectura de Directorio. Usa cifras concretas, separa hechos de hipótesis y termina con máximo 5 decisiones sugeridas.",
    scopes: ["pricing","history","market_public"],
    tag: "REPORTES",
  },
  {
    type: "analysis",
    name: "Analista de Pricing",
    title: "Analista de cifras",
    objective: "Analizar precios, premiums, variaciones, cobertura y anomalías para detectar oportunidades y alertas competitivas de Chilexpress.",
    instructions: "Busca cambios relevantes por macrozona, mes y competidor. Señala outliers o baja confianza antes de concluir.",
    scopes: ["pricing","history"],
    tag: "ANÁLISIS",
  },
  {
    type: "matching",
    name: "Matching Competitivo",
    title: "Matching de tarifas",
    objective: "Encontrar observaciones realmente comparables entre Chilexpress y competidores, homologando ruta o zona, peso, canal, modalidad de entrega y servicio.",
    instructions: "No fuerces equivalencias. Clasifica cada matching como defendible, parcial o no comparable y explica el motivo.",
    scopes: ["pricing","raw_pricing","history"],
    tag: "MATCHING",
  },
  {
    type: "market_public",
    name: "Hunter Mercado Público",
    title: "Inteligencia licitaciones",
    objective: "Analizar licitaciones courier de Mercado Público para entender contra quién compite Chilexpress, quién gana, dónde hay oportunidades y qué evidencia económica está publicada.",
    instructions: "Distingue participación, oferta y adjudicación. Nunca conviertas un monto total de contrato en tarifa por envío.",
    scopes: ["market_public","pricing"],
    tag: "B2B PÚBLICO",
  },
];

function stamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(".", "");
}

export default function B2BAgentZone({ selectedMonth, pricingContext, rawPricingContext }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [notice, setNotice] = useState("");
  const [runInstructions, setRunInstructions] = useState<Record<string,string>>({});
  const [expandedRun, setExpandedRun] = useState<string>("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customObjective, setCustomObjective] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customType, setCustomType] = useState<AgentType>("custom");
  const [customScopes, setCustomScopes] = useState<string[]>(["pricing","market_public"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/b2b-pricing/agents", { cache: "no-store" });
      const result = await response.json() as { agents?: Agent[]; runs?: AgentRun[]; error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible cargar los agentes.");
      setAgents(result.agents ?? []);
      setRuns(result.runs ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible cargar los agentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runsByAgent = useMemo(() => {
    const map = new Map<string,AgentRun[]>();
    for (const run of runs) {
      const current = map.get(run.agent_id) ?? [];
      current.push(run);
      map.set(run.agent_id, current);
    }
    return map;
  }, [runs]);

  const createAgent = async (payload: {
    name: string;
    agentType: AgentType;
    objective: string;
    instructions: string;
    dataScopes: string[];
  }) => {
    if (creating) return;
    setCreating(true);
    setNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { agent?: Agent; error?: string };
      if (!response.ok || !result.agent) throw new Error(result.error || "No fue posible crear el agente.");
      setAgents((current) => [result.agent as Agent, ...current]);
      setNotice(`Agente “${result.agent.name}” creado. Ya puedes ejecutarlo.`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible crear el agente.");
      return false;
    } finally {
      setCreating(false);
    }
  };

  const createTemplate = async (template: typeof TEMPLATES[number]) => {
    await createAgent({
      name: template.name,
      agentType: template.type,
      objective: template.objective,
      instructions: template.instructions,
      dataScopes: template.scopes,
    });
  };

  const createCustom = async () => {
    const ok = await createAgent({
      name: customName,
      agentType: customType,
      objective: customObjective,
      instructions: customInstructions,
      dataScopes: customScopes,
    });
    if (ok) {
      setCustomName("");
      setCustomObjective("");
      setCustomInstructions("");
      setCustomType("custom");
      setCustomScopes(["pricing","market_public"]);
      setCustomOpen(false);
    }
  };

  const runAgent = async (agent: Agent) => {
    if (runningId) return;
    setRunningId(agent.id);
    setNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          runInstruction: runInstructions[agent.id] ?? "",
          selectedMonth,
          pricingContext,
          rawPricingContext,
        }),
      });
      const result = await response.json() as { run?: AgentRun; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error || "La corrida del agente falló.");

      const run = result.run as AgentRun;
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setExpandedRun(run.id);
      setRunInstructions((current) => ({ ...current, [agent.id]: "" }));
      setNotice(`“${agent.name}” terminó su análisis.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La corrida del agente falló.");
      await load();
    } finally {
      setRunningId("");
    }
  };

  const deleteAgent = async (agent: Agent) => {
    if (!window.confirm(`¿Eliminar el agente “${agent.name}” y su historial de corridas?`)) return;
    try {
      const response = await fetch(`/api/b2b-pricing/agents?id=${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No fue posible eliminar el agente.");
      setAgents((current) => current.filter((item) => item.id !== agent.id));
      setRuns((current) => current.filter((item) => item.agent_id !== agent.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible eliminar el agente.");
    }
  };

  const toggleScope = (scope: string) => {
    setCustomScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <span>AGENT WORKSPACE</span>
        <h2>Zona de agentes</h2>
        <p>Crea agentes especializados para analizar cifras, homologar tarifas, revisar Mercado Público o preparar reportes. Los agentes trabajan a pedido y usan la data disponible de Super Precios.</p>
      </div>
      <div className={styles.heroBadge}><i/> OPENAI · ON DEMAND</div>
    </div>

    <section className={styles.templates}>
      <div className={styles.sectionHead}>
        <div><span>01 · CREAR RÁPIDO</span><h3>Agentes preconfigurados</h3></div>
        <button type="button" onClick={() => setCustomOpen((value) => !value)}>+ Agente personalizado</button>
      </div>

      <div className={styles.templateGrid}>
        {TEMPLATES.map((template) => <article className={styles.templateCard} key={template.type}>
          <span>{template.tag}</span>
          <h4>{template.title}</h4>
          <p>{template.objective}</p>
          <button type="button" disabled={creating} onClick={() => void createTemplate(template)}>
            {creating ? "Creando…" : "Crear agente"}
          </button>
        </article>)}
      </div>

      {customOpen ? <div className={styles.customBuilder}>
        <div className={styles.builderHead}><div><span>AGENTE CUSTOM</span><h4>Define qué quieres que haga</h4></div></div>
        <div className={styles.formGrid}>
          <label>Nombre
            <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Ej. Auditor de pricing regional"/>
          </label>
          <label>Tipo
            <select value={customType} onChange={(event) => setCustomType(event.target.value as AgentType)}>
              <option value="custom">Personalizado</option>
              <option value="report">Reporte</option>
              <option value="analysis">Análisis</option>
              <option value="matching">Matching</option>
              <option value="market_public">Mercado Público</option>
            </select>
          </label>
          <label className={styles.full}>Objetivo permanente
            <textarea value={customObjective} onChange={(event) => setCustomObjective(event.target.value)} placeholder="Describe el trabajo que este agente debe saber hacer cada vez que lo ejecutes."/>
          </label>
          <label className={styles.full}>Instrucciones / criterios
            <textarea value={customInstructions} onChange={(event) => setCustomInstructions(event.target.value)} placeholder="Ej. prioriza margen, no mezcles B2C y B2B, reporta sólo matches con confianza alta…"/>
          </label>
        </div>
        <div className={styles.scopeRow}>
          <span>Fuentes de conocimiento</span>
          {[
            ["pricing","Benchmark"],
            ["raw_pricing","Detalle tarifas"],
            ["history","Histórico"],
            ["market_public","Mercado Público"],
          ].map(([scope,label]) => <button type="button" key={scope} className={customScopes.includes(scope) ? styles.scopeActive : ""} onClick={() => toggleScope(scope)}>{label}</button>)}
        </div>
        <div className={styles.builderActions}>
          <button type="button" className={styles.cancel} onClick={() => setCustomOpen(false)}>Cancelar</button>
          <button type="button" className={styles.create} disabled={creating || customName.trim().length < 2 || customObjective.trim().length < 8} onClick={() => void createCustom()}>
            {creating ? "Creando…" : "Crear agente"}
          </button>
        </div>
      </div> : null}
    </section>

    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <section className={styles.agentSection}>
      <div className={styles.sectionHead}>
        <div><span>02 · MIS AGENTES</span><h3>Ejecutar tareas</h3></div>
        <small>{agents.length} agente{agents.length === 1 ? "" : "s"} · {selectedMonth}</small>
      </div>

      {loading ? <div className={styles.empty}>Cargando agentes…</div> : !agents.length ? <div className={styles.empty}>
        Todavía no tienes agentes. Crea uno desde las plantillas o define uno personalizado.
      </div> : <div className={styles.agentGrid}>
        {agents.map((agent) => {
          const agentRuns = runsByAgent.get(agent.id) ?? [];
          const latest = agentRuns[0];
          return <article className={styles.agentCard} key={agent.id}>
            <div className={styles.agentTop}>
              <div>
                <span>{TYPE_LABEL[agent.agent_type] ?? "Agente"}</span>
                <h4>{agent.name}</h4>
              </div>
              <button type="button" className={styles.delete} onClick={() => void deleteAgent(agent)}>Eliminar</button>
            </div>

            <p className={styles.objective}>{agent.objective}</p>
            <div className={styles.scopes}>
              {(agent.data_scopes ?? []).map((scope) => <span key={scope}>{scope.replace("_"," ")}</span>)}
              <span>{agent.model}</span>
            </div>

            <label className={styles.runBox}>Instrucción para esta corrida <span>opcional</span>
              <textarea
                value={runInstructions[agent.id] ?? ""}
                onChange={(event) => setRunInstructions((current) => ({ ...current, [agent.id]: event.target.value }))}
                placeholder="Ej. analiza sólo Centro y Sur, compara septiembre vs agosto y dime dónde harías un test de precio."
              />
            </label>
            <button type="button" className={styles.runButton} disabled={Boolean(runningId)} onClick={() => void runAgent(agent)}>
              {runningId === agent.id ? "Agente trabajando…" : "Ejecutar agente"}
            </button>

            {latest ? <div className={styles.latest}>
              <div className={styles.latestHead}>
                <div><span>ÚLTIMA CORRIDA · {stamp(latest.finished_at || latest.started_at)}</span><strong>{latest.result_title || (latest.status === "error" ? "Corrida con error" : "Resultado")}</strong></div>
                {latest.status === "completed" ? <button type="button" onClick={() => setExpandedRun(expandedRun === latest.id ? "" : latest.id)}>{expandedRun === latest.id ? "Cerrar" : "Ver análisis"}</button> : null}
              </div>
              {latest.status === "error" ? <p className={styles.error}>{latest.error_message || "La corrida falló."}</p> : null}
              {latest.status === "completed" && expandedRun === latest.id ? <AgentRunResult run={latest}/> : null}
            </div> : <div className={styles.neverRun}>Aún no ejecutado.</div>}

            {agentRuns.length > 1 ? <details className={styles.history}>
              <summary>Historial de corridas ({agentRuns.length})</summary>
              <div>
                {agentRuns.slice(1, 6).map((run) => <button type="button" key={run.id} onClick={() => setExpandedRun(expandedRun === run.id ? "" : run.id)}>
                  <span>{stamp(run.finished_at || run.started_at)} · {run.status}</span>
                  <strong>{run.result_title || run.run_instruction || "Corrida"}</strong>
                  {expandedRun === run.id && run.status === "completed" ? <AgentRunResult run={run}/> : null}
                </button>)}
              </div>
            </details> : null}
          </article>;
        })}
      </div>}
    </section>
  </section>;
}

function AgentRunResult({ run }: { run: AgentRun }) {
  const result = run.result_json ?? {};
  return <div className={styles.result}>
    {result.executiveSummary ? <p className={styles.summary}>{result.executiveSummary}</p> : null}

    {result.findings?.length ? <div className={styles.resultBlock}>
      <span>HALLAZGOS</span>
      {result.findings.map((item, index) => <div className={styles.finding} key={index}>
        <b data-impact={item.impact}>{item.impact}</b>
        <div><strong>{item.label}</strong><p>{item.detail}</p></div>
      </div>)}
    </div> : null}

    {result.comparisons?.length ? <div className={styles.resultBlock}>
      <span>COMPARACIONES</span>
      {result.comparisons.map((item, index) => <div className={styles.comparison} key={index}>
        <strong>{item.subject}</strong>
        <small>{item.benchmark}</small>
        <p>{item.conclusion}</p>
      </div>)}
    </div> : null}

    {result.actions?.length ? <div className={styles.resultBlock}>
      <span>ACCIONES SUGERIDAS</span>
      <ol>{result.actions.map((action, index) => <li key={index}>{action}</li>)}</ol>
    </div> : null}

    {result.dataQuality?.length ? <div className={styles.quality}>
      <span>CALIDAD / LIMITACIONES</span>
      {result.dataQuality.map((item, index) => <p key={index}>• {item}</p>)}
    </div> : null}
  </div>;
}
