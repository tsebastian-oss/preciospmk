import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Msg = { role: "user" | "assistant"; content: string };
type RouteRow = {
  destination: string;
  weightBand: string;
  distanceBand: string;
  serviceType: string;
  chilexpress: number;
  competitor: number;
  competitorName: string;
  index: number;
  gap: number;
  latestDate: string;
  source: string;
};

function cleanMessages(value: unknown): Msg[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x: any) => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x: any) => ({ role: x.role, content: x.content.trim().slice(0, 4000) }))
    .filter((x) => x.content)
    .slice(-10);
}

function cleanRoutes(value: unknown): RouteRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((x: any) => ({
    destination: String(x?.destination ?? "").slice(0, 120),
    weightBand: String(x?.weightBand ?? "").slice(0, 80),
    distanceBand: String(x?.distanceBand ?? "").slice(0, 80),
    serviceType: String(x?.serviceType ?? "").slice(0, 140),
    chilexpress: Number(x?.chilexpress ?? 0),
    competitor: Number(x?.competitor ?? 0),
    competitorName: String(x?.competitorName ?? "").slice(0, 120),
    index: Number(x?.index ?? 0),
    gap: Number(x?.gap ?? 0),
    latestDate: String(x?.latestDate ?? "").slice(0, 20),
    source: String(x?.source ?? "").slice(0, 160),
  })).filter((x) => x.destination && x.chilexpress > 0 && x.competitor > 0);
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

function instructions(routes: RouteRow[]) {
  return `Eres MGP Pricing Copilot, analista senior de pricing para una demo ejecutiva de Chilexpress.

OBJETIVO
Responder preguntas sobre posicionamiento competitivo courier usando EXCLUSIVAMENTE la matriz entregada.

REGLAS
- No inventes tarifas, márgenes, costos, elasticidades, SLA ni participación de mercado.
- La matriz compara Chilexpress con el benchmark disponible para la misma ruta/perfil.
- Price Index: benchmark = 100. Sobre 100 significa Chilexpress más caro; bajo 100 significa más barato.
- Si el usuario pregunta por aumentar precio y no hay rutas bajo 95, dilo claramente.
- Distingue evidencia pública comercial de evidencia B2B pública cuando corresponda.
- Si falta un competidor o una banda de peso, dilo; no completes datos.
- Prioriza acciones: revisar premium, validar comparabilidad, atributos de servicio, elasticidad y conversión.

FORMATO
- Español ejecutivo y muy claro.
- Máximo 180 palabras salvo que pidan detalle.
- Primera línea: conclusión.
- Luego 3 a 5 bullets con "•".
- Cifras CLP con separador de miles.
- No uses tablas Markdown ni bloques de código.

MATRIZ
${JSON.stringify(routes)}`;
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const messages = cleanMessages(body?.messages);
    const routes = cleanRoutes(body?.routes);
    if (!messages.length || !routes.length) return NextResponse.json({ error: "Falta contexto para responder." }, { status: 400 });
    if (OPENAI_API_KEY.length < 20) return NextResponse.json({ error: "Copilot no configurado." }, { status: 503 });

    const models = [...new Set([OPENAI_MODEL, "gpt-5.6", "gpt-5.1", "gpt-5", "gpt-4.1"].filter(Boolean))];
    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        const response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ model, instructions: instructions(routes), input: messages, store: false, max_output_tokens: 1200 }),
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeout);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if ([400, 403, 404].includes(response.status)) continue;
          break;
        }
        const answer = outputText(data);
        if (answer) return NextResponse.json({ answer, model: data?.model || model }, { headers: { "cache-control": "private, no-store" } });
      } catch {
        continue;
      }
    }
    return NextResponse.json({ error: "No fue posible consultar el Copilot." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "No fue posible consultar el Copilot." }, { status: 503 });
  }
}
