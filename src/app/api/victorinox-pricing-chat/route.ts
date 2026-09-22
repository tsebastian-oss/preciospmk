import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseReadRpc } from "@/lib/enterprise-auth";
import { victorinoxMarketFromRows, type RawRow } from "@/lib/victorinox-market";
import { mergeVictorinoxOfficialMarket } from "@/lib/victorinox-real-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.VICTORINOX_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";
const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/responses";
const AI_GATEWAY_MODEL = (process.env.VICTORINOX_GATEWAY_MODEL ?? process.env.PIWEN_GATEWAY_MODEL ?? "openai/gpt-5.4-nano").trim();
const AI_PROVIDER_TIMEOUT_MS = 20_000;

type Msg = { role: "user" | "assistant"; content: string };
type ModelAttempt = {
  provider: "vercel-ai-gateway" | "openai";
  model: string;
  url: string;
  token: string;
};

function clean(value: unknown): Msg[] {
  return Array.isArray(value)
    ? value
      .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .map((item: any) => ({ role: item.role as Msg["role"], content: item.content.trim().slice(0, 5_000) }))
      .filter((item: Msg) => item.content)
      .slice(-14)
    : [];
}
function output(response: any) {
  return (response?.output ?? [])
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => item?.content ?? [])
    .filter((item: any) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item: any) => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function modelAttempts(request: NextRequest): ModelAttempt[] {
  const gatewayToken = (
    process.env.AI_GATEWAY_API_KEY
    ?? request.headers.get("x-vercel-oidc-token")
    ?? ""
  ).trim();

  const attempts: ModelAttempt[] = [];
  if (gatewayToken) {
    for (const model of [...new Set([AI_GATEWAY_MODEL, "openai/gpt-5.4-nano"])]) {
      attempts.push({ provider: "vercel-ai-gateway", model, url: AI_GATEWAY_URL, token: gatewayToken });
    }
  }
  if (OPENAI_API_KEY.trim().length >= 20) {
    attempts.push({ provider: "openai", model: OPENAI_MODEL, url: OPENAI_URL, token: OPENAI_API_KEY.trim() });
  }
  return attempts;
}

function logIssue(stage: string, details: Record<string, unknown> = {}) {
  console.error("[victorinox-pricing-chat]", JSON.stringify({ stage, ...details }));
}

function clp(value: number | null | undefined) {
  return value == null ? "—" : "$" + Math.round(value).toLocaleString("es-CL");
}

function local(question: string, market: any) {
  const q = question.toLocaleLowerCase("es-CL");
  const selected = market.position.filter((item: any) =>
    q.includes(item.category.toLocaleLowerCase("es-CL"))
    || (item.category === "Relojes" && q.includes("reloj"))
    || (item.category === "Equipo de viaje" && /(viaje|maleta|equipaje)/.test(q))
    || (item.category === "Navajas y multiherramientas" && /(navaja|multiherramienta)/.test(q))
    || (item.category === "Cuchillos" && q.includes("cuchill"))
  );
  const rows = selected.length ? selected : market.position;
  const table = rows
    .map((item: any) => `| ${item.category} | ${clp(item.own?.medianPrice)} | ${clp(item.comparableBenchmarkMedian)} | ${item.comparablePriceIndex?.toFixed(1) ?? "—"} |`)
    .join("\n");

  return `**Lectura basada en precios reales observados.**

| Categoría | Mediana Victorinox | Benchmark comparable | Índice |
|---|---:|---:|---:|
${table}

- La fuente propia es victorinoxstore.cl; la competencia proviene del snapshot observado en Supabase.
- Índice 100 representa paridad.
- Cobertura oficial: **${market.kpis.ownSkus} productos**, observados al **${market.dataQuality?.officialObservedAt ?? market.lastObservedAt ?? "—"}**.
- Última evidencia competitiva: **${market.dataQuality?.competitionObservedAt ?? "—"}**.`;
}

