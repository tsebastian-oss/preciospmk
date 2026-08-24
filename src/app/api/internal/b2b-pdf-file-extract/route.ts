import { NextRequest, NextResponse } from "next/server";
import { GET as downloadTarget } from "../b2b-target-attachment/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function outputText(payload: any) {
  const out: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") out.push(content.text);
    }
  }
  return out.join("\n").trim();
}

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 503 });
  const sourceRequest = new NextRequest("https://internal.local/api/internal/b2b-target-attachment?key=tarapaca-cotizacion");
  const fileResponse = await downloadTarget(sourceRequest);
  if (!fileResponse.ok) return NextResponse.json({ error: `source ${fileResponse.status}` }, { status: 502 });
  const pdf = Buffer.from(await fileResponse.arrayBuffer());
  const prompt = `Documento público chileno de Mercado Público: COTIZACION PORTAL chilexpress.pdf. Lee el PDF completo, incluyendo tablas. No inventes ni completes datos faltantes. Necesito exclusivamente pricing courier B2B explícito y comparable. Devuelve JSON válido sin markdown con: {"document_summary":"...","rates":[{"provider":"...","origin":"... o null","destination":"... o null","weight_kg":numero_o_null,"weight_band":"... o null","service_type":"... o null","unit_price_clp":numero_o_null,"price_basis":"shipment|kg|band|global|other","comparable":true_o_false,"evidence":"texto visible breve"}],"global_amounts":[{"provider":"...","amount_clp":numero,"evidence":"..."}],"notes":["..."]}. comparable=true SOLO si hay tarifa unitaria/banda explícita con contexto suficiente. Montos globales no son comparables.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL ?? "gpt-5").trim(),
        input: [{ role: "user", content: [
          { type: "input_text", text: prompt },
          { type: "input_file", filename: "COTIZACION PORTAL chilexpress.pdf", file_data: `data:application/pdf;base64,${pdf.toString("base64")}`, detail: "high" },
        ] }],
        max_output_tokens: 6000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: payload?.error?.message ?? `OpenAI ${response.status}`, status: response.status }, { status: 502 });
    return NextResponse.json({ pdfBytes: pdf.length, model: payload?.model ?? null, extraction: outputText(payload) }, { headers: { "cache-control": "no-store" } });
  } finally { clearTimeout(timeout); }
}
