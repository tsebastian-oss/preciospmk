import { NextResponse } from "next/server";
import { inflateRawSync, inflateSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TARGETS = [
  { key: "tarapaca-comparativo", qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl03$imgShow", name: "Cuadro Comparativo.pdf", kind: "pdf" },
  { key: "tarapaca-cotizacion", qs: "Bt2OVs/y+GyXo1Fgl+ukSg==", ctl: "rptAttachment$ctl04$imgShow", name: "COTIZACION PORTAL chilexpress.pdf", kind: "pdf" },
  { key: "servel-comparativo", qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl04$imgShow", name: "Cuadro comparativo compra agil- servicio courier_2026.xlsx", kind: "xlsx" },
  { key: "servel-chilexpress", qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl07$imgShow", name: "COT_96.756.430-3.pdf", kind: "pdf" },
  { key: "servel-correos", qs: "V8ckU2Rz+r4kej8lNdnZoQ==", ctl: "rptAttachment$ctl08$imgShow", name: "COT_60.503.000-9.pdf", kind: "pdf" },
] as const;

function htmlDecode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function xmlDecode(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function hiddenInputs(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    params.set(name, htmlDecode(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? ""));
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
async function download(qs: string, ctl: string) {
  const url = `https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=${encodeURIComponent(qs)}`;
  const initial = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!initial.ok) throw new Error(`attachment page ${initial.status}`);
  const html = await initial.text();
  const params = hiddenInputs(html);
  params.set(`${ctl}.x`, "1"); params.set(`${ctl}.y`, "1");
  const cookie = cookieHeader(initial.headers);
  const response = await fetch(url, { method: "POST", cache: "no-store", redirect: "follow", headers: { "user-agent": "Mozilla/5.0", accept: "*/*", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: params.toString() });
  if (!response.ok) throw new Error(`attachment ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function unescapePdf(value: string) {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\\") { out += value[i]; continue; }
    i += 1; if (i >= value.length) break;
    const c = value[i];
    if (c === "n") out += "\n"; else if (c === "r") out += "\r"; else if (c === "t") out += "\t"; else if (c === "b") out += "\b"; else if (c === "f") out += "\f";
    else if (c === "(" || c === ")" || c === "\\") out += c;
    else if (/[0-7]/.test(c)) { let oct = c; for (let j = 0; j < 2 && i + 1 < value.length && /[0-7]/.test(value[i + 1]); j += 1) oct += value[++i]; out += String.fromCharCode(parseInt(oct, 8)); }
    else if (c === "\r" && value[i + 1] === "\n") i += 1; else if (c !== "\n" && c !== "\r") out += c;
  }
  return out;
}
function literalStrings(value: string) {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "(") continue;
    let depth = 1, raw = "";
    for (i += 1; i < value.length && depth > 0; i += 1) {
      const c = value[i];
      if (c === "\\") { raw += c; if (i + 1 < value.length) raw += value[++i]; continue; }
      if (c === "(") { depth += 1; raw += c; continue; }
      if (c === ")") { depth -= 1; if (depth === 0) break; raw += c; continue; }
      raw += c;
    }
    const text = unescapePdf(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
    if (text) out.push(text);
  }
  return out;
}
function pdfText(buffer: Buffer) {
  const binary = buffer.toString("latin1");
  const chunks: string[] = [];
  let position = 0;
  while (true) {
    const streamIndex = binary.indexOf("stream", position); if (streamIndex < 0) break;
    let start = streamIndex + 6;
    if (binary[start] === "\r" && binary[start + 1] === "\n") start += 2; else if (binary[start] === "\n" || binary[start] === "\r") start += 1;
    const endIndex = binary.indexOf("endstream", start); if (endIndex < 0) break;
    let end = endIndex; while (end > start && (binary[end - 1] === "\n" || binary[end - 1] === "\r")) end -= 1;
    const raw = buffer.subarray(start, end);
    const header = binary.slice(Math.max(0, binary.lastIndexOf("obj", streamIndex) - 300), streamIndex);
    try {
      const decoded = /FlateDecode/.test(header) ? inflateSync(raw) : raw;
      const strings = literalStrings(decoded.toString("latin1"));
      if (strings.length) chunks.push(strings.join(" | "));
    } catch {}
    position = endIndex + 9;
  }
  return chunks.join("\n").replace(/\s*\|\s*/g, " | ").slice(0, 120000);
}

function zipEntries(buffer: Buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) { if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("ZIP EOCD not found");
  const total = buffer.readUInt16LE(eocd + 10); const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>(); let p = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(p + 10); const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28); const extraLength = buffer.readUInt16LE(p + 30); const commentLength = buffer.readUInt16LE(p + 32); const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28); const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let decoded: Buffer | null = null;
      if (method === 0) decoded = compressed; else if (method === 8) { try { decoded = inflateRawSync(compressed); } catch {} }
      if (decoded) entries.set(name, decoded);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function colNumber(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A"; let n = 0; for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64; return n - 1;
}
function xlsxSheets(buffer: Buffer) {
  const entries = zipEntries(buffer);
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared: string[] = [];
  for (const si of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const pieces = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(m => xmlDecode(m[1])); shared.push(pieces.join(""));
  }
  const sheets: Array<{ name: string; rows: Array<Array<string | number | null>> }> = [];
  const names = [...entries.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/sheet(\d+)/i)?.[1] ?? 0) - Number(b.match(/sheet(\d+)/i)?.[1] ?? 0));
  for (const name of names) {
    const xml = entries.get(name)!.toString("utf8"); const rows: Array<Array<string | number | null>> = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const row: Array<string | number | null> = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cellMatch[1], body = cellMatch[2]; const ref = attrs.match(/\br=["']([^"']+)["']/i)?.[1] ?? "A1"; const type = attrs.match(/\bt=["']([^"']+)["']/i)?.[1] ?? "";
        const vRaw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1]; const inline = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i)?.[1]; let value: string | number | null = null;
        if (type === "s" && vRaw != null) value = shared[Number(vRaw)] ?? vRaw; else if (type === "inlineStr" && inline != null) value = xmlDecode(inline); else if ((type === "str" || type === "e") && vRaw != null) value = xmlDecode(vRaw); else if (vRaw != null) { const n = Number(vRaw); value = Number.isFinite(n) ? n : xmlDecode(vRaw); }
        row[colNumber(ref)] = value;
      }
      if (row.some(v => v !== null && v !== undefined && String(v).trim() !== "")) rows.push(row.slice(0, 60));
      if (rows.length >= 500) break;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

export async function GET() {
  const results: Array<Record<string, unknown>> = [];
  for (const target of TARGETS) {
    try {
      const buffer = await download(target.qs, target.ctl);
      if (target.kind === "xlsx") results.push({ key: target.key, name: target.name, bytes: buffer.length, magic: buffer.subarray(0, 8).toString("hex"), sheets: xlsxSheets(buffer) });
      else results.push({ key: target.key, name: target.name, bytes: buffer.length, magic: buffer.subarray(0, 8).toString("hex"), text: pdfText(buffer) });
    } catch (error) {
      results.push({ key: target.key, name: target.name, error: error instanceof Error ? error.message : "parse error" });
    }
  }
  return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
}
