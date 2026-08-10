import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const piece of item?.content ?? []) {
      if (typeof piece?.text === "string") parts.push(piece.text);
    }
  }
  return parts.join("\n");
}

function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function modelPreference(configured: string | null, available: Set<string>) {
  const preferred = [
    configured,
    "gpt-4.1-mini",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4o",
    "gpt-3.5-turbo"
  ].filter((value): value is string => Boolean(value));
  return [...new Set(preferred)].filter((model) => available.has(model));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return Response.json({ error: "No autorizado" }, { status: 401 });

    const serviceClient = createClient(url, service);
    const { data: config, error: configError } = await serviceClient.rpc("get_ai_runtime_config_service");
    if (configError) return Response.json({ error: `Configuración IA: ${configError.message}` }, { status: 500 });
    if (!config?.enabled || !config?.api_key) return Response.json({ enabled: false, reason: "not_configured" });

    const modelsResponse = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${config.api_key}` },
      cache: "no-store"
    });
    const modelsPayload = await modelsResponse.json().catch(() => ({}));
    if (!modelsResponse.ok) {
      const detail = modelsPayload?.error?.message ?? `No se pudo consultar modelos de OpenAI (${modelsResponse.status})`;
      return Response.json({ error: detail, enabled: true, stage: "model_discovery" }, { status: 502 });
    }

    const available = new Set<string>((modelsPayload?.data ?? []).map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === "string"));
    const candidates = modelPreference(config.model ?? null, available);
    if (!candidates.length) {
      return Response.json({
        error: "La API key es válida, pero este proyecto no tiene un modelo de texto compatible habilitado. Revisa billing y permisos del proyecto en OpenAI.",
        enabled: true,
        stage: "model_selection"
      }, { status: 502 });
    }

    const body = await req.json();
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
    let learning: any = null;
    if (organizationId) {
      const { data: learningData, error: learningError } = await userClient.rpc("enterprise_ai_learning_context", {
        p_organization_id: organizationId,
        p_brand: typeof body?.target?.brand === "string" ? body.target.brand : null,
        p_category: typeof body?.target?.category === "string" ? body.target.category : null,
        p_retailer_type: "all",
        p_supermarket: null,
        p_days: 30
      });
      if (!learningError && learningData?.ready) learning = learningData;
    }
    const prompt = [
      "Eres un analista senior de pricing para supermercados en Chile.",
      "Analiza el producto objetivo y su set competitivo prefiltrado.",
      "Entrega una explicación ejecutiva específica, no repitas solo métricas.",
      "Incluye hasta 3 acciones concretas y hasta 3 riesgos.",
      "La sección continuousLearning es memoria histórica recalculada desde observaciones diarias válidas.",
      "Para tendencias prioriza daily.sameSkuChangePct; averagePrice es descriptivo y puede variar por composición de surtido.",
      "No inventes datos. Devuelve exclusivamente JSON con explanation, actions y risks.",
      JSON.stringify({ request: body, continuousLearning: learning })
    ].join("\n");

    let lastError = "No fue posible ejecutar un modelo disponible";
    for (const model of candidates) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${config.api_key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: prompt, store: false })
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = raw?.error?.message ?? `OpenAI ${response.status}`;
        const accessError = response.status === 403 || response.status === 404 || /does not have access|model.*not found|unsupported/i.test(lastError);
        if (accessError) continue;
        return Response.json({ error: lastError, enabled: true, model, stage: "generation" }, { status: 502 });
      }
      const parsed = parseJson(outputText(raw));
      if (!parsed) return Response.json({ error: "OpenAI no devolvió JSON válido", enabled: true, model, stage: "parsing" }, { status: 502 });
      return Response.json({
        enabled: true,
        model,
        explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
        actions: Array.isArray(parsed.actions) ? parsed.actions.filter((x: unknown) => typeof x === "string").slice(0, 3) : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.filter((x: unknown) => typeof x === "string").slice(0, 3) : [],
        learning
      });
    }

    return Response.json({ error: lastError, enabled: true, attemptedModels: candidates, stage: "generation" }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
