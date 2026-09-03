import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = {
  "servel-oferta": { qs: "GyIjPxWfp99UXtgDGR5gnQ==", ctl: "rptAttachment$ctl05$imgShow", name: "Anexo_N3_Oferta_Economica.pdf", provider: "Empresa de Correos de Chile" },
  "uchile-correos": { qs: "IzHV4W7bPuyf5yq4y0RIGA==", ctl: "rptAttachment$ctl11$imgShow", name: "COT_60.503.000-9.pdf", provider: "Empresa de Correos de Chile" },
  "uchile-chilexpress": { qs: "IzHV4W7bPuyf5yq4y0RIGA==", ctl: "rptAttachment$ctl12$imgShow", name: "COT_96.756.430-3.pdf", provider: "Chilexpress" },
  "dgmn-courier": { qs: "5H0iAsYDU3Zwm+cEFaxaBw==", ctl: "rptAttachment$ctl02$imgShow", name: "4108 4 courier.pdf", provider: "Empresa de Correos de Chile" },
} as const;

type TargetKey = keyof typeof TARGETS;

function htmlDecode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function hiddenInputs(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (name) params.set(name, htmlDecode(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? ""));
  }
  return params;
}
function cookieHeader(headers: Headers) {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const raw = anyHeaders.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const cookies: string[] = [];
  for (const item of raw) for (const match of item.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g)) cookies.push(match[1]);
  return Array.from(new Set(cookies)).join("; ");
}
async function download(target: (typeof TARGETS)[TargetKey]) {
  const url = `https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=${encodeURIComponent(target.qs)}`;
  const initial = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!initial.ok) throw new Error(`attachment page ${initial.status}`);
  const html = await initial.text();
  const params = hiddenInputs(html);
  params.set(`${target.ctl}.x`, "1");
  params.set(`${target.ctl}.y`, "1");
  const cookie = cookieHeader(initial.headers);
  const response = await fetch(url, { method: "POST", cache: "no-store", redirect: "follow", headers: { "user-agent": "Mozilla/5.0", accept: "*/*", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: params.toString() });
  if (!response.ok) throw new Error(`attachment ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function outputText(payload: any) {
  const out: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (typeof content?.text === "string") out.push(content.text);
  }
  return out.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const denied = await denyUnlessInternal(request);
  if (denied) return denied;
  const key = request.nextUrl.searchParams.get("key") as TargetKey | null;
  if (!key || !(key in TARGETS)) return NextResponse.json({ error: "unknown target", keys: Object.keys(TARGETS) }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 503 });
  const target = TARGETS[key];
  const pdf = await download(target);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL ?? "gpt-5").trim(),
        input: [{ role: "user", content: [
          { type: "input_text", text: `Documento público de Mercado Público. Proveedor esperado: ${target.provider}. Extrae SOLO tarifas courier B2B explícitas, sin inferir datos faltantes. Devuelve JSON válido sin markdown con: {"document_summary":"...","rates":[{"provider":"...","origin":"... o null","destination":"... o null","region_or_zone":"... o null","weight_kg":numero_o_null,"weight_band":"... o null","service_type":"... o null","delivery_time":"... o null","unit_price_clp":numero_o_null,"price_basis":"shipment|kg|band|other","comparable":true_o_false,"evidence":"texto breve visible"}],"global_amounts":[{"amount_clp":numero,"evidence":"..."}],"notes":["..."]}. comparable=true sólo cuando haya precio unitario/banda con contexto suficiente de peso y zona/ruta/servicio. No conviertas montos globales en tarifas.` },
          { type: "input_file", filename: target.name, file_data: `data:application/pdf;base64,${pdf.toString("base64")}` },
        ] }],
        max_output_tokens: 9000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ key, name: target.name, bytes: pdf.length, error: payload?.error?.message ?? `OpenAI ${response.status}` }, { status: 502 });
    return NextResponse.json({ key, name: target.name, provider: target.provider, bytes: pdf.length, model: payload?.model ?? null, extraction: outputText(payload) }, { headers: { "cache-control": "no-store" } });
  } finally { clearTimeout(timeout); }
}
