import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODEL = (process.env.PIWEN_OPENAI_MODEL ?? "gpt-5.6-sol").trim();

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
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, stage: "config", error: "missing_openai_key" }, { status: 503 });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
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
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
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
