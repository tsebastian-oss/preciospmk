import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CHILEXPRESS_URL = "https://des.chilexpress.cl/";
const BLUE_ECOMMERCE_URL = "https://cdn.blue.cl/clientes/1bluex/tarifa-segmento-shopify-api.pdf";
const BLUE_PYME_URL = "https://www.blue.cl/docs/enviar/tarifario-pyme.pdf";
const BLUE_ECOMMERCE_PAGE = "https://www.blue.cl/empresas/soluciones-ecommerce";
const BLUE_CONSUMER_PAGE = "https://www.blue.cl/nosotros/registro-eventos";
const CORREOS_PUBLIC_RESOLUTION_URL = "https://www.correos.cl/documents/51021813/51024715/resolucion-exentaN%C2%B0027.pdf/5c41b3c4-691b-e6c2-3317-23fbbfb9c45b?t=1745868074366";
const CORREOS_ALIADOS_URL = "https://www.correos.cl/home-aliados";
const CORREOS_ALIADOS_PLAN_URL = "https://www.correos.cl/aliados-planes";
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

type City = { destination: string; distanceKm: number; blueRegion: string; bluePymeClass: "same" | "center" | "extreme" };

const CITIES: Record<string, City> = {
  antofagasta: { destination: "Antofagasta", distanceKm: 1089.8, blueRegion: "Antofagasta", bluePymeClass: "extreme" },
  arica: { destination: "Arica", distanceKm: 1665.0, blueRegion: "Arica y Parinacota", bluePymeClass: "extreme" },
  chillan: { destination: "Chillán", distanceKm: 374.6, blueRegion: "Ñuble", bluePymeClass: "center" },
  concepcion: { destination: "Concepción", distanceKm: 432.6, blueRegion: "Bío-Bío", bluePymeClass: "center" },
  copiapo: { destination: "Copiapó", distanceKm: 677.1, blueRegion: "Atacama", bluePymeClass: "center" },
  iquique: { destination: "Iquique", distanceKm: 1470.7, blueRegion: "Tarapacá", bluePymeClass: "extreme" },
  "la serena": { destination: "La Serena", distanceKm: 398.2, blueRegion: "Coquimbo", bluePymeClass: "center" },
  "puerto montt": { destination: "Puerto Montt", distanceKm: 913.9, blueRegion: "Los Lagos", bluePymeClass: "center" },
  rancagua: { destination: "Rancagua", distanceKm: 80.5, blueRegion: "O’Higgins", bluePymeClass: "center" },
  "santiago centro": { destination: "Santiago Centro", distanceKm: 0, blueRegion: "Metropolitana de Santiago", bluePymeClass: "same" },
  talca: { destination: "Talca", distanceKm: 237.8, blueRegion: "Maule", bluePymeClass: "center" },
  temuco: { destination: "Temuco", distanceKm: 612.7, blueRegion: "Araucanía", bluePymeClass: "center" },
  valdivia: { destination: "Valdivia", distanceKm: 744.1, blueRegion: "Los Ríos", bluePymeClass: "center" },
  valparaiso: { destination: "Valparaíso", distanceKm: 98.4, blueRegion: "Valparaíso", bluePymeClass: "center" },
};

const BLUE_PYME_SIZES = [
  { size: "XS", weightKg: 0.5, home: { same: 3100, center: 4300, extreme: 5200 }, point: { same: 2600, center: 3800, extreme: 4700 } },
  { size: "S", weightKg: 3, home: { same: 4200, center: 5600, extreme: 9500 }, point: { same: 3700, center: 5100, extreme: 9000 } },
  { size: "M", weightKg: 6, home: { same: 4800, center: 7300, extreme: 14500 }, point: { same: 4300, center: 6800, extreme: 14000 } },
  { size: "L", weightKg: 20, home: { same: 5400, center: 9200, extreme: 17000 }, point: { same: 4900, center: 8700, extreme: 16500 } },
] as const;

const BLUE_ECOMMERCE_WEIGHTS = [
  { size: "XS", weightKg: 0.5, band: "0–0,5 kg" },
  { size: "S", weightKg: 3, band: "0,5–3 kg" },
  { size: "M", weightKg: 6, band: "3–6 kg" },
  { size: "L", weightKg: 16, band: "6–16 kg" },
  { size: "XL", weightKg: 25, band: "16–25 kg" },
] as const;

