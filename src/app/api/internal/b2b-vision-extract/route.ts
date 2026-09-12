import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = {
  "tarapaca-comparativo": { qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl03$imgShow", name: "Cuadro Comparativo.pdf" },
  "tarapaca-cotizacion": { qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl04$imgShow", name: "COTIZACION PORTAL chilexpress.pdf" },
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
  const params = hiddenInputs(html); params.set(`${target.ctl}.x`, "1"); params.set(`${target.ctl}.y`, "1");
  const cookie = cookieHeader(initial.headers);
  const response = await fetch(url, { method: "POST", cache: "no-store", redirect: "follow", headers: { "user-agent": "Mozilla/5.0", accept: "*/*", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: params.toString() });
  if (!response.ok) throw new Error(`attachment ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function jpegImages(pdf: Buffer) {
  const images: Buffer[] = [];
  let cursor = 0;
  while (cursor < pdf.length - 4) {
    const start = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), cursor);
    if (start < 0) break;
    const endMarker = pdf.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
    if (endMarker < 0) break;
    const image = pdf.subarray(start, endMarker + 2);
    if (image.length >= 12000) images.push(image);
    cursor = endMarker + 2;
  }
  return images.sort((a, b) => b.length - a.length).slice(0, 8);
}
function outputText(payload: any) {
  const out: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") out.push(content.text);
    }
  }
  return out.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const denied = await denyUnlessInternal(request);
  if (denied) return denied;
  const key = request.nextUrl.searchParams.get("key") as TargetKey | null;
  if (!key || !(key in TARGETS)) return NextResponse.json({ error: "unknown target" }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 503 });
  const target = TARGETS[key];
  const pdf = await download(target);
  const images = jpegImages(pdf);
  if (!images.length) return NextResponse.json({ key, name: target.name, pdfBytes: pdf.length, images: 0, error: "no embedded JPEG pages" }, { status: 422 });

  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: `Documento público chileno de Mercado Público: ${target.name}. Analiza las imágenes como tablas/documentos, no inventes ni completes datos faltantes. Necesito exclusivamente pricing courier B2B explícito y comparable. Devuelve JSON válido, sin markdown, con esta forma: {"document_summary":"...","rates":[{"provider":"...","origin":"... o null","destination":"... o null","weight_kg":numero_o_null,"weight_band":"... o null","service_type":"... o null","unit_price_clp":numero_o_null,"price_basis":"shipment|kg|band|global|other","comparable":true_o_false,"evidence":"texto visible exacto o muy breve"}],"global_amounts":[{"provider":"...","amount_clp":numero,"evidence":"..."}],"notes":["..."]}. Marca comparable=true SOLO si el documento muestra explícitamente una tarifa unitaria/banda con suficiente contexto (ruta o zona y peso/servicio). Los montos globales de contratos o bolsas deben ir en global_amounts y NO en rates comparables.`,
  }];
  for (const image of images) content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "high" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: (process.env.OPENAI_MODEL ?? "gpt-5").trim(), input: [{ role: "user", content }], max_output_tokens: 5000 }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ key, name: target.name, pdfBytes: pdf.length, images: images.length, error: payload?.error?.message ?? `OpenAI ${response.status}` }, { status: 502 });
    return NextResponse.json({ key, name: target.name, pdfBytes: pdf.length, images: images.length, model: payload?.model ?? null, extraction: outputText(payload) }, { headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timeout);
  }
}
