import type { AutomotiveProduct } from "./parsers.ts";

type FlightRecords = Map<string, unknown>;
type JsonObject = Record<string, unknown>;

function clean(value: unknown, max = 260) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleCase(value: string) {
  return value.toLocaleLowerCase("es").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toLocaleUpperCase("es") + part.slice(1)).join(" ");
}

function canonicalBrand(rawBrand: string) {
  const key = slug(rawBrand);
  const aliases: Record<string, string> = { mg: "MG", ram: "RAM", citroen: "Citroën" };
  return aliases[key] ?? titleCase(rawBrand);
}

function canonicalModel(rawModel: string, brand: string) {
  if (brand === "MG") return rawModel.toLocaleUpperCase("es");
  return titleCase(rawModel);
}

function positiveNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function minPositive(values: unknown[]) {
  const candidates = values.map(positiveNumber).filter((value) => value > 0);
  return candidates.length ? Math.min(...candidates) : 0;
}

function maxPositive(values: unknown[]) {
  const candidates = values.map(positiveNumber).filter((value) => value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function flightRecords(html: string): FlightRecords {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    try {
      const decoded = JSON.parse(match[1]);
      if (typeof decoded === "string") chunks.push(decoded);
    } catch {
      // Ignore malformed chunks and fall back to the legacy page parser.
    }
  }

  const records: FlightRecords = new Map();
  for (const line of chunks.join("").split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const id = line.slice(0, separator).trim();
    if (!/^[0-9a-f]+$/i.test(id)) continue;
    const raw = line.slice(separator + 1).trim();
    if (!raw || !/[\[{"0-9tfn-]/.test(raw.charAt(0))) continue;
    try {
      records.set(id.toLowerCase(), JSON.parse(raw));
    } catch {
      // React Flight also contains module/control records that are not JSON values.
    }
  }
  return records;
}

function dereference(value: unknown, records: FlightRecords): unknown {
  if (typeof value !== "string") return value;
  const match = /^\$([0-9a-f]+)$/i.exec(value);
  if (!match) return value;
  return records.get(match[1].toLowerCase());
}

function resolveObject(value: unknown, records: FlightRecords) {
  return object(dereference(value, records));
}

function resolveArray(value: unknown, records: FlightRecords) {
  const resolved = dereference(value, records);
  if (!Array.isArray(resolved)) return [] as unknown[];
  return resolved.map((item) => dereference(item, records));
}

function pageIdentity(url: string) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[0] !== "marcas" || parts[2] !== "nuevo" || !parts[1] || !parts[3]) return null;
    const brandSlug = parts[1].toLowerCase();
    const vehicleSlug = parts[3].toLowerCase();
    return {
      brandSlug,
      modelSlug: vehicleSlug.startsWith(`${brandSlug}-`) ? vehicleSlug.slice(brandSlug.length + 1) : vehicleSlug,
    };
  } catch {
    return null;
  }
}

function modelMatches(expected: string, actual: string) {
  if (!expected || !actual) return true;
  if (expected === actual) return true;
  // Some Portillo URLs contain commercial prefixes/suffixes (e.g. all-new, model codes)
  // while the catalog model record keeps the canonical shorter slug.
  return expected.includes(actual) || actual.includes(expected);
}

function featureMap(value: unknown, records: FlightRecords) {
  const result: Record<string, string> = {};
  for (const item of resolveArray(value, records)) {
    const row = object(item);
    if (!row) continue;
    const name = clean(row.name, 80).toLowerCase();
    const label = clean(row.label, 140);
    if (name && label) result[name] = label;
  }
  return result;
}

function pricingRows(value: unknown, records: FlightRecords) {
  return resolveArray(value, records).map(object).filter((row): row is JsonObject => Boolean(row));
}

export function parsePortilloFlightVersions(
  html: string,
  url: string,
  sourceKey: string,
  dealer: string,
  legacyProducts: AutomotiveProduct[],
): AutomotiveProduct[] {
  const records = flightRecords(html);
  if (!records.size) return [];

  const identity = pageIdentity(url);
  const fallback = legacyProducts[0];
  const products = new Map<string, AutomotiveProduct>();

  for (const value of records.values()) {
    const vehicle = object(value);
    if (!vehicle) continue;

    const vehicleId = positiveNumber(vehicle.id);
    const detailModel = clean(vehicle.detailModel, 260);
    const directListPrice = positiveNumber(vehicle.listPrice);
    if (!vehicleId || !detailModel || !directListPrice || !vehicle.prices) continue;

    const brandRecord = resolveObject(vehicle.carBrandType, records);
    const modelRecord = resolveObject(vehicle.carModelType, records);
    const rawBrand = clean(brandRecord?.value, 120) || fallback?.brand || "";
    const rawModel = clean(modelRecord?.value, 180) || clean(vehicle.model, 180) || fallback?.model || "";
    if (!rawBrand || !rawModel) continue;

    const actualBrandSlug = clean(brandRecord?.slug, 120).toLowerCase() || slug(rawBrand);
    const actualModelSlug = clean(modelRecord?.slug, 160).toLowerCase() || slug(rawModel);
    if (identity?.brandSlug && actualBrandSlug && identity.brandSlug !== actualBrandSlug) continue;
    if (identity?.modelSlug && actualModelSlug && !modelMatches(identity.modelSlug, actualModelSlug)) continue;

    const brand = canonicalBrand(rawBrand);
    const model = canonicalModel(rawModel, brand);

    const prices = pricingRows(vehicle.prices, records).filter((row) => !row.currency || clean(row.currency, 20).toUpperCase() === "CLP");
    if (!prices.length) continue;

    const listPrice = maxPositive([directListPrice, ...prices.map((row) => row.listPrice)]) || directListPrice;
    const cashPrice = minPositive(prices.map((row) => row.priceSP)) || listPrice;
    const conventionalCreditPrice = minPositive(prices.map((row) => row.priceCC));
    const smartCreditPrice = minPositive(prices.map((row) => row.priceSC));
    const otherPrice = minPositive(prices.map((row) => row.priceOP));
    const finalPrice = minPositive([cashPrice, conventionalCreditPrice, smartCreditPrice, otherPrice, listPrice]) || listPrice;

    const brandBonus = maxPositive(prices.map((row) => row.brandBonusSP));
    const dealerBonus = maxPositive(prices.flatMap((row) => [row.dealerBonusCC, row.dealerBonusSC, row.dealerBonusSP]));
    const financeBonus = maxPositive(prices.flatMap((row) => [row.financingBonusCC, row.financingBonusSC]));
    const financingBrandBonusCC = maxPositive(prices.map((row) => row.financingBrandBonusCC));
    const financingBrandBonusSC = maxPositive(prices.map((row) => row.financingBrandBonusSC));
    const features = featureMap(vehicle.features, records);
    const externalId = `${sourceKey}:version-${vehicleId}`;

    if (products.has(externalId)) continue;
    products.set(externalId, {
      external_id: externalId,
      source_key: sourceKey,
      brand,
      model,
      version: detailModel,
      name: `${brand} ${model} · ${detailModel}`,
      body_type: features.category || fallback?.body_type || "Vehículo",
      url,
      image_url: clean(vehicle.mainImage, 800) || fallback?.image_url,
      list_price: listPrice,
      cash_price: cashPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "dealer",
        capture_scope: "version_pricing",
        price_confidence: "next_flight_version_structured",
        identity_source: "portillo_version_id",
        version_id: vehicleId,
        quiter_id: clean(vehicle.quiterId, 120) || null,
        cit: clean(vehicle.cit, 120) || null,
        brand_slug: actualBrandSlug || null,
        model_slug: actualModelSlug || null,
        list_price: listPrice,
        cash_price: cashPrice,
        final_price: finalPrice,
        brand_bonus: brandBonus,
        dealer_bonus: dealerBonus,
        finance_bonus: financeBonus,
        conventional_credit_price: conventionalCreditPrice || null,
        smart_credit_price: smartCreditPrice || null,
        other_payment_price: cashPrice || null,
        price_op: otherPrice || null,
        financing_brand_bonus_cc: financingBrandBonusCC || null,
        financing_brand_bonus_sc: financingBrandBonusSC || null,
        year: features.year || null,
        fuel: features.fuel || null,
        transmission: features.transmission || null,
        traction: features.traction || null,
        category: features.category || null,
        has_stock: typeof vehicle.hasStock === "boolean" ? vehicle.hasStock : null,
        apply_vat: typeof vehicle.applyVat === "boolean" ? vehicle.applyVat : null,
        price_scenarios: {
          other_payment: cashPrice || null,
          conventional_credit: conventionalCreditPrice || null,
          smart_credit: smartCreditPrice || null,
          other: otherPrice || null,
        },
      },
    });
  }

  return [...products.values()];
}
