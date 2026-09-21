import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/responses";
const MODEL = "openai/gpt-5.6-sol";

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

export async function GET() {
  const gatewayToken = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? "";
  if (!gatewayToken) {
    return NextResponse.json({ ok: false, stage: "config", error: "missing_gateway_auth" }, { status: 503 });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gatewayToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: "Return only the word OK.",
        input: [{ role: "user", content: "Health check" }],
        store: false,
        max_output_tokens: 256,
        reasoning: { effort: "low" },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : { raw: raw.slice(0, 250) }; } catch { data = { raw: raw.slice(0, 250) }; }
    const answer = outputText(data);
    return NextResponse.json({
      ok: response.ok && answer === "OK",
      status: response.status,
      model: data?.model || MODEL,
      hasOutput: Boolean(answer),
      answer: answer || null,
      responseStatus: data?.status || null,
      incompleteReason: data?.incomplete_details?.reason || null,
      errorCode: data?.error?.code || data?.error?.type || null,
      errorMessage: typeof data?.error?.message === "string" ? data.error.message.slice(0, 250) : null,
      durationMs: Date.now() - startedAt,
    }, { status: response.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stage: "request",
      error: error instanceof Error ? error.name : "unknown",
      durationMs: Date.now() - startedAt,
    }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
