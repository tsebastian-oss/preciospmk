import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Msg = { role: "user" | "assistant"; content: string };
type PricingRow = {
  month: string;
  zone: string;
  company: string;
  priceClp: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};

function cleanMessages(value: unknown): Msg[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x: any) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x: any) => ({
      role: x.role,
      content: x.content.trim().slice(0, 4000),
    }))
    .filter((x) => x.content)
    .slice(-10);
}

function cleanRows(value: unknown): PricingRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 120)
    .map((x: any) => ({
      month: String(x?.month ?? "").slice(0, 7),
      zone: String(x?.zone ?? "").slice(0, 30),
      company: String(x?.company ?? "").slice(0, 80),
      priceClp: Number(x?.priceClp ?? 0),
      confidence: Number(x?.confidence ?? 0),
      destinations: Number(x?.destinations ?? 0),
      observations: Number(x?.observations ?? 0),
      channel: String(x?.channel ?? "").slice(0, 80),
      plan: String(x?.plan ?? "").slice(0, 140),
    }))
    .filter((x) =>
      /^2026-(08|09|10|11|12)$/.test(x.month) &&
      ["Norte", "Centro", "Sur"].includes(x.zone) &&
      x.company &&
      Number.isFinite(x.priceClp) &&
      x.priceClp > 0 &&
      Number.isFinite(x.confidence),
    );
}

function outputText(payload: any) {
  return (payload?.output ?? [])
    .filter((x: any) => x?.type === "message")
    .flatMap((x: any) => x?.content ?? [])
    .filter((x: any) => x?.type === "output_text" && typeof x.text === "string")
    .map((x: any) => x.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function instructions(rows: PricingRow[], selectedMonth: string) {
  return `Eres MGP Pricing Copilot, consultor senior de pricing para una demo ejecutiva de Chilexpress en Chile.

OBJETIVO
Analiza EXCLUSIVAMENTE la data agregada del dashboard B2B Courier & Logistics y entrega recomendaciones accionables para Chilexpress.

CONTEXTO METODOLÓGICO
- Perfil homogéneo: origen Santiago, paquete <= 0,5 kg y entrega a domicilio.
- Se priorizan tarifas Pyme/Emprendedores; cuando no existen puede haber evidencia Empresa/Mercado Público.
- Price premium vs líder = precio Chilexpress / menor precio comparable de la misma macrozona - 1.
- Las columnas de meses futuros pueden estar vacías; no interpretes ausencia de datos como precio cero.
- Confianza y cobertura son parte de la calidad del benchmark.

REGLAS
- No inventes precios, costos, márgenes, elasticidades, participación de mercado, SLA ni volúmenes no presentes.
- No recomiendes bajar precio automáticamente. Distingue entre: ajustar precio, crear descuento/tier, defender premium con valor, validar elasticidad/conversión o aumentar evidencia.
- Si la evidencia es insuficiente, dilo.
- Cuando compares, usa siempre la misma macrozona y mes.
- Menciona cifras CLP concretas cuando ayuden.
- Si hay datos de varios meses, puedes hablar de evolución solo cuando existan observaciones en ambos meses.
- En recomendaciones, prioriza Chilexpress y explica el porqué comercial.

FORMATO
- Español ejecutivo.
- Primera línea: conclusión principal.
- Luego 3 a 5 bullets con "•".
- Máximo 220 palabras salvo que el usuario pida más detalle.
- No uses tablas Markdown ni bloques de código.

MES SELECCIONADO EN PANTALLA
${selectedMonth}

DATA
${JSON.stringify(rows)}`;
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const messages = cleanMessages(body?.messages);
    const rows = cleanRows(body?.rows);
    const selectedMonth = String(body?.selectedMonth ?? "").slice(0, 7);

    if (!messages.length || !rows.length) {
      return NextResponse.json({ error: "Falta contexto suficiente para responder." }, { status: 400 });
    }

    if (OPENAI_API_KEY.length < 20) {
      return NextResponse.json({ error: "El asistente de pricing no está configurado." }, { status: 503 });
    }

    const models = [...new Set([OPENAI_MODEL, "gpt-5.6", "gpt-5.1", "gpt-5", "gpt-4.1"].filter(Boolean))];

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        const response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            instructions: instructions(rows, selectedMonth),
            input: messages,
            store: false,
            max_output_tokens: 1400,
          }),
          signal: controller.signal,
          cache: "no-store",
        });

        clearTimeout(timeout);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) continue;

        const answer = outputText(data);
        if (answer) return NextResponse.json({ answer, model });
      } catch {
        // Try next configured model.
      }
    }

    return NextResponse.json({ error: "No fue posible generar una recomendación en este momento." }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "No fue posible procesar la consulta." }, { status: 500 });
  }
}
