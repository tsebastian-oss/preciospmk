import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const CONFIGURED_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5.6-sol").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

function category(status: number, code: string | null) {
  const normalized = String(code || "").toLowerCase();
  if (status === 401) return "authentication";
  if (status === 403) return "permission_or_model_access";
  if (status === 404) return "model_not_found";
  if (status === 429 || normalized.includes("quota") || normalized.includes("rate")) return "quota_or_rate_limit";
  if (status === 400) return "request_validation";
  if (status >= 500) return "openai_unavailable";
  return "unknown";
}

function isReasoningModel(model: string) {
  return /^gpt-5\.6(?:-|$)/i.test(model) || /^gpt-5(?:\.|-|$)/i.test(model) || /^o\d/i.test(model);
}

async function probe(model: string) {
  if (!OPENAI_API_KEY) {
    return { model, ok: false, status: 0, category: "not_configured", code: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const body: Record<string, unknown> = {
      model,
      input: "Responde únicamente OK.",
      store: false,
      max_output_tokens: isReasoningModel(model) ? 128 : 32,
    };
    if (isReasoningModel(model)) body.reasoning = { effort: "low" };

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as {
      model?: string;
      error?: { code?: string; type?: string };
    };
    const code = payload?.error?.code || payload?.error?.type || null;
    return {
      model,
      resolvedModel: response.ok ? payload.model ?? model : null,
      ok: response.ok,
      status: response.status,
      category: response.ok ? "ready" : category(response.status, code),
      code,
    };
  } catch (error) {
    return {
      model,
      resolvedModel: null,
      ok: false,
      status: (error as Error)?.name === "AbortError" ? 408 : 0,
      category: (error as Error)?.name === "AbortError" ? "timeout" : "network_or_runtime",
      code: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-intelligence");
  if (authorization.response) return authorization.response;

  const candidates = [...new Set([
    CONFIGURED_MODEL,
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-4.1",
  ])];

  const attempts = [] as Awaited<ReturnType<typeof probe>>[];
  for (const model of candidates) attempts.push(await probe(model));

  const firstWorking = attempts.find((item) => item.ok) ?? null;
  const configuredAttempt = attempts.find((item) => item.model === CONFIGURED_MODEL) ?? null;

  return NextResponse.json({
    ok: Boolean(configuredAttempt?.ok),
    configuredModel: CONFIGURED_MODEL,
    configuredModelStatus: configuredAttempt,
    firstWorkingModel: firstWorking?.resolvedModel ?? firstWorking?.model ?? null,
    attempts,
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}
