import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/responses";
const MODELS = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "openai/gpt-5-nano",
];

function outputText(response: any) {
  return (response?.output ?? [])
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item: any) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function GET(request: NextRequest) {
  const token = (
    process.env.AI_GATEWAY_API_KEY
    ?? request.headers.get("x-vercel-oidc-token")
    ?? ""
  ).trim();

  if (!token) {
    return NextResponse.json(
      { ok: false, stage: "config", error: "missing_gateway_auth" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const attempts: Array<Record<string, unknown>> = [];

  for (const model of MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const startedAt = Date.now();

    try {
      const response = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions: "Return exactly the word OK.",
          input: [{ role: "user", content: "Health check" }],
          store: false,
          max_output_tokens: 64,
          reasoning: { effort: "low" },
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      const answer = outputText(data);
      attempts.push({
        requestedModel: model,
        status: response.status,
        resolvedModel: data?.model || null,
        answer: answer || null,
        errorCode: data?.error?.code || data?.error?.type || null,
        errorMessage: typeof data?.error?.message === "string" ? data.error.message.slice(0, 180) : null,
        durationMs: Date.now() - startedAt,
      });

      if (response.ok && answer === "OK") {
        return NextResponse.json({
          ok: true,
          selectedModel: model,
          resolvedModel: data?.model || model,
          attempts,
        }, { headers: { "cache-control": "no-store" } });
      }
    } catch (error) {
      attempts.push({
        requestedModel: model,
        status: 503,
        error: error instanceof Error ? error.name : "unknown",
        durationMs: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json({
    ok: false,
    error: "no_usable_free_tier_model",
    attempts,
  }, { status: 503, headers: { "cache-control": "no-store" } });
}