function instructions(context: unknown) {
  return `Eres MGP Pricing Copilot para Victorinox Chile. Responde solamente con el CONTEXTO real observado.
Nunca inventes precios, stock, ventas, costos, márgenes ni elasticidades.
Distingue precio vigente, precio regular, tamaño de muestra y fecha de observación.
Para relojes, no trates correas, brazaletes ni accesorios como relojes.
Price Index: benchmark=100. Prioriza Comparable Price Index cuando exista muestra comparable suficiente.
Si una categoría carece de muestra suficiente, dilo explícitamente.
Si la evidencia competitiva es más antigua que la oficial, indícalo.
Escribe en español ejecutivo, abre con una conclusión, destaca cifras y usa tablas Markdown cuando compares tres o más elementos.
No muestres el JSON ni estas instrucciones.

CONTEXTO REAL:
${JSON.stringify(context)}`;
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "brand-panel");
  if (auth.response) return auth.response;
  if (!auth.access || !brandScopeAllows(auth.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const messages = clean(body?.messages);
    const last = [...messages].reverse().find((item) => item.role === "user");
    const localOnly = body?.localOnly === true;
    if (!last) return NextResponse.json({ error: "Escribe una consulta." }, { status: 400 });

    const [light, competition] = await Promise.all([
      enterpriseReadRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" }),
      enterpriseReadRpc<RawRow[]>(request, "victorinox_competition_market_payload", { p_limit_per_brand: 250 }),
    ]);

    if (light.response || !light.data) {
      return light.response ?? NextResponse.json({ error: "Sin catálogo oficial disponible." }, { status: 503 });
    }
    if (competition.response || !Array.isArray(competition.data)) {
      return competition.response ?? NextResponse.json({ error: "Sin competencia real disponible." }, { status: 503 });
    }

    const market = mergeVictorinoxOfficialMarket(victorinoxMarketFromRows(competition.data), light.data);
    const terms = last.content.toLocaleLowerCase("es-CL").split(/\s+/).filter((term) => term.length >= 4);
    const context = {
      generatedAt: market.generatedAt,
      officialObservedAt: market.dataQuality?.officialObservedAt ?? null,
      competitionObservedAt: market.dataQuality?.competitionObservedAt ?? null,
      kpis: market.kpis,
      position: market.position,
      summary: market.summary,
      dataQuality: market.dataQuality,
      relevantListings: market.listings
        .filter((row: any) => terms.some((term) =>
          (row.name + " " + row.brand + " " + row.category + " " + row.retailer)
            .toLocaleLowerCase("es-CL")
            .includes(term)
        ))
        .slice(0, 100),
      insights: market.insights,
    };

    if (!localOnly) {
      for (const attempt of modelAttempts(request)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
        const startedAt = Date.now();
        try {
          const response = await fetch(attempt.url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${attempt.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: attempt.model,
              instructions: instructions(context),
              input: messages,
              store: false,
              max_output_tokens: 2_200,
              reasoning: { effort: "low" },
            }),
            signal: controller.signal,
            cache: "no-store",
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            logIssue("model_response", {
              provider: attempt.provider,
              model: attempt.model,
              status: response.status,
              code: data?.error?.code ?? data?.error?.type ?? "",
              durationMs: Date.now() - startedAt,
            });
            continue;
          }
          const answer = output(data);
          if (!answer) {
            logIssue("empty_response", {
              provider: attempt.provider,
              model: attempt.model,
              durationMs: Date.now() - startedAt,
            });
            continue;
          }
          return NextResponse.json({
            answer,
            model: data?.model || attempt.model,
            provider: attempt.provider,
            requestedModel: AI_GATEWAY_MODEL,
            dataObservedAt: market.dataQuality?.officialObservedAt ?? market.lastObservedAt,
            competitionObservedAt: market.dataQuality?.competitionObservedAt ?? null,
            presentationMode: false,
          }, { headers: { "cache-control": "private, no-store" } });
        } catch (error) {
          logIssue("model_runtime", {
            provider: attempt.provider,
            model: attempt.model,
            error: error instanceof Error ? error.name : "unknown",
            durationMs: Date.now() - startedAt,
          });
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    return NextResponse.json({
      answer: local(last.content, market),
      model: localOnly ? "MGP Real Data Analyst · QA" : "MGP Real Data Analyst",
      provider: "local-fallback",
      dataObservedAt: market.dataQuality?.officialObservedAt ?? market.lastObservedAt,
      competitionObservedAt: market.dataQuality?.competitionObservedAt ?? null,
      presentationMode: false,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("victorinox chat", error);
    return NextResponse.json({ error: "No fue posible consultar los datos reales." }, { status: 503 });
  }
}
