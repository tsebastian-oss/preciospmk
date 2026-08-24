import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = {
  "servel-oferta": { qs: "GyIjPxWfp99UXtgDGR5gnQ==", ctl: "rptAttachment$ctl05$imgShow", name: "Anexo_N3_Oferta_Economica.pdf" },
  "uchile-correos": { qs: "IzHV4W7bPuyf5yq4y0RIGA==", ctl: "rptAttachment$ctl11$imgShow", name: "COT_60.503.000-9.pdf" },
  "uchile-chilexpress": { qs: "IzHV4W7bPuyf5yq4y0RIGA==", ctl: "rptAttachment$ctl12$imgShow", name: "COT_96.756.430-3.pdf" },
  "dgmn-courier": { qs: "5H0iAsYDU3Zwm+cEFaxaBw==", ctl: "rptAttachment$ctl02$imgShow", name: "4108 4 courier.pdf" },
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

function signalLines(text: string) {
  const lines = text.split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  return lines.filter((line) => /\$|precio|tarifa|kg|kilo|gram|regi[oó]n|zona|destino|origen|courier|encomienda|documento|sobre|paquete/i.test(line)).slice(0, 500);
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") as TargetKey | null;
  if (!key || !(key in TARGETS)) return NextResponse.json({ error: "unknown target", keys: Object.keys(TARGETS) }, { status: 400 });
  const target = TARGETS[key];
  const pdf = await download(target);
  try {
    const parsed = await pdfParse(pdf);
    const text = (parsed.text ?? "").replace(/\u0000/g, "").trim();
    return NextResponse.json({ key, name: target.name, bytes: pdf.length, pages: parsed.numpages ?? null, textLength: text.length, signals: signalLines(text), text: text.slice(0, 60000) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ key, name: target.name, bytes: pdf.length, error: error instanceof Error ? error.message : "pdf parse error" }, { status: 422, headers: { "cache-control": "no-store" } });
  }
}
