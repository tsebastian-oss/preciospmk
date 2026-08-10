import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Msg = {
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
};
type Candidate = {
  brand: string;
  products: number;
  score: number;
  matchType?: string;
};
type Runtime = {
  enabled?: boolean;
  model?: string | null;
  api_key?: string | null;
};
type Cluster = {
  clusterId: string;
  category: string;
  format?: string | null;
  measureType: string;
  sizeBucket?: number | null;
  products: number;
  retailers: number;
  qualityScore: number;
  examples?: string[];
  basisHint?: string;
};
type SegmentIntent = {
  active: boolean;
  format: string | null;
  packageMode: "all" | "single" | "multipack";
  volumeMl: number | null;
};

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
const cleanMsgs = (v: unknown): Msg[] =>
  Array.isArray(v)
    ? v
        .filter(
          (x: any) =>
            x &&
            (x.role === "user" || x.role === "assistant") &&
            typeof x.content === "string",
        )
        .map((x: any) => ({
          role: x.role,
          content: x.content.trim().slice(0, 2500),
          brand:
            typeof x.brand === "string" && x.brand.trim()
              ? x.brand.trim().slice(0, 160)
              : null,
        }))
        .filter((x: Msg) => x.content)
        .slice(-16)
    : [];
const outText = (p: any) =>
  typeof p?.output_text === "string"
    ? p.output_text.trim()
    : (p?.output ?? [])
        .flatMap((x: any) => x?.content ?? [])
        .filter(
          (x: any) => x?.type === "output_text" && typeof x.text === "string",
        )
        .map((x: any) => x.text)
        .join("\n")
        .trim();
const modelList = (configured?: string | null) =>
  [
    configured,
    "gpt-5.6-sol",
    "gpt-5.6",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-4.1",
  ].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
const conversationalModelList = (configured?: string | null) =>
  [
    "gpt-5.6-sol",
    "gpt-5.6",
    configured,
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-4.1",
  ].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
