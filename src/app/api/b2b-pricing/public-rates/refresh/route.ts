import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CHILEXPRESS_URL = "https://des.chilexpress.cl/";
const BLUE_URL = "https://cdn.blue.cl/clientes/1bluex/tarifa-segmento-shopify-api.pdf";
const SERVICE = "Domicilio estándar / express";
const REFERENCE_WEIGHT_KG = 0.5;

type RateRow = {
  source_record_id: string;
  source: string;
  source_kind: string;
  source_url: string;
  category: string;
  provider_name: string;
  provider_group: string;
  buyer_name: null;
  service_type: string;
  origin_label: string;
  destination_label: string;
  weight_kg: number;
  distance_km: number | null;
  shipment_price_clp: number;
  confidence: number;
  normalization_method: string;
  process_date: string;
  metadata: Record<string, unknown>;
};

type City = { destination: string; distanceKm: number; bluePrice: number; blueRegion: string };

const CITIES: Record<string, City> = {
  antofagasta: { destination: "Antofagasta", distanceKm: 1089.8, bluePrice: 6300, blueRegion: "Antofagasta" },
  arica: { destination: "Arica", distanceKm: 1665.0, bluePrice: 7150, blueRegion: "Arica y Parinacota" },
  chillan: { destination: "Chillán", distanceKm: 374.6, bluePrice: 4600, blueRegion: "Ñuble" },
  concepcion: { destination: "Concepción", distanceKm: 432.6, bluePrice: 4700, blueRegion: "Bío-Bío" },
  copiapo: { destination: "Copiapó", distanceKm: 677.1, bluePrice: 4850, blueRegion: "Atacama" },
  iquique: { destination: "Iquique", distanceKm: 1470.7, bluePrice: 6550, blueRegion: "Tarapacá" },
  "la serena": { destination: "La Serena", distanceKm: 398.2, bluePrice: 4600, blueRegion: "Coquimbo" },
  "puerto montt": { destination: "Puerto Montt", distanceKm: 913.9, bluePrice: 5300, blueRegion: "Los Lagos" },
  rancagua: { destination: "Rancagua", distanceKm: 80.5, bluePrice: 4000, blueRegion: "O’Higgins" },
  "santiago centro": { destination: "Santiago Centro", distanceKm: 0, bluePrice: 3100, blueRegion: "Metropolitana de Santiago" },
  talca: { destination: "Talca", distanceKm: 237.8, bluePrice: 4200, blueRegion: "Maule" },
  temuco: { destination: "Temuco", distanceKm: 612.7, bluePrice: 4950, blueRegion: "Araucanía" },
  valdivia: { destination: "Valdivia", distanceKm: 744.1, bluePrice: 5300, blueRegion: "Los Ríos" },
  valparaiso: { destination: "Valparaíso", distanceKm: 98.4, bluePrice: 3900, blueRegion: "Valparaíso" },
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
function money(value: string) {
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function slug(value: string) { return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

function parseChilexpress(html: string) {
  const rows: Array<{ destination: string; standard: number; atrevete: number; consolida: number; impulsa: number }> = [];
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<\/td>\s*<td[^>]*class="level-0-data"[^>]*>\s*\$?([0-9.]+)\s*<\/td>\s*<td[^>]*class="level-1-data"[^>]*>\s*\$?([0-9.]+)\s*<\/td>[\s\S]*?<td[^>]*class="level-2-data"[^>]*>\s*\$?([0-9.]+)\s*<\/td>[\s\S]*?<td[^>]*class="level-3-data"[^>]*>\s*\$?([0-9.]+)\s*<\/td>/g;
  for (const match of html.matchAll(rowRegex)) {
    const standard = money(match[2]); const atrevete = money(match[3]); const consolida = money(match[4]); const impulsa = money(match[5]);
    if (!standard || !atrevete || !consolida || !impulsa) continue;
    rows.push({ destination: match[1].trim(), standard, atrevete, consolida, impulsa });
  }
  return rows;
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const today = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const rateRows: RateRow[] = [];

  try {
    const response = await fetch(CHILEXPRESS_URL, { cache: "no-store", headers: { accept: "text/html" } });
    if (!response.ok) throw new Error(`Chilexpress respondió ${response.status}`);
    const html = await response.text();
    if (!html.includes("Desde 0 - 0.5 kg")) warnings.push("No se pudo validar el perfil activo 0–0,5 kg de Chilexpress.");
    const parsed = parseChilexpress(html);
    for (const item of parsed) {
      const city = CITIES[normalize(item.destination)];
      if (!city) continue;
      rateRows.push({
        source_record_id: `chilexpress-emprendedores-consolida-${today}-0_5-${slug(city.destination)}`,
        source: "chilexpress_emprendedores",
        source_kind: "published_commercial_rate",
        source_url: CHILEXPRESS_URL,
        category: "courier",
        provider_name: "Chilexpress S.A.",
        provider_group: "Chilexpress",
        buyer_name: null,
        service_type: SERVICE,
        origin_label: "Santiago Centro",
        destination_label: city.destination,
        weight_kg: REFERENCE_WEIGHT_KG,
        distance_km: city.distanceKm > 0 ? city.distanceKm : null,
        shipment_price_clp: item.consolida,
        confidence: 92,
        normalization_method: "live_public_rate_band_upper_bound+geodesic_city_centroid",
        process_date: today,
        metadata: { tier: "Consolida", monthlyShipments: ">10", weightRateBand: "0–0.5 kg", distanceMethod: "city_centroid_geodesic", sourceLayer: "published commercial rate", capturedLive: true, standard: item.standard, atrevete: item.atrevete, impulsa: item.impulsa },
      });
    }
    if (!parsed.length) warnings.push("Chilexpress no entregó filas tarifarias parseables.");
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "No se pudo leer Chilexpress.");
  }

  // Blue Express publishes this Ecommerce Masivos matrix in its official tariff PDF.
  // The matrix is versioned here and the official source is checked on each refresh;
  // it is never labeled as a public-procurement award.
  try {
    const sourceCheck = await fetch(BLUE_URL, { method: "HEAD", cache: "no-store" });
    if (!sourceCheck.ok) warnings.push(`Blue Express tariff source respondió ${sourceCheck.status}.`);
  } catch { warnings.push("No se pudo validar el PDF tarifario de Blue Express."); }

  for (const city of Object.values(CITIES)) {
    rateRows.push({
      source_record_id: `blue-ecommerce-masivos-${today}-0_5-${slug(city.destination)}`,
      source: "blue_ecommerce_masivos",
      source_kind: "published_commercial_rate",
      source_url: BLUE_URL,
      category: "courier",
      provider_name: "Blue Express",
      provider_group: "Blue Express",
      buyer_name: null,
      service_type: SERVICE,
      origin_label: "Santiago Centro",
      destination_label: city.destination,
      weight_kg: REFERENCE_WEIGHT_KG,
      distance_km: city.distanceKm > 0 ? city.distanceKm : null,
      shipment_price_clp: city.bluePrice,
      confidence: 88,
      normalization_method: "official_rate_matrix_band_upper_bound+geodesic_city_centroid",
      process_date: today,
      metadata: { segment: "Ecommerce Masivos", delivery: "domicilio", weightRateBand: "0–0.5 kg", blueRegion: city.blueRegion, distanceMethod: "city_centroid_geodesic", sourceLayer: "published commercial rate", matrixVersion: "official-pdf-snapshot" },
    });
  }

  const result = await enterpriseRpc<number>(request, "b2b_upsert_rate_comparables", { p_rows: rateRows });
  if (result.response) return result.response;

  return NextResponse.json({
    ok: true,
    source: "public_commercial_rate_cards",
    rows: rateRows.length,
    ingested: Number(result.data || 0),
    chilexpressRows: rateRows.filter((row) => row.provider_group === "Chilexpress").length,
    blueRows: rateRows.filter((row) => row.provider_group === "Blue Express").length,
    referenceWeightKg: REFERENCE_WEIGHT_KG,
    warnings,
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
