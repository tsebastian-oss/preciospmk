import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Agent = {
  id: string;
  name: string;
  agent_type: string;
  objective: string;
  instructions: string;
  data_scopes: string[];
  model: string;
};

function cleanRows(value: unknown, limit = 260) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((row: any) => ({
    month: String(row?.month ?? row?.date ?? "").slice(0, 10),
    zone: String(row?.zone ?? "").slice(0, 40),
    company: String(row?.company ?? "").slice(0, 80),
    plan: String(row?.plan ?? "").slice(0, 140),
    channel: String(row?.channel ?? "").slice(0, 80),
    origin: String(row?.origin ?? "").slice(0, 100),
    destination: String(row?.destination ?? "").slice(0, 100),
    serviceType: String(row?.serviceType ?? "").slice(0, 100),
    weightKg: Number(row?.weightKg ?? 0) || null,
    priceClp: Number(row?.priceClp ?? 0) || null,
    confidence: Number(row?.confidence ?? 0) || null,
    destinations: Number(row?.destinations ?? 0) || null,
    observations: Number(row?.observations ?? 0) || null,
  }));
}

function outputText(payload: any) {
  return (payload?.output ?? [])
    .filter((x: any) => x?.type === "message")
    .flatMap((x: any) => x?.content ?? [])
    .filter((x: any) => x?.type === "output_text" && typeof x.text === "string")
    .map((x: any) => x.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function instructionsFor(agent: Agent) {
  const mode = {
    report: "Construye un reporte ejecutivo para alta gerencia o Directorio. Prioriza síntesis, cifras, riesgos, oportunidades y decisiones.",
    analysis: "Analiza cifras, tendencias, brechas y anomalías. Separa hechos, hipótesis y datos faltantes.",
    matching: "Haz matching de observaciones comparables. Sólo vincula servicios cuando coincidan de forma defendible en canal, peso, ruta/zona, tipo de entrega y servicio. Explica matches dudosos.",
    market_public: "Analiza Mercado Público/ChileCompra: participación, adjudicaciones, competidores, ofertas y tarifas explícitas. Distingue siempre participación, oferta y adjudicación.",
    custom: "Cumple exactamente el objetivo del usuario usando sólo la evidencia disponible.",
  }[agent.agent_type] ?? "Cumple exactamente el objetivo del usuario usando sólo la evidencia disponible.";

  return `Eres un agente especializado dentro de MGP Super Precios para Chilexpress.

NOMBRE DEL AGENTE
${agent.name}

OBJETIVO PERMANENTE
${agent.objective}

INSTRUCCIONES DEL USUARIO
${agent.instructions || "Sin instrucciones adicionales."}

MODO DE TRABAJO
${mode}

GUARDRAILS
- No inventes datos ni completes vacíos con supuestos no declarados.
- No mezcles B2C con B2B salvo que el usuario lo pida explícitamente.
- En comparaciones de pricing, exige comparabilidad suficiente de ruta/zona, peso/banda, canal, servicio y modalidad de entrega.
- Un monto total de licitación no equivale a una tarifa por envío.
- En Mercado Público distingue "participó", "ofertó" y "ganó".
- Si el alcance de la data todavía es parcial, dilo.
- Cita IDs de licitación, empresas, meses y cifras concretas cuando estén en la evidencia.
- Entrega una recomendación accionable, pero separa claramente hechos de inferencias.
- Responde en español ejecutivo, claro y conciso.`;
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    executiveSummary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          impact: { type: "string", enum: ["alto","medio","bajo","informativo"] },
        },
        required: ["label","detail","impact"],
      },
    },
    comparisons: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          subject: { type: "string" },
          benchmark: { type: "string" },
          conclusion: { type: "string" },
        },
        required: ["subject","benchmark","conclusion"],
      },
    },
    actions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    dataQuality: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
  required: ["title","executiveSummary","findings","comparisons","actions","dataQuality"],
};

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const agentId = String(body?.agentId ?? "");
  const runInstruction = String(body?.runInstruction ?? "").trim().slice(0, 3000);
  const selectedMonth = String(body?.selectedMonth ?? "").slice(0, 7);

  if (!agentId) return NextResponse.json({ error: "Falta agente." }, { status: 400 });

  const agentResult = await enterpriseRest<Agent[]>(request, "pricing_task_agents", {
    method: "GET",
    query: {
      select: "id,name,agent_type,objective,instructions,data_scopes,model",
      id: `eq.${agentId}`,
      organization_id: `eq.${auth.access.organizationId}`,
      vertical: "eq.courier",
      status: "eq.active",
      limit: "1",
    },
  });
  if (agentResult.response) return agentResult.response;
  const agent = agentResult.data?.[0];
  if (!agent) return NextResponse.json({ error: "Agente no encontrado o inactivo." }, { status: 404 });

  const runInsert = await enterpriseRest<any[]>(request, "pricing_task_agent_runs", {
    method: "POST",
    body: [{
      agent_id: agent.id,
      organization_id: auth.access.organizationId,
      status: "running",
      run_instruction: runInstruction || null,
      model: agent.model || OPENAI_MODEL,
      metadata: { selectedMonth },
    }],
    prefer: "return=representation",
  });
  if (runInsert.response) return runInsert.response;
  const runId = runInsert.data?.[0]?.id;
  if (!runId) return NextResponse.json({ error: "No fue posible iniciar la corrida." }, { status: 500 });

  try {
    const scopes = new Set(agent.data_scopes ?? []);
    const pricingRows = scopes.has("pricing") || scopes.has("history") ? cleanRows(body?.pricingContext, 260) : [];
    const rawRows = scopes.has("raw_pricing") || agent.agent_type === "matching" ? cleanRows(body?.rawPricingContext, 420) : [];

    let marketPublicKnowledge: unknown = {};
    if (scopes.has("market_public") || agent.agent_type === "market_public") {
      const knowledge = await enterpriseRpc<unknown>(request, "b2b_market_public_knowledge_context", {
        p_organization_id: auth.access.organizationId,
        p_months: 84,
        p_limit: 60,
      });
      if (!knowledge.response) marketPublicKnowledge = knowledge.data ?? {};
    }

    if (OPENAI_API_KEY.length < 20) throw new Error("OpenAI API no está configurada.");

    const userPayload = {
      selectedMonth,
      runInstruction: runInstruction || "Ejecuta el objetivo permanente del agente con la información más reciente disponible.",
      pricingContext: pricingRows,
      rawPricingContext: rawRows,
      mercadoPublicoKnowledge: marketPublicKnowledge,
    };

    const models = [...new Set([agent.model || OPENAI_MODEL, OPENAI_MODEL, "gpt-5.6", "gpt-5.1", "gpt-4.1"].filter(Boolean))];
    let resultJson: any = null;
    let usedModel = "";

    for (const model of models) {
      try {
        const response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            store: false,
            instructions: instructionsFor(agent),
            input: [{ role: "user", content: JSON.stringify(userPayload) }],
            max_output_tokens: 5000,
            text: {
              format: {
                type: "json_schema",
                name: "pricing_agent_result",
                strict: true,
                schema,
              },
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(90000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) continue;
        const text = outputText(data);
        if (!text) continue;
        resultJson = JSON.parse(text);
        usedModel = model;
        break;
      } catch {
        // Try next model.
      }
    }

    if (!resultJson) throw new Error("No fue posible obtener una respuesta válida del agente.");

    const summary = String(resultJson.executiveSummary ?? "").slice(0, 10000);
    await enterpriseRest<unknown>(request, "pricing_task_agent_runs", {
      method: "PATCH",
      query: { id: `eq.${runId}` },
      body: {
        status: "completed",
        result_title: String(resultJson.title ?? agent.name).slice(0, 250),
        result_summary: summary,
        result_json: resultJson,
        model: usedModel || agent.model || OPENAI_MODEL,
        finished_at: new Date().toISOString(),
        metadata: {
          selectedMonth,
          pricingRows: pricingRows.length,
          rawPricingRows: rawRows.length,
          marketPublicIncluded: scopes.has("market_public") || agent.agent_type === "market_public",
        },
      },
      prefer: "return=minimal",
    });

    return NextResponse.json({
      ok: true,
      run: {
        id: runId,
        agent_id: agent.id,
        status: "completed",
        result_title: resultJson.title,
        result_summary: summary,
        result_json: resultJson,
        model: usedModel,
        started_at: runInsert.data?.[0]?.started_at,
        finished_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "La corrida falló.";
    await enterpriseRest<unknown>(request, "pricing_task_agent_runs", {
      method: "PATCH",
      query: { id: `eq.${runId}` },
      body: {
        status: "error",
        error_message: message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      },
      prefer: "return=minimal",
    });
    return NextResponse.json({ error: message, runId }, { status: 500 });
  }
}
