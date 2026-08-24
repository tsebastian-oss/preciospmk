import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const BASE = "https://api.mercadopublico.cl/APISOCDS/OCDS";
const COURIER_TERMS = [
  "courier", "mensajeria", "mensajería", "encomienda", "correspondencia", "paqueteria", "paquetería",
  "entrega postal", "correo nacional", "correo internacional", "valija", "despacho de documentos",
];
const COURIER_CODES = ["78102201", "78102202", "78102203", "78102204", "78102205", "78101802"];

type Json = Record<string, any>;
type Observation = Record<string, unknown>;

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Json[] : [];
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function providerGroup(name: string) {
  const n = normalize(name);
  if (n.includes("chilexpress")) return "Chilexpress";
  if (n.includes("correos de chile") || n.includes("empresa de correos")) return "CorreosChile";
  if (n.includes("blue express") || n.includes("bluexpress")) return "Blue Express";
  if (n.includes("starken")) return "Starken";
  return name || "Otros";
}
function serviceType(code: string, description: string) {
  if (code === "78102204") return "Courier internacional";
  if (code === "78102205") return "Mensajería";
  if (code === "78102203") return "Entrega / recolección de correo";
  if (code === "78102202") return "Franqueo";
  if (code === "78102201") return "Entrega postal nacional";
  if (code === "78101802") return "Transporte y distribución";
  const n = normalize(description);
  if (n.includes("internacional")) return "Courier internacional";
  if (n.includes("mensaj")) return "Mensajería";
  if (n.includes("encomienda")) return "Encomiendas";
  if (n.includes("correspond")) return "Correspondencia";
  return "Courier y logística";
}
function isCourier(provider: string, code: string, description: string) {
  const p = providerGroup(provider);
  if (["Chilexpress", "CorreosChile", "Blue Express", "Starken"].includes(p)) return true;
  if (COURIER_CODES.some((prefix) => code.startsWith(prefix))) return true;
  const n = normalize(description);
  return COURIER_TERMS.some((term) => n.includes(normalize(term)));
}
function releaseCandidates(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 5 || !value) return out;
  if (Array.isArray(value)) {
    for (const item of value) releaseCandidates(item, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  const obj = value as Json;
  const release = obj.compiledRelease ?? obj.release ?? null;
  if (release && typeof release === "object") out.push(release as Json);
  else if (obj.ocid && (obj.tender || obj.awards || obj.contracts || obj.buyer)) out.push(obj);
  for (const [key, child] of Object.entries(obj)) {
    if (["compiledRelease", "release", "releases"].includes(key)) {
      if (key === "releases") releaseCandidates(child, out, depth + 1);
      continue;
    }
    if (depth < 3 && (Array.isArray(child) || (child && typeof child === "object"))) releaseCandidates(child, out, depth + 1);
  }
  return out;
}
function partyBuyer(release: Json) {
  if (release.buyer?.name) return text(release.buyer.name);
  return text(asArray(release.parties).find((p) => asArray(p.roles).some((role: any) => String(role) === "buyer"))?.name);
}
function supplierNames(award: Json, release: Json) {
  const direct = asArray(award.suppliers).map((s) => text(s.name)).filter(Boolean);
  if (direct.length) return direct;
  return asArray(release.parties)
    .filter((p) => asArray(p.roles).some((role: any) => ["supplier", "tenderer"].includes(String(role))))
    .map((p) => text(p.name)).filter(Boolean);
}
function classification(item: Json) {
  const c = item.classification ?? {};
  return { code: text(c.id ?? c.identifier), name: text(c.description) };
}
function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function toObservations(release: Json, sourceKind: string, sourceUrl: string): Observation[] {
  const ocid = text(release.ocid ?? release.id);
  const buyerName = partyBuyer(release);
  const tender = release.tender ?? {};
  const releaseDescription = [text(tender.title), text(tender.description), text(release.description)].filter(Boolean).join(" · ");
  const awards = asArray(release.awards);
  const awardList = awards.length ? awards : [{ id: text(release.id) || "release", items: tender.items ?? [], suppliers: [] }];
  const rows: Observation[] = [];

  awardList.forEach((award, awardIndex) => {
    const suppliers = supplierNames(award, release);
    const supplier = suppliers[0] || "Proveedor no identificado";
    const awardValue = award.value ?? {};
    const awardAmount = number(awardValue.amount);
    const awardCurrency = text(awardValue.currency || "CLP") || "CLP";
    const items = asArray(award.items).length ? asArray(award.items) : asArray(tender.items);
    const effectiveItems = items.length ? items : [{ id: "award", description: releaseDescription, quantity: 1 }];

    effectiveItems.forEach((item, itemIndex) => {
      const { code, name } = classification(item);
      const description = [text(item.description), name, releaseDescription].filter(Boolean).join(" · ").slice(0, 4000);
      if (!isCourier(supplier, code, description)) return;
      const quantity = number(item.quantity);
      const unitObj = item.unit ?? {};
      const unitValue = unitObj.value ?? {};
      const unitAmount = number(unitValue.amount);
      const currency = text(unitValue.currency || awardCurrency || "CLP") || "CLP";
      const lineAmount = unitAmount !== null && quantity !== null ? unitAmount * quantity : null;
      const useAwardTotal = lineAmount === null && itemIndex === 0 ? awardAmount : null;
      const processIso = isoDate(award.date ?? release.date ?? release.publishedDate ?? release.contractPeriod?.startDate);
      const processDate = processIso ? processIso.slice(0, 10) : null;
      const itemId = text(item.id) || String(itemIndex);
      const awardId = text(award.id) || String(awardIndex);
      const recordId = `${sourceKind}:${ocid || "unknown"}:${awardId}:${itemId}`;
      rows.push({
        source_record_id: recordId,
        source: "mercado_publico_ocds",
        source_kind: sourceKind,
        source_url: sourceUrl,
        ocid: ocid || null,
        process_id: text(release.id) || null,
        provider_name: supplier,
        provider_group: providerGroup(supplier),
        buyer_name: buyerName || null,
        buyer_region: null,
        category: "courier",
        service_type: serviceType(code, description),
        classification_code: code || null,
        classification_name: name || null,
        description: description || null,
        quantity,
        unit: text(unitObj.name ?? unitObj.scheme) || null,
        unit_price_clp: currency === "CLP" ? unitAmount : null,
        total_amount_clp: currency === "CLP" ? (lineAmount ?? useAwardTotal) : null,
        currency,
        price_basis: unitAmount !== null ? "awarded_unit_price" : useAwardTotal !== null ? "award_total" : "public_award",
        process_date: processDate,
        observed_at: processIso,
        raw: { ocid: ocid || null, awardId, itemId },
      });
    });
  });
  return rows;
}

async function fetchPage(kind: string, year: number, month: number, start: number, end: number) {
  const suffix = kind === "licitacion" ? "listaOCDSAgnoMes" : kind === "trato_directo" ? "listaOCDSAgnoMesTratoDirecto" : "listaOCDSAgnoMesConvenio";
  const sourceUrl = `${BASE}/${suffix}/${year}/${String(month).padStart(2, "0")}/${start}/${end}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(sourceUrl, { cache: "no-store", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Mercado Público OCDS ${kind} respondió ${response.status}`);
    const payload = await response.json();
    return { candidates: releaseCandidates(payload), sourceUrl };
  } finally { clearTimeout(timeout); }
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const body = await request.json().catch(() => ({}));
  const months = Math.max(1, Math.min(6, Number(body?.months || 2)));
  const maxPages = Math.max(1, Math.min(12, Number(body?.maxPages || 6)));
  const pageSize = 1000;
  const now = new Date();
  const collected = new Map<string, Observation>();
  const errors: string[] = [];
  let pagesRead = 0;

  for (let offset = 0; offset < months; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    for (const kind of ["licitacion", "trato_directo", "convenio_marco"]) {
      for (let page = 0; page < maxPages; page += 1) {
        const start = page * pageSize;
        const end = start + pageSize;
        try {
          const { candidates, sourceUrl } = await fetchPage(kind, year, month, start, end);
          pagesRead += 1;
          for (const release of candidates) {
            for (const row of toObservations(release, kind, sourceUrl)) collected.set(String(row.source_record_id), row);
          }
          if (candidates.length < pageSize) break;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `Error ${kind} ${year}-${month}`);
          break;
        }
      }
    }
  }

  const rows = [...collected.values()];
  let ingested = 0;
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const result = await enterpriseRpc<number>(request, "b2b_ingest_public_observations", { p_rows: chunk });
    if (result.response) return result.response;
    ingested += Number(result.data || 0);
  }

  return NextResponse.json({
    ok: true,
    source: "mercado_publico_ocds",
    category: "courier",
    pagesRead,
    matched: rows.length,
    ingested,
    errors: errors.slice(0, 10),
    coverage: { months, maxPages, pageSize },
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