const BLUE_ECOMMERCE_RATES: Record<string, { home: number[]; point: number[] }> = {
  "Arica y Parinacota": { home: [7150, 8300, 12400, 17000, 25000], point: [6350, 7500, 11600, 16200, 24200] },
  "Tarapacá": { home: [6550, 7400, 10700, 15500, 23000], point: [5750, 6600, 9900, 14700, 22200] },
  "Antofagasta": { home: [6300, 7000, 9900, 14000, 21000], point: [5500, 6200, 9100, 13200, 20200] },
  "Atacama": { home: [4850, 5900, 7700, 9900, 13800], point: [4050, 5100, 6900, 9100, 13000] },
  "Coquimbo": { home: [4600, 5300, 7000, 9600, 12800], point: [3800, 4500, 6200, 8800, 12000] },
  "Valparaíso": { home: [3900, 4500, 6000, 7700, 9700], point: [3100, 3700, 5200, 6900, 8900] },
  "Metropolitana de Santiago": { home: [3100, 3650, 4700, 5700, 7600], point: [2300, 2850, 3900, 4900, 6800] },
  "O’Higgins": { home: [4000, 4800, 6400, 8300, 11300], point: [3200, 4000, 5600, 7500, 10500] },
  "Maule": { home: [4200, 5200, 6700, 8900, 12100], point: [3400, 4400, 5900, 8100, 11300] },
  "Ñuble": { home: [4600, 5400, 7200, 9200, 12600], point: [3800, 4600, 6400, 8400, 11800] },
  "Bío-Bío": { home: [4700, 5700, 7300, 9500, 12800], point: [3900, 4900, 6500, 8700, 12000] },
  "Araucanía": { home: [4950, 5900, 7700, 9900, 13800], point: [4150, 5100, 6900, 9100, 13000] },
  "Los Ríos": { home: [5300, 6100, 8300, 10000, 14200], point: [4500, 5300, 7500, 9200, 13400] },
  "Los Lagos": { home: [5300, 6100, 8300, 10000, 14200], point: [4500, 5300, 7500, 9200, 13400] },
};
const CORREOS_EXPRESS_AM = [
  { zone: "INTRA", weightKg: 0.5, weightBand: "0–0,5 kg", priceClp: 4500 },
  { zone: "INTRA", weightKg: 3, weightBand: "1,51–3 kg", priceClp: 6000 },
  { zone: "INTRA", weightKg: 6, weightBand: "3,1–6 kg", priceClp: 7200 },
  { zone: "CERCA", weightKg: 0.5, weightBand: "0–0,5 kg", priceClp: 6000 },
  { zone: "CERCA", weightKg: 3, weightBand: "1,51–3 kg", priceClp: 7500 },
  { zone: "CERCA", weightKg: 6, weightBand: "3,1–6 kg", priceClp: 11000 },
  { zone: "LEJOS", weightKg: 0.5, weightBand: "0–0,5 kg", priceClp: 18800 },
  { zone: "LEJOS", weightKg: 3, weightBand: "1,51–3 kg", priceClp: 28500 },
  { zone: "LEJOS", weightKg: 6, weightBand: "3,1–6 kg", priceClp: 42000 },
] as const;

