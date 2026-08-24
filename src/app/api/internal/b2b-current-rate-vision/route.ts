import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = {
  "servel-oferta": { qs: "GyIjPxWfp99UXtgDGR5gnQ==", ctl: "rptAttachment$ctl05$imgShow", name: "Anexo_N3_Oferta_Economica.pdf", provider: "Empresa de Correos de Chile" },
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
function jpegImages(pdf: Buffer) {
  const images: Buffer[] = [];
  let cursor = 0;
  while (cursor < pdf.length - 4) {
    const start = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), cursor);
    if (start < 0) break;
    const endMarker = pdf.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
    if (endMarker < 0) break;
    const image = pdf.subarray(start, endMarker + 2);
    if (image.length >= 8000) images.push(image);
    cursor = endMarker + 2;
  }
  return images;
}
function outputText(payload: any) {
  const out: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (typeof content?.text === "string") out.push(content.text);
  }
  return out.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") as TargetKey | null;
  if (!key || !(key in TARGETS)) return NextResponse.json({ error: "unknown target", keys: Object.keys(TARGETS) }, { status: 400 });
  const target = TARGETS[key];
  const pdf = await download(target);
  const images = jpegImages(pdf);
  const pageRaw = request.nextUrl.searchParams.get("page");
  if (pageRaw == null) return NextResponse.json({ key, name: target.name, pdfBytes: pdf.length, images: images.length, imageBytes: images.map((x) => x.length) }, { headers: { "cache-control": "no-store" } });
  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 0 || page >= images.length) return NextResponse.json({ error: "invalid page", images: images.length }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL ?? "gpt-5").trim(),
        input: [{ role: "user", content: [
          { type: "input_text", text: `Página ${page + 1} de un documento público de Mercado Público: ${target.name}. Proveedor esperado: ${target.provider}. Lee visualmente la página como tabla. Devuelve SOLO JSON válido sin markdown con {"page":${page + 1},"rates":[{"provider":"...","origin":"... o null","destination":"... o null","region_or_zone":"... o null","weight_kg":numero_o_null,"weight_band":"... o null","service_type":"... o null","delivery_time":"... o null","unit_price_clp":numero_o_null,"price_basis":"shipment|kg|band|other","comparable":true_o_false,"evidence":"texto visible breve"}],"other_prices":[{"label":"...","amount_clp":numero,"evidence":"..."}],"notes":["..."]}. No inventes ni completes datos. comparable=true sólo si la página muestra un precio y suficiente contexto de peso + zona/ruta/servicio para comparar. Si una tabla continúa desde otra página, extrae lo visible y deja constancia en notes.` },
          { type: "input_image", image_url: `data:image/jpeg;base64,${images[page].toString("base64")}`, detail: "high" },
        ] }],
        max_output_tokens: 3500,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ key, page, error: payload?.error?.message ?? `OpenAI ${response.status}` }, { status: 502 });
    return NextResponse.json({ key, name: target.name, page, imageBytes: images[page].length, model: payload?.model ?? null, extraction: outputText(payload) }, { headers: { "cache-control": "no-store" } });
  } finally { clearTimeout(timeout); }
}