function dedupe(v: unknown): Candidate[] {
  if (!Array.isArray(v)) return [];
  const m = new Map<string, Candidate>();
  for (const r of v as any[]) {
    if (!r || typeof r.brand !== "string") continue;
    const k = norm(r.brand);
    if (!k) continue;
    const c = {
      brand: r.brand.trim(),
      products: Number(r.products ?? 0),
      score: Number(r.score ?? 0),
      matchType: typeof r.matchType === "string" ? r.matchType : undefined,
    };
    const o = m.get(k);
    if (
      !o ||
      c.score > o.score ||
      (c.score === o.score && c.products > o.products)
    )
      m.set(k, c);
  }
  return [...m.values()]
    .sort((a, b) => b.score - a.score || b.products - a.products)
    .slice(0, 18);
}
function productSegmentIntent(question: string): SegmentIntent {
  const text = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const formatMap: Array<[RegExp, string]> = [
    [/\blatas?\b/, "lata"],
    [/\bbotellas?\b/, "botella"],
    [/\bbolsas?\b/, "bolsa"],
    [/\bcajas?\b/, "caja"],
    [/\bfrascos?\b/, "frasco"],
    [/\bpotes?\b/, "pote"],
    [/\bsachets?\b/, "sachet"],
  ];
  const format = formatMap.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  let packageMode: SegmentIntent["packageMode"] = "all";
  if (
    /\b(?:multipack|multi-pack|pack|six\s*pack)\b|\bx\s*[2-9]\d*\b|\b[2-9]\d*\s*(?:unidades?|uds?|unid\.?|latas?|botellas?)\b/.test(
      text,
    )
  )
    packageMode = "multipack";
  else if (
    /\b(?:individual(?:es)?|unidad(?:es)?|suelta(?:s)?|unitario(?:s)?)\b|\bx\s*1\b/.test(
      text,
    )
  )
    packageMode = "single";

  let volumeMl: number | null = null;
  const ml = text.match(/\b(\d{2,4}(?:[.,]\d+)?)\s*(?:ml|cc|cm3)\b/);
  const liters = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litro|litros)\b/,
  );
  const implicit = format
    ? text.match(/\b(?:lata|botella)\s+(?:de\s+)?(\d{2,4})\b/)
    : null;
  if (ml) volumeMl = Math.round(Number(ml[1].replace(",", ".")));
  else if (liters)
    volumeMl = Math.round(Number(liters[1].replace(",", ".")) * 1000);
  else if (implicit) volumeMl = Number(implicit[1]);
  if (
    !Number.isFinite(volumeMl) ||
    Number(volumeMl) <= 0 ||
    Number(volumeMl) > 20000
  )
    volumeMl = null;

  return {
    active: Boolean(format || volumeMl || packageMode !== "all"),
    format,
    packageMode,
    volumeMl,
  };
}
async function askJson(
  apiKey: string,
  models: string[],
  instructions: string,
  input: any[],
  max: number,
) {
  let last = "";
  for (const model of models) {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        max_output_tokens: max,
        store: false,
      }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) {
      last = raw?.error?.message ?? `OpenAI ${r.status}`;
      if (
        [400, 403, 404].includes(r.status) ||
        /model|access|permission|unsupported|does not exist/i.test(last)
      )
        continue;
      break;
    }
    const txt = outText(raw)
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```$/, "")
      .trim();
    try {
      return { value: JSON.parse(txt), model, error: "" };
    } catch {
      last = "Respuesta JSON inválida";
    }
  }
  return { value: null, model: null as string | null, error: last };
}

async function askText(
  apiKey: string,
  models: string[],
  instructions: string,
  input: any[],
  max: number,
) {
  let last = "";
  for (const model of models) {
    const supportsGpt5Controls = /^gpt-5(?:\.|-)/.test(model);
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        max_output_tokens: max,
        store: false,
        ...(supportsGpt5Controls
          ? {
              reasoning: { effort: "low" },
              text: { verbosity: "medium" },
            }
          : {}),
      }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) {
      last = raw?.error?.message ?? `OpenAI ${r.status}`;
      if (
        [400, 403, 404].includes(r.status) ||
        /model|access|permission|unsupported|does not exist/i.test(last)
      )
        continue;
      break;
    }
    const text = outText(raw);
    if (text) return { text, model, error: "" };
    last = "OpenAI devolvió una respuesta vacía";
  }
  return { text: "", model: null as string | null, error: last };
}

const isContextualFollowUp = (question: string) =>
  /^(?:\s|[¿¡])*(?:y\b|pero\b|entonces\b|adem[aá]s\b|tambi[eé]n\b|ahora\b|qu[eé]\b|cu[aá]nto\b|d[oó]nde\b|cu[aá]l\b|c[oó]mo\b|comp[aá]r|expl[ií]ca|profundiza|detalla|por qu[eé]\b)/i.test(
    question,
  );

function contextualSegmentIntent(
  question: string,
  messages: Msg[],
  useConversationContext: boolean,
) {
  const current = productSegmentIntent(question);
  if (!useConversationContext || !isContextualFollowUp(question)) return current;
  const previousQuestion = [...messages]
    .slice(0, -1)
    .reverse()
    .find(
      (message) =>
        message.role === "user" && productSegmentIntent(message.content).active,
    );
  if (!previousQuestion) return current;
  const previous = productSegmentIntent(previousQuestion.content);
  if (!current.active) return previous;
  const changedFormat =
    Boolean(current.format) &&
    Boolean(previous.format) &&
    current.format !== previous.format;
  return {
    active: true,
    format: current.format ?? previous.format,
    packageMode:
      current.packageMode !== "all"
        ? current.packageMode
        : previous.packageMode,
    volumeMl: current.volumeMl ?? (changedFormat ? null : previous.volumeMl),
  } satisfies SegmentIntent;
}

async function resolveBrand(
  client: any,
  config: Runtime,
  org: string,
  q: string,
  history: string,
  filters: any,
  contextualBrand?: string | null,
) {
  const { data } = await client.rpc("enterprise_brand_resolver_candidates", {
    p_organization_id: org,
    p_query: q,
    p_retailer_type:
      typeof filters.retailerType === "string" ? filters.retailerType : "all",
    p_supermarket:
      typeof filters.supermarket === "string" && filters.supermarket
        ? filters.supermarket
        : null,
    p_category:
      typeof filters.category === "string" && filters.category
        ? filters.category
        : null,
    p_limit: 24,
  });
  const c = dedupe(data?.candidates),
    fb = typeof filters.brand === "string" ? filters.brand.trim() : "";
  if (fb) {
    const x = c.find((z) => norm(z.brand) === norm(fb));
    return {
      brand: x?.brand ?? fb,
      candidates: c,
      confidence: 1,
      method: "filter",
    };
  }
  const strong = c[0];
  if (
    strong &&
    strong.score >= 0.97 &&
    ["exact", "phrase", "normalized_exact"].includes(strong.matchType ?? "")
  )
    return {
      brand: strong.brand,
      candidates: c,
      confidence: strong.score,
      method: "database_exact",
    };
  if (
    contextualBrand &&
    (!strong || strong.score < 0.7) &&
    isContextualFollowUp(q)
  )
    return {
      brand: contextualBrand,
      candidates: c,
      confidence: 0.96,
      method: "conversation_context",
    };
  if (config.enabled && config.api_key && c.length) {
    const r = await askJson(
      config.api_key,
      modelList(config.model),
      [
        "Identifica qué marca quiso mencionar el usuario.",
        "Elige SOLO una marca de BRAND_CANDIDATES o null; nunca inventes marcas.",
        "Tolera errores de tipeo, abreviaciones y escritura fonética.",
        'Devuelve SOLO JSON: {"brand":"nombre exacto o null","confidence":0.0,"reason":"breve"}.',
      ].join("\n"),
      [
        {
          role: "developer",
          content: `BRAND_CANDIDATES:\n${JSON.stringify(c)}`,
        },
        {
          role: "user",
          content: `Pregunta: ${q}\nContexto: ${history || "(sin contexto)"}`,
        },
      ],
      180,
    );
    const rq = typeof r.value?.brand === "string" ? r.value.brand : "",
      chosen = c.find((z) => norm(z.brand) === norm(rq));
    if (chosen && Number(r.value?.confidence ?? 0) >= 0.45)
      return {
        brand: chosen.brand,
        candidates: c,
        confidence: Number(r.value?.confidence ?? chosen.score),
        method: "gpt_resolver",
        resolverModel: r.model,
      };
  }
  if (strong && strong.score >= 0.7)
    return {
      brand: strong.brand,
      candidates: c,
      confidence: strong.score,
      method: "database_fuzzy",
    };
  return {
    brand: null,
    candidates: c,
    confidence: strong?.score ?? 0,
    method: "unresolved",
  };
}

async function pricingLens(
  client: any,
  config: Runtime,
  org: string,
  brand: string,
  q: string,
  history: string,
  filters: any,
  segment?: SegmentIntent,
) {
  const priceIntent =
    /precio|pricing|car[oa]|barat|posicion|compet|compar|brecha|premium|índice|indice/i.test(
      q,
    );
  if (!priceIntent) return null;
  const segmentHint = segment?.active
    ? [
        segment.format ? `formato ${segment.format}` : "",
        segment.volumeMl ? `tamaño ${segment.volumeMl} ml` : "",
        segment.packageMode !== "all"
          ? segment.packageMode === "single"
            ? "unidad individual"
            : "multipack"
          : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const priceQuestion = segmentHint
    ? `${q}\nAlcance conversacional vigente: ${segmentHint}.`
    : q;
  const { data: preflight, error } = await client.rpc(
    "enterprise_price_map_preflight",
    {
      p_organization_id: org,
      p_brand: brand,
      p_question: priceQuestion,
      p_retailer_type:
        typeof filters.retailerType === "string" ? filters.retailerType : "all",
      p_supermarket:
        typeof filters.supermarket === "string" && filters.supermarket
          ? filters.supermarket
          : null,
      p_category:
        typeof filters.category === "string" && filters.category
          ? filters.category
          : null,
      p_stock: typeof filters.stock === "string" ? filters.stock : "all",
    },
  );
  if (
    error ||
    !Array.isArray(preflight?.clusters) ||
    !preflight.clusters.length
  )
    return null;
  const intent = preflight?.explicitIntent ?? {};
  let pool = (preflight.clusters as Cluster[]).filter(
    (c) =>
      (!intent.format || c.format === intent.format) &&
      (!intent.sizeBucket ||
        Number(c.sizeBucket) === Number(intent.sizeBucket)),
  );
  if (!pool.length) pool = preflight.clusters as Cluster[];
  let chosen = pool[0],
    plan: any = {
      method: "deterministic",
      confidence: Number(chosen.qualityScore ?? 0) / 100,
      reason: "Mejor cluster compatible",
    };
  if (pool.length > 1 && config.enabled && config.api_key) {
    const compact = pool.slice(0, 12).map((c) => ({
      clusterId: c.clusterId,
      category: c.category,
      format: c.format,
      measureType: c.measureType,
      sizeBucket: c.sizeBucket,
      products: c.products,
      retailers: c.retailers,
      qualityScore: c.qualityScore,
      examples: (c.examples ?? []).slice(0, 4),
    }));
    const r = await askJson(
      config.api_key,
      modelList(config.model),
      [
        "Elige el cluster correcto para responder una pregunta de pricing de marca.",
        "No calcules precios. Elige SOLO clusterId existente.",
        "Prioriza intención explícita, misma necesidad/categoría, mismo formato/tamaño y representatividad. Una muestra grande pero heterogénea no equivale a una buena comparación.",
        'Devuelve SOLO JSON: {"clusterId":"...","confidence":0.0,"reason":"breve"}.',
      ].join("\n"),
      [
        {
          role: "developer",
          content: `INTENT:\n${JSON.stringify(intent)}\nCLUSTERS:\n${JSON.stringify(compact)}`,
        },
        {
          role: "user",
          content: `Pregunta: ${priceQuestion}\nContexto: ${history || "(sin contexto)"}`,
        },
      ],
      200,
    );
    const found = pool.find(
      (c) => String(c.clusterId) === String(r.value?.clusterId ?? ""),
    );
    if (found) {
      chosen = found;
      plan = {
        method: "gpt_planner",
        confidence: Number(r.value?.confidence ?? found.qualityScore / 100),
        reason: String(r.value?.reason ?? ""),
        model: r.model,
      };
    }
  }
  const { data: ctx, error: ce } = await client.rpc(
    "enterprise_ai_price_map_context_v4",
    {
      p_organization_id: org,
      p_brand: brand,
      p_category: chosen.category,
      p_format: chosen.format ?? null,
      p_measure_type: chosen.measureType,
      p_size_bucket: chosen.sizeBucket ?? null,
      p_retailer_type:
        typeof filters.retailerType === "string" ? filters.retailerType : "all",
      p_supermarket:
        typeof filters.supermarket === "string" && filters.supermarket
          ? filters.supermarket
          : null,
      p_stock: typeof filters.stock === "string" ? filters.stock : "all",
    },
  );
  if (ce || !ctx?.found) return null;
  return { plan: { cluster: chosen, ...plan }, context: ctx };
}

function fallback(ctx: any) {
  const s = ctx?.current?.summary;
  if (!s) return "No encontré una base suficiente para analizar esa marca.";
  return `${ctx.brand}: veo ${s.skus ?? 0} SKU en ${s.retailers ?? 0} cadenas. ${ctx.quality?.overallPriceComparable ? `La mediana del cluster es $${Number(s.medianPrice ?? 0).toLocaleString("es-CL")}.` : "El ticket global mezcla formatos/tamaños; no lo usaría para decir si la marca es cara o barata."}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("authorization") ?? "",
    url = Deno.env.get("SUPABASE_URL")!,
    anon = Deno.env.get("SUPABASE_ANON_KEY")!,
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const body = await req.json().catch(() => ({})),
      org = typeof body?.organizationId === "string" ? body.organizationId : "",
      messages = cleanMsgs(body?.messages),
      q = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (!org || !q)
      return Response.json(
        { error: "Falta la organización o la pregunta." },
        { status: 400 },
      );
    const user = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: ue } = await user.auth.getUser();
    if (ue || !u.user)
      return Response.json({ error: "No autorizado" }, { status: 401 });
    const svc = createClient(url, service);
    const { data: cfg } = await svc.rpc("get_ai_runtime_config_service");
    const config = (cfg ?? {}) as Runtime,
      filters = body?.filters ?? {},
      history = messages
        .filter((m) => m.role === "user")
        .slice(-4, -1)
        .map((m) => m.content)
        .join(" \n ");
    const resolution = await resolveBrand(
      user,
      config,
      org,
      q,
      history,
      filters,
      [...messages]
        .slice(0, -1)
        .reverse()
        .find((message) => message.role === "assistant" && message.brand)
        ?.brand ?? null,
    );
    if (!resolution.brand) {
      if (config.enabled && config.api_key) {
        const conversational = await askText(
          config.api_key,
          conversationalModelList(config.model),
          [
            "Eres MGP Intelligence, un asistente conversacional de pricing y retail potenciado por OpenAI Sol.",
            "No hay una marca resuelta ni datos de marca cargados para este turno.",
            "Si el usuario saluda, pregunta qué puedes hacer o conversa sobre el módulo, responde natural y brevemente.",
            "Si su solicitud necesita datos, pide una sola aclaración concreta para identificar la marca. Puedes sugerir únicamente nombres presentes en BRAND_CANDIDATES.",
            "No inventes cifras, marcas ni resultados. Devuelve sólo la respuesta final, sin JSON.",
          ].join("\n"),
          [
            {
              role: "developer",
              content: `BRAND_CANDIDATES:\n${JSON.stringify(resolution.candidates.slice(0, 5))}`,
            },
            ...messages.map(({ role, content }) => ({ role, content })),
          ],
          500,
        );
        if (conversational.text)
          return Response.json({
            answer: conversational.text,
            brand: null,
            candidates: resolution.candidates,
            resolution,
            model: conversational.model,
            ai: true,
            assistant: "MGP Intelligence",
            responseStyle: "conversational",
          });
      }
      const suggestions = resolution.candidates
        .slice(0, 3)
        .map((candidate: Candidate) => candidate.brand);
      return Response.json({
        answer: suggestions.length
          ? `No estoy seguro de qué marca quisiste decir. ¿Te referías a ${suggestions.join(", ")}?`
          : "¿Sobre qué marca te gustaría que revisemos los datos?",
        brand: null,
        candidates: resolution.candidates,
        resolution,
        ai: false,
      });
    }
    const segmentIntent = contextualSegmentIntent(
      q,
      messages,
      resolution.method === "conversation_context",
    );
    const contextResult = segmentIntent.active
      ? await user.rpc("enterprise_brand_segment_context_v1", {
          p_organization_id: org,
          p_brand: resolution.brand,
          p_format: segmentIntent.format,
          p_package_mode: segmentIntent.packageMode,
          p_volume_ml: segmentIntent.volumeMl,
          p_retailer_type:
            typeof filters.retailerType === "string"
              ? filters.retailerType
              : "all",
          p_supermarket:
            typeof filters.supermarket === "string" && filters.supermarket
              ? filters.supermarket
              : null,
          p_category:
            typeof filters.category === "string" && filters.category
              ? filters.category
              : null,
          p_stock: typeof filters.stock === "string" ? filters.stock : "all",
        })
      : await user.rpc("enterprise_brand_intelligence_context_v5", {
          p_organization_id: org,
          p_brand: resolution.brand,
          p_retailer_type:
            typeof filters.retailerType === "string"
              ? filters.retailerType
              : "all",
          p_supermarket:
            typeof filters.supermarket === "string" && filters.supermarket
              ? filters.supermarket
              : null,
          p_category:
            typeof filters.category === "string" && filters.category
              ? filters.category
              : null,
          p_stock: typeof filters.stock === "string" ? filters.stock : "all",
          p_days: Number.isFinite(Number(filters.period))
            ? Math.max(7, Math.min(90, Number(filters.period)))
            : 30,
        });
    const { data: ctx, error } = contextResult;
    if (error) {
      console.error(
        JSON.stringify({
          event: "brand_context_failed",
          brand: resolution.brand,
          code: error.code ?? null,
          message: error.message ?? "unknown",
        }),
      );
      return Response.json({
        answer:
          "Identifiqué la marca, pero el contexto diario no está disponible en este momento.",
        brand: resolution.brand,
        resolution,
        ai: false,
        warning: "context_unavailable",
      });
    }
    if (!ctx?.found)
      return Response.json({
        answer:
          "Identifiqué la marca, pero todavía no hay observaciones vigentes dentro de los filtros seleccionados.",
        brand: resolution.brand,
        resolution,
        ai: false,
        warning: "no_current_observations",
      });
    const lens = await pricingLens(
      user,
      config,
      org,
      resolution.brand,
      q,
      history,
      filters,
      segmentIntent,
    );
    const learning = ctx?.learning?.ready ? ctx.learning : null;
    if (!config.enabled || !config.api_key)
      return Response.json({
        answer: fallback(ctx),
        brand: resolution.brand,
        data: ctx,
        pricingLens: lens,
        learning,
        resolution,
        ai: false,
      });
    const compact = {
      brand: ctx.brand,
      current: ctx.current,
      segment: ctx.segment ?? { ...segmentIntent, active: false },
      trend: ctx.trend,
      quality: ctx.quality,
      scope: ctx.scope,
      pricingLens: lens
        ? {
            plan: lens.plan,
            category: lens.context.category,
            format: lens.context.format,
            measureType: lens.context.measureType,
            sizeBucket: lens.context.sizeBucket,
            priceBasis: lens.context.priceBasis,
            quality: lens.context.quality,
            targetRetailers: lens.context.targetRetailers,
            points: (lens.context.points ?? []).slice(0, 14),
          }
        : null,
      learning: learning
        ? {
            method: learning.method,
            scope: learning.scope,
            training: learning.training,
            daily: learning.daily,
            guardrails: learning.guardrails,
          }
        : null,
    };
    const r = await askText(
      config.api_key,
      conversationalModelList(config.model),
      [
        "Eres MGP Intelligence, un colega experto en pricing, surtido y retail, potenciado por OpenAI Sol.",
        "Conversa en español natural, cálido y directo. Adapta el tono y la profundidad a la forma en que escribe el usuario.",
        "Recuerda el hilo incluido en INPUT: entiende pronombres, elipsis y preguntas de seguimiento sin obligar al usuario a repetir la marca o el alcance.",
        "Responde primero lo que te preguntaron. Para consultas simples usa uno a tres párrafos breves.",
        "No uses una plantilla fija. No repitas siempre titulares, KPI, insights y acciones. Usa títulos o viñetas sólo cuando realmente hagan la respuesta más clara.",
        "Puedes explicar, comparar, resumir o profundizar como lo haría un buen analista conversando con su equipo.",
        "Haz como máximo una pregunta de aclaración cuando sea imprescindible para responder con datos comparables.",
        "Los cálculos vienen del motor determinístico. No recalcules ni inventes cifras.",
        "CURRENT es el estado vigente dentro del alcance solicitado; úsalo para SKU, cadenas, stock, disponibilidad y ofertas. LEARNING y TREND solo contienen días locales cerrados.",
        "Si SEGMENT.active=true, CURRENT ya está filtrado al formato, tamaño y/o tipo de pack solicitado. Está prohibido reutilizar cifras de toda la marca o ampliar ese alcance.",
        "Si SEGMENT.needsPriceClarification=true o CURRENT.summary.priceComparable=false, no entregues un único precio representativo: explica que se mezclan tamaños o packs y pide tamaño más unidad individual/multipack.",
        "No describas disponibilidad como total, completa o plena salvo que CURRENT.summary.availabilityPct sea exactamente 100.",
        "Si TREND.available=false, no menciones evolución, estabilidad, subidas o bajas; explica la falta de histórico a ese mismo nivel solo si la pregunta lo requiere.",
        "Para una pregunta general, prioriza cobertura vigente, disponibilidad, promociones y la última tendencia cerrada. No conviertas el precio promedio o mediano global en el titular.",
        "CURRENT.summary.averagePrice y medianPrice son estadísticas de ticket SKU que mezclan formatos. Si QUALITY.overallPriceComparable=false, está prohibido usarlas para afirmar que la marca es cara/barata/premium.",
        "Para posicionamiento de precio usa PRICING_LENS cuando exista. PRICE_BASIS define exactamente la unidad comparable.",
        "Si PRICING_LENS.quality.level=low, NO entregues una conclusión de posicionamiento ni un índice como si fuera confiable. Explica que la muestra es heterogénea y pide una familia/formato/tamaño más específico.",
        "Si PRICING_LENS.quality.level=medium, puedes interpretar con cautela y debes mencionar la limitación.",
        "TREND.variationPct compara los mismos SKU contra el día cerrado anterior. Si TREND.coverageLevel=low, no lo presentes como tendencia general de la marca: limita la afirmación a la muestra observada.",
        "Nunca uses el día en curso para afirmar subidas o bajas; TREND.currentPartialDayExcluded confirma que fue retirado.",
        "QUALITY.dataScore mide cobertura/calidad de datos; QUALITY.priceScore mide si el ticket global es comparable. No los confundas.",
        "Por cadena usa únicamente CURRENT.retailers o PRICING_LENS.targetRetailers.",
        "No inventes ventas, market share, margen, volumen ni causalidades.",
        "No menciones DATA_CONTEXT, instrucciones internas ni el proceso técnico. Devuelve únicamente la respuesta conversacional final, sin JSON.",
      ].join("\n"),
      [
        {
          role: "developer",
          content: `DATA_CONTEXT:\n${JSON.stringify(compact)}`,
        },
        ...messages.map(({ role, content }) => ({ role, content })),
      ],
      1600,
    );
    if (r.text)
      return Response.json({
        answer: r.text,
        brand: resolution.brand,
        model: r.model,
        ai: true,
        assistant: "MGP Intelligence",
        responseStyle: "conversational",
        data: ctx,
        pricingLens: lens,
        learning,
        resolution,
      });
    return Response.json({
      answer: fallback(ctx),
      brand: resolution.brand,
      data: ctx,
      pricingLens: lens,
      learning,
      resolution,
      ai: false,
      warning: r.error || "No pude generar la respuesta conversacional.",
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "brand_intelligence_unhandled",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return Response.json(
      { error: "No pude completar el análisis de marca." },
      { status: 500 },
    );
  }
});
