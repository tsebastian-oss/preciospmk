import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v2.ts";

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function clean(value: unknown, max = 220) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function positiveNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const MODEL_NAMES: Record<string, string> = {
  starray: "STARRAY",
  okavango: "OKAVANGO",
  coolraylite: "COOLRAY LITE",
  newcoolray: "NEW COOLRAY",
  citray: "CITYRAY",
  ex5emi: "EX5 EM-I",
  ex5: "EX5",
  ex2: "EX2",
};

function modelFromUrl(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const modelSlug = parts[0] === "m" && parts[1] === "nuevo" ? parts[3] ?? "" : parts[2] ?? "";
  if (MODEL_NAMES[modelSlug]) return MODEL_NAMES[modelSlug];
  const lower = modelSlug.toLowerCase();
  if (MODEL_NAMES[lower]) return MODEL_NAMES[lower];
  return modelSlug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isMarketingCopy(value: string) {
  return /^(ENTREGA|DISPONIBLE|OFERTA|RESERVA|BONO|STOCK|APROVECHA|PROMOCI[OÓ]N|PRECIO ESPECIAL)\b/i.test(value.trim());
}

function normalizeCartoni(products: AutomotiveProduct[], url: string, sourceKey: string) {
  const urlModel = modelFromUrl(url);
  if (!urlModel) return products;
  return products.map((product) => {
    if (!isMarketingCopy(product.model)) return product;
    return {
      ...product,
      external_id: `${sourceKey}:${slug(`${product.brand}-${urlModel}-${product.version}`)}`,
      model: urlModel,
      name: `${product.brand} ${urlModel} · ${product.version}`,
      metadata: {
        ...product.metadata,
        model: urlModel,
        identity_source: "dealer_url_marketing_guard",
      },
    };
  });
}

type DercocenterFlightVehicle = {
  versionId?: number;
  brandSlug?: string;
  modelSlug?: string;
  versionSlug?: string;
  brand?: string;
  model?: string;
  version?: string;
  imageSrc?: string;
  price?: number;
  listPrice?: number;
  financingBonus?: number;
  eventBonus?: number;
  bonusLabel?: string;
  stock?: number;
  fuel?: string;
  transmission?: string;
  categorySlugList?: string[];
  pricesCount?: number;
};

function extractJsonArray(payload: string, key: string): unknown[] | null {
  const marker = `"${key}":[`;
  const markerIndex = payload.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = payload.indexOf("[", markerIndex + marker.length - 1);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < payload.length; index++) {
    const char = payload[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(payload.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function dercocenterFlightVehicles(html: string): DercocenterFlightVehicle[] {
  const found: DercocenterFlightVehicle[] = [];
  const scriptPattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const payload = JSON.parse(match[1]) as string;
      if (!payload.includes('"vehicles":[')) continue;
      const array = extractJsonArray(payload, "vehicles");
      if (!array) continue;
      for (const item of array) {
        if (item && typeof item === "object") found.push(item as DercocenterFlightVehicle);
      }
    } catch {
      // Ignore malformed Next Flight chunks and let the legacy parser fall back.
    }
  }
  return found;
}

function parseDercocenterFlight(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const vehicles = dercocenterFlightVehicles(html);
  const products: AutomotiveProduct[] = [];

  for (const vehicle of vehicles) {
    const brand = clean(vehicle.brand, 100);
    const model = clean(vehicle.model, 180);
    const version = clean(vehicle.version, 220) || "Precio desde";
    const finalPrice = positiveNumber(vehicle.price);
    const listPrice = positiveNumber(vehicle.listPrice) || finalPrice;
    const financeBonus = positiveNumber(vehicle.financingBonus);
    const eventBonus = positiveNumber(vehicle.eventBonus);
    if (!brand || !model || !finalPrice) continue;

    const bonusLabel = clean(vehicle.bonusLabel, 120);
    const brandBonus = /marca/i.test(bonusLabel) ? eventBonus : 0;
    const dealerBonus = brandBonus ? 0 : eventBonus;
    const cashFromFinal = finalPrice + financeBonus;
    const cashPrice = listPrice > 0 ? Math.min(listPrice, cashFromFinal || finalPrice) : cashFromFinal || finalPrice;
    const versionId = positiveNumber(vehicle.versionId);
    const externalId = versionId
      ? `${sourceKey}:version-${versionId}`
      : `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`;

    products.push({
      external_id: externalId,
      source_key: sourceKey,
      brand,
      model,
      version,
      name: `${brand} ${model} · ${version}`,
      body_type: "Vehículo",
      url,
      list_price: listPrice,
      cash_price: cashPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "dealer",
        capture_scope: "pricing_only",
        price_confidence: "next_flight_structured",
        identity_source: "next_flight_version_id",
        version_id: versionId || null,
        brand_slug: clean(vehicle.brandSlug, 120) || null,
        model_slug: clean(vehicle.modelSlug, 140) || null,
        version_slug: clean(vehicle.versionSlug, 160) || null,
        brand_bonus: brandBonus,
        online_bonus: 0,
        dealer_bonus: dealerBonus,
        finance_bonus: financeBonus,
        event_bonus: eventBonus,
        bonus_label: bonusLabel || null,
        fuel: clean(vehicle.fuel, 80) || null,
        transmission: clean(vehicle.transmission, 80) || null,
        stock: Number.isFinite(Number(vehicle.stock)) ? Number(vehicle.stock) : null,
        category_slugs: Array.isArray(vehicle.categorySlugList) ? vehicle.categorySlugList.map((item) => clean(item, 80)).filter(Boolean).slice(0, 12) : [],
        prices_count: Number.isFinite(Number(vehicle.pricesCount)) ? Number(vehicle.pricesCount) : null,
        image_url: clean(vehicle.imageSrc, 800) || null,
      },
    });
  }

  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function portilloEmbeddedDiscovery(html: string, baseUrl: string): QueueItem[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const match of html.matchAll(/\/marcas\/[a-z0-9-]+\/nuevo\/[a-z0-9-]+/gi)) {
    try {
      const candidate = new URL(match[0], base);
      if (!/(^|\.)portillo\.cl$/i.test(candidate.hostname)) continue;
      found.add(candidate.toString());
    } catch {
      // Ignore malformed embedded paths.
    }
  }

  return [...found].slice(0, 400).map((url) => ({
    kind: "automotive_model_page" as const,
    stage: "model",
    url,
    task_key: slug(new URL(url).pathname),
  }));
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  // Dercocenter's filter links are client-side state; their server HTML repeats the same first cards.
  // The full catalog is instead parsed from the structured Next Flight payload on the root page.
  if (parser === "dercocenter") return [];
  if (parser === "portillo" && stage === "root") return portilloEmbeddedDiscovery(html, url);
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  if (parser === "dercocenter") {
    const structured = parseDercocenterFlight(html, url, sourceKey, dealer);
    return structured.length ? structured : null;
  }

  const products = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser === "cartoni" && products) return normalizeCartoni(products, url, sourceKey);
  return products;
}