const CORREOS_ALIADOS_TIERS = [
  { name: "Bronce", discountPct: 10, volume: "Nuevo emprendedor" },
  { name: "Crecimiento", discountPct: 15, volume: "20–49 envíos/mes" },
  { name: "Consolidado", discountPct: 20, volume: "50–99 envíos/mes" },
  { name: "Gran volumen", discountPct: 25, volume: "100+ envíos/mes" },
] as const;


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

  // Blue Express: keep consumer/Pyme and ecommerce entrepreneur channels separate.
  // Exact price matrices are versioned from official Blue Express tariff PDFs and their
  // official pages are checked on each refresh. >500 monthly shipments are private quote,
  // so no numeric rate is synthesized for that segment.
  for (const [label, url] of [["Pyme", BLUE_PYME_URL], ["Ecommerce", BLUE_ECOMMERCE_URL]] as const) {
    try {
      const sourceCheck = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!sourceCheck.ok) warnings.push(`Blue Express ${label} tariff source respondió ${sourceCheck.status}.`);
    } catch {
      warnings.push(`No se pudo validar el tarifario oficial Blue Express ${label}.`);
    }
  }

  // B2C / Pyme: personas, ventas por RRSS y tiendas físicas, sin mínimo de envíos.
  for (const city of Object.values(CITIES)) {
    for (const size of BLUE_PYME_SIZES) {
      for (const delivery of ["home", "point"] as const) {
        const shipmentPrice = size[delivery][city.bluePymeClass];
        const deliveryType = delivery === "home" ? "DOMICILIO" : "PUNTO BLUE";
        const serviceType = delivery === "home" ? "Domicilio estándar / express" : "Punto Blue Express / Copec";
        rateRows.push({
          source_record_id: `blue-pyme-${today}-${delivery}-${size.size.toLowerCase()}-${slug(city.destination)}`,
          source: "blue_pyme_public",
          source_kind: "published_commercial_rate",
          source_url: BLUE_PYME_URL,
          category: "courier",
          provider_name: "Blue Express",
          provider_group: "Blue Express B2C / Público",
          buyer_name: null,
          service_type: serviceType,
          origin_label: "Santiago Centro",
          destination_label: city.destination,
          weight_kg: size.weightKg,
          distance_km: city.distanceKm > 0 ? city.distanceKm : null,
          shipment_price_clp: shipmentPrice,
          confidence: 97,
          normalization_method: "official_pyme_zone_matrix_band_upper_bound+geodesic_city_centroid",
          process_date: today,
          metadata: {
            segment: "B2C / Público",
            targetCustomer: "Persona, emprendedor RRSS o tienda física",
            monthlyShipments: "Sin mínimo",
            delivery: deliveryType,
            size: size.size,
            weightRateBand: size.size === "XS" ? "0–0,5 kg" : size.size === "S" ? "0,5–3 kg" : size.size === "M" ? "3–6 kg" : "6–20 kg",
            routeClass: city.bluePymeClass,
            blueRegion: city.blueRegion,
            sourceLayer: "published commercial rate",
            consumerPage: BLUE_CONSUMER_PAGE,
            matrixVersion: "official-pyme-pdf-snapshot",
            ivaIncluded: true,
          },
        });
      }
    }
  }

  // Entrepreneur ecommerce channel: official Ecommerce Masivos tariff, aligned with
  // Blue's published 1–500 shipments/month self-service ecommerce proposition.
  for (const city of Object.values(CITIES)) {
    const matrix = BLUE_ECOMMERCE_RATES[city.blueRegion];
    if (!matrix) {
      warnings.push(`Sin matriz Ecommerce Blue Express para ${city.blueRegion}.`);
      continue;
    }
    BLUE_ECOMMERCE_WEIGHTS.forEach((weight, index) => {
      for (const delivery of ["home", "point"] as const) {
        const shipmentPrice = matrix[delivery][index];
        const deliveryType = delivery === "home" ? "DOMICILIO" : "PUNTO BLUE";
        const serviceType = delivery === "home" ? "Domicilio estándar / express" : "Punto Blue Express / Copec";
        rateRows.push({
          source_record_id: `blue-ecommerce-1-500-${today}-${delivery}-${weight.size.toLowerCase()}-${slug(city.destination)}`,
          source: "blue_ecommerce_1_500",
          source_kind: "published_commercial_rate",
          source_url: BLUE_ECOMMERCE_URL,
          category: "courier",
          provider_name: "Blue Express",
          provider_group: "Blue Express Ecommerce 1–500",
          buyer_name: null,
          service_type: serviceType,
          origin_label: "Santiago Centro",
          destination_label: city.destination,
          weight_kg: weight.weightKg,
          distance_km: city.distanceKm > 0 ? city.distanceKm : null,
          shipment_price_clp: shipmentPrice,
          confidence: 98,
          normalization_method: "official_ecommerce_region_matrix_band_upper_bound+geodesic_city_centroid",
          process_date: today,
          metadata: {
            segment: "Ecommerce 1–500 envíos/mes",
            targetCustomer: "Emprendedor / ecommerce integrado",
            monthlyShipments: "1–500",
            delivery: deliveryType,
            size: weight.size,
            weightRateBand: weight.band,
            blueRegion: city.blueRegion,
            sourceLayer: "published commercial rate",
            ecommercePage: BLUE_ECOMMERCE_PAGE,
            matrixVersion: "official-ecommerce-masivos-pdf-snapshot",
            ivaIncluded: true,
          },
        });
      }
    });
  }



  // CorreosChile public B2C: official 2025 resolution for Paquete Domicilio Express AM.
  // The source publishes tariff zones (INTRA/CERCA/LEJOS), not a city-by-city mapping,
  // so we preserve those zone labels instead of inventing route assignments.
  for (const rate of CORREOS_EXPRESS_AM) {
    rateRows.push({
      source_record_id: `correos-b2c-express-am-${today}-${rate.zone.toLowerCase()}-${String(rate.weightKg).replace(".","_")}`,
      source: "correos_persona_express_am",
      source_kind: "published_commercial_rate",
      source_url: CORREOS_PUBLIC_RESOLUTION_URL,
      category: "courier",
      provider_name: "Empresa de Correos de Chile",
      provider_group: "CorreosChile B2C / Público",
      buyer_name: null,
      service_type: "Paquete Domicilio Express AM",
      origin_label: "Zona tarifaria CorreosChile",
      destination_label: `Zona ${rate.zone}`,
      weight_kg: rate.weightKg,
      distance_km: null,
      shipment_price_clp: rate.priceClp,
      confidence: 100,
      normalization_method: "official_resolution_tariff_zone_exact",
      process_date: today,
      metadata: {
        segment: "B2C / Público",
        tariffZone: rate.zone,
        weightRateBand: rate.weightBand,
        ivaIncluded: false,
        taxTreatment: "Exenta de IVA",
        sourceLayer: "published commercial rate",
        resolutionDate: "2025-04-25",
        comparabilityNote: "Zona tarifaria oficial; no se transforma a ciudad/ruta sin evidencia oficial.",
      },
    });

    for (const tier of CORREOS_ALIADOS_TIERS) {
      const discounted = Math.round(rate.priceClp * (1 - tier.discountPct / 100));
      rateRows.push({
        source_record_id: `correos-aliados-${tier.discountPct}-${today}-${rate.zone.toLowerCase()}-${String(rate.weightKg).replace(".","_")}`,
        source: "correos_aliados",
        source_kind: "published_commercial_rate",
        source_url: CORREOS_ALIADOS_URL,
        category: "courier",
        provider_name: "Empresa de Correos de Chile",
        provider_group: `CorreosChile Aliados ${tier.name} ${tier.discountPct}%`,
        buyer_name: null,
        service_type: "Paquete Domicilio Express AM",
        origin_label: "Zona tarifaria CorreosChile",
        destination_label: `Zona ${rate.zone}`,
        weight_kg: rate.weightKg,
        distance_km: null,
        shipment_price_clp: discounted,
        confidence: 95,
        normalization_method: "official_resolution_base+published_aliados_discount",
        process_date: today,
        metadata: {
          segment: "Pyme / Emprendedores",
          tariffZone: rate.zone,
          weightRateBand: rate.weightBand,
          basePriceClp: rate.priceClp,
          discountPct: tier.discountPct,
          monthlyShipments: tier.volume,
          aliadosPlanUrl: CORREOS_ALIADOS_PLAN_URL,
          ivaIncluded: false,
          taxTreatment: "Exenta de IVA",
          sourceLayer: "published commercial rate",
          comparabilityNote: "Precio derivado aplicando descuento Aliados publicado sobre tarifa base oficial; no se mapea a ciudad/ruta sin evidencia oficial.",
        },
      });
    }
  }

  const result = await enterpriseRpc<number>(request, "b2b_upsert_rate_comparables", { p_rows: rateRows });
  if (result.response) return result.response;

  return NextResponse.json({
    ok: true,
    source: "public_commercial_rate_cards",
    rows: rateRows.length,
    ingested: Number(result.data || 0),
    chilexpressRows: rateRows.filter((row) => row.provider_group === "Chilexpress").length,
    blueB2CRows: rateRows.filter((row) => row.provider_group === "Blue Express B2C / Público").length,
    blueEntrepreneurRows: rateRows.filter((row) => row.provider_group === "Blue Express Ecommerce 1–500").length,
    correosB2CRows: rateRows.filter((row) => row.provider_group === "CorreosChile B2C / Público").length,
    correosAliadosRows: rateRows.filter((row) => row.provider_group.startsWith("CorreosChile Aliados ")).length,
    referenceWeightKg: REFERENCE_WEIGHT_KG,
    warnings,
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
