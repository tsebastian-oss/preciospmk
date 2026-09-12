import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = {
  "tarapaca-comparativo": { qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl03$imgShow", name: "Cuadro Comparativo.pdf" },
  "tarapaca-cotizacion": { qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl04$imgShow", name: "COTIZACION PORTAL chilexpress.pdf" },
  "servel-comparativo": { qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl04$imgShow", name: "Cuadro comparativo compra agil- servicio courier_2026.xlsx" },
  "servel-cot-188285465": { qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl06$imgShow", name: "COT_18.828.546-5.pdf" },
  "servel-chilexpress": { qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl07$imgShow", name: "COT_96.756.430-3.pdf" },
  "servel-correos": { qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl08$imgShow", name: "COT_60.503.000-9.pdf" },
  "servel-cot-779891178": { qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl09$imgShow", name: "COT_77.989.117-8.pdf" },
} as const;

type TargetKey = keyof typeof TARGETS;

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function hiddenInputs(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    params.set(name, decodeHtml(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? ""));
  }
  return params;
}

function cookieHeader(headers: Headers) {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const raw = anyHeaders.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const cookies: string[] = [];
  for (const item of raw) {
    for (const match of item.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g)) cookies.push(match[1]);
  }
  return Array.from(new Set(cookies)).join("; ");
}

export async function GET(request: NextRequest) {
  const denied = await denyUnlessInternal(request);
  if (denied) return denied;
  const key = request.nextUrl.searchParams.get("key") as TargetKey | null;
  if (!key || !(key in TARGETS)) return NextResponse.json({ error: "unknown target" }, { status: 400 });

  const target = TARGETS[key];
  const url = `https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=${encodeURIComponent(target.qs)}`;
  const initial = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!initial.ok) return NextResponse.json({ error: `attachment page ${initial.status}` }, { status: 502 });
  const html = await initial.text();
  const params = hiddenInputs(html);
  params.set(`${target.ctl}.x`, "1");
  params.set(`${target.ctl}.y`, "1");

  const downloaded = await fetch(url, {
    method: "POST",
    cache: "no-store",
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      ...(cookieHeader(initial.headers) ? { cookie: cookieHeader(initial.headers) } : {}),
    },
    body: params.toString(),
  });
  if (!downloaded.ok) return NextResponse.json({ error: `attachment ${downloaded.status}` }, { status: 502 });

  const bytes = await downloaded.arrayBuffer();
  const type = downloaded.headers.get("content-type") || (target.name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
  const disposition = downloaded.headers.get("content-disposition") || `attachment; filename="${target.name}"`;
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": disposition,
      "cache-control": "no-store",
    },
  });
}
