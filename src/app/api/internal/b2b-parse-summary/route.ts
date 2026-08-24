import { NextRequest, NextResponse } from "next/server";
import { GET as parseTargets } from "../b2b-parse-targets/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SIGNAL = /(\$|precio|tarifa|valor|kg|kilo|gram|sobre|encomienda|valija|santiago|arica|iquique|antofagasta|copiap[oó]|serena|valpara[ií]so|rancagua|talca|chill[aá]n|concepci[oó]n|temuco|valdivia|puerto montt|chilexpress|correos)/i;

function compactText(text: string) {
  const parts = text.split(/\s*\|\s*|\n+/).map(v => v.trim()).filter(Boolean);
  const selected = new Map<number, string>();
  for (let i = 0; i < parts.length; i += 1) {
    if (!SIGNAL.test(parts[i])) continue;
    for (let j = Math.max(0, i - 3); j <= Math.min(parts.length - 1, i + 4); j += 1) selected.set(j, parts[j]);
  }
  return [...selected.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({ index, value })).slice(0, 450);
}

function compactSheets(sheets: unknown) {
  if (!Array.isArray(sheets)) return [];
  return sheets.map((sheet: any) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    const kept: Array<{ row: number; values: unknown[] }> = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const text = row.map(v => v == null ? "" : String(v)).join(" | ");
      if (i < 25 || SIGNAL.test(text)) kept.push({ row: i + 1, values: row });
      if (kept.length >= 250) break;
    }
    return { name: sheet?.name ?? null, rows: kept };
  });
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const response = await parseTargets();
  const payload = await response.json();
  const target = Array.isArray(payload?.results) ? payload.results.find((item: any) => item?.key === key) : null;
  if (!target) return NextResponse.json({ error: "target not found" }, { status: 404 });
  if (target.error) return NextResponse.json(target, { status: 502 });
  if (typeof target.text === "string") {
    return NextResponse.json({ key: target.key, name: target.name, bytes: target.bytes, matches: compactText(target.text) }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ key: target.key, name: target.name, bytes: target.bytes, sheets: compactSheets(target.sheets) }, { headers: { "cache-control": "no-store" } });
}
