import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers.ts";

function clean(value: unknown, max = 220) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function text(html: string) {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button|option|strong)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function rows(html: string) {
  return text(html).split("\n").map((line) => clean(line, 500)).filter(Boolean);
}

function price(value: string | null | undefined) {
  if (!value || !value.includes("$")) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 1_000_000 ? parsed : null;
}

function embeddedPrice(value: string | null | undefined) {
  if (!value) return null;
  const matches = [...value.matchAll(/(?:\$|CLP\s*)?\s*(\d{1,3}(?:[.\s]\d{3}){2,3})\b/gi)];
  for (const match of matches.reverse()) {
    const parsed = Number((match[1] ?? "").replace(/[^0-9]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 1_000_000) return parsed;
  }
  return null;
}

function stripEmbeddedPrice(value: string) {
  return clean(value
    .replace(/(?:US\s*)?(?:\$|CLP\s*)?\s*\d{1,3}(?:[.\s]\d{3}){2,3}\s*$/i, "")
    .replace(/^[*•·\-]+\s*/, ""), 240);
}

const BRAND_NAMES: Record<string, string> = {
  toyota: "Toyota",
  geely: "Geely",
  mg: "MG",
  audi: "Audi",
  cupra: "Cupra",
  seat: "Seat",
  skoda: "Skoda",
  volkswagen: "Volkswagen",
  "ssang-yong": "KGM",
  byd: "BYD",
  jmc: "JMC",
  jeep: "Jeep",
};

const MODEL_NAMES: Record<string, string> = {
  coolraylite: "COOLRAY LITE",
  newcoolray: "NEW COOLRAY",
  citray: "CITYRAY",
  starray: "STARRAY",
  okavango: "OKAVANGO",
  ex5emi: "EX5 EM-I",
  ex5: "EX5",
  ex2: "EX2",
  raize: "RAIZE",
  yarissedan: "YARIS SEDAN",
  yarissedanhv: "YARIS SEDAN HYBRID",
  yariscrosshv: "YARIS CROSS HYBRID",
  corollasedanhv: "COROLLA SEDAN HYBRID",
  corollacrosshv: "COROLLA CROSS HYBRID",
  allnewrav4hv: "ALL NEW RAV4 HYBRID",
  "All-new-rav4": "ALL NEW RAV4",
  allnewrav4phev: "ALL NEW RAV4 PHEV",
  landcruiserprado: "LAND CRUISER PRADO",
  hiluxgrs: "HILUX GR-S",
  fortunergrs: "FORTUNER GR-S",
  yarisgr: "YARIS GR",
  newmg3: "NEW MG3",
  newmgzs: "NEW MG ZS",
  newmg5: "NEW MG5",
  mgone: "MG ONE",
  mg4urbanev: "MG4 URBAN EV",
  mgs5ev: "MGS5 EV",
  a3sportback: "A3 SPORTBACK",
  newq3: "NEW Q3",
  newq3sportback: "NEW Q3 SPORTBACK",
  newq5: "NEW Q5",
  newq5sportback: "NEW Q5 SPORTBACK",
  q4etronsportback: "Q4 E-TRON SPORTBACK",
  q6etron: "Q6 E-TRON",
  a6etron: "A6 E-TRON",
};

function humanizeModel(value: string) {
  if (MODEL_NAMES[value]) return MODEL_NAMES[value];
  const lower = value.toLowerCase();
  if (MODEL_NAMES[lower]) return MODEL_NAMES[lower];
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\bnew\b/gi, "NEW")
    .replace(/\bhv\b/gi, "HYBRID")
    .replace(/\bphev\b/gi, "PHEV")
    .replace(/\bev\b/gi, "EV")
    .replace(/\bgrs\b/gi, "GR-S")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pathIdentity(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts[0] === "m" && parts[1] === "nuevo") {
    return { brandSlug: parts[2] ?? "", modelSlug: parts[3] ?? "" };
  }
  return { brandSlug: parts[1] ?? "", modelSlug: parts[2] ?? "" };
}

function cartoniBrandListingIdentity(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (parts[0] === "m" && parts[1] === "nuevos" && parts[2] && parts.length === 3) return parts[2];
  if (parts[0] === "nuevos" && parts[1] && parts.length === 2) return parts[1];
  return "";
}

function pageModel(list: string[], modelSlug: string) {
  const versionsIndex = list.findIndex((line) => /^VERSIONES$/i.test(line));
  if (versionsIndex >= 0) {
    for (let index = versionsIndex + 1; index < Math.min(list.length, versionsIndex + 6); index++) {
      const candidate = list[index];
      if (!candidate || price(candidate) || /^(Motor|Combustible|Transmisi[oó]n|Tracci[oó]n|Precio)/i.test(candidate)) continue;
      if (/^(4X2|4X4|Autom[aá]tica|Mec[aá]nica|Gasolina|Di[eé]sel|El[eé]ctrico|H[ií]brido)$/i.test(candidate)) continue;
      return clean(candidate, 180);
    }
  }
  return humanizeModel(modelSlug);
}

function versionBeforeSummaryPrice(list: string[], listPriceIndex: number, model: string) {
  for (let cursor = listPriceIndex - 1; cursor >= Math.max(0, listPriceIndex - 24); cursor--) {
    if (!price(list[cursor]) && !embeddedPrice(list[cursor])) continue;
    for (let versionIndex = cursor - 1; versionIndex >= Math.max(0, cursor - 4); versionIndex--) {
      const candidate = clean(list[versionIndex], 220);
      if (!candidate || candidate.localeCompare(model, "es", { sensitivity: "base" }) === 0) continue;
      if (/^(VERSIONES|Motor|Combustible|Transmisi[oó]n|Tracci[oó]n|Precio|Precio desde|COTIZAR|AHORA)$/i.test(candidate)) continue;
      if (/^(4X2|4X4|Autom[aá]tica|Mec[aá]nica|Gasolina|Di[eé]sel|El[eé]ctrico|H[ií]brido)$/i.test(candidate)) continue;
      if (price(candidate)) continue;
      const normalized = stripEmbeddedPrice(candidate).replace(/\s+i$/i, "").trim();
      if (normalized) return normalized;
    }
    break;
  }

  for (let cursor = listPriceIndex - 1; cursor >= Math.max(0, listPriceIndex - 16); cursor--) {
    const candidate = clean(list[cursor], 220);
    if (!candidate || candidate.localeCompare(model, "es", { sensitivity: "base" }) === 0) continue;
    if (/^(VERSIONES|Motor|Combustible|Transmisi[oó]n|Tracci[oó]n|Precio|Precio desde|COTIZAR|AHORA|Bono)/i.test(candidate)) continue;
    if (price(candidate) || embeddedPrice(candidate)) continue;
    const normalized = candidate.replace(/\s+i$/i, "").trim();
    if (normalized) return normalized;
  }
  return "Precio desde";
}

function makeProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, listPrice: number, dealerBonus: number, financeBonus: number, finalPrice: number): AutomotiveProduct {
  const cashPrice = Math.max(finalPrice, finalPrice + financeBonus);
  return {
    external_id: `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`,
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
      identity_source: "dealer_url_and_versions_table",
      price_confidence: "explicit_detail",
      brand_bonus: 0,
      online_bonus: 0,
      dealer_bonus: dealerBonus,
      finance_bonus: financeBonus,
    },
  };
}

function makeListingFallbackProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, finalPrice: number): AutomotiveProduct {
  const product = makeProduct(sourceKey, dealer, brand, model, version, url, finalPrice, 0, 0, finalPrice);
  return {
    ...product,
    metadata: {
      ...product.metadata,
      capture_scope: "version_listing_fallback",
      identity_source: "cartoni_brand_listing",
      price_confidence: "brand_listing_final_price",
      list_price_unknown: true,
    },
  };
}

function preserveDistinctSameLabelOffers(products: AutomotiveProduct[]) {
  const seen = new Map<string, AutomotiveProduct[]>();
  const output: AutomotiveProduct[] = [];

  for (const product of products) {
    const baseId = product.external_id;
    const prior = seen.get(baseId) ?? [];
    const exactDuplicate = prior.some((item) =>
      item.version === product.version
      && item.list_price === product.list_price
      && item.cash_price === product.cash_price
      && item.final_price === product.final_price
    );
    if (exactDuplicate) continue;

    const offerIndex = prior.length + 1;
    const next = offerIndex === 1 ? product : {
      ...product,
      external_id: `${baseId}-offer-${offerIndex}`,
      metadata: {
        ...product.metadata,
        identity_source: "cartoni_same_label_offer_order",
        same_label_offer: true,
        offer_index: offerIndex,
      },
    };
    prior.push(next);
    seen.set(baseId, prior);
    output.push(next);
  }
  return output;
}

function listingModelBeforeVer(list: string[], verIndex: number) {
  let includeIndex = -1;
  for (let cursor = verIndex - 1; cursor >= Math.max(0, verIndex - 18); cursor--) {
    if (/^INCLUYE$/i.test(list[cursor])) {
      includeIndex = cursor;
      break;
    }
  }
  if (includeIndex < 0) return "";
  for (let cursor = includeIndex - 1; cursor >= Math.max(0, includeIndex - 5); cursor--) {
    const candidate = stripEmbeddedPrice(list[cursor]);
    if (!candidate || /^(Todos|Automoviles|SUVs|Camionetas|El[eé]ctricos|H[ií]bridos|Gazoo Racing)$/i.test(candidate)) continue;
    return candidate;
  }
  return "";
}

function parseCartoniBrandListing(html: string, url: string, sourceKey: string, dealer: string, brandSlug: string) {
  const list = rows(html);
  const brand = BRAND_NAMES[brandSlug.toLowerCase()] ?? humanizeModel(brandSlug);
  const verIndexes = list.map((line, index) => /^VER\s*\+$/i.test(line) ? index : -1).filter((index) => index >= 0);
  const products: AutomotiveProduct[] = [];

  for (const verIndex of verIndexes) {
    const model = listingModelBeforeVer(list, verIndex);
    if (!model) continue;
    let nextInclude = list.length;
    for (let cursor = verIndex + 1; cursor < Math.min(list.length, verIndex + 50); cursor++) {
      if (/^INCLUYE$/i.test(list[cursor])) {
        nextInclude = cursor;
        break;
      }
      if (/^(Los precios de venta|FORMULARIO|CALLBACK|CONTACTO)$/i.test(list[cursor])) {
        nextInclude = cursor;
        break;
      }
    }
    const end = Math.max(verIndex + 1, nextInclude - 1);

    for (let cursor = verIndex + 1; cursor < end; cursor++) {
      const current = clean(list[cursor], 320);
      if (!current || /^VER\s*\+$/i.test(current)) continue;
      const currentPrice = embeddedPrice(current);
      const nextLinePrice = !currentPrice && cursor + 1 < end ? embeddedPrice(list[cursor + 1]) : null;
      const finalPrice = currentPrice ?? nextLinePrice;
      if (!finalPrice) continue;

      const version = currentPrice ? stripEmbeddedPrice(current) : stripEmbeddedPrice(current);
      if (!version || version.localeCompare(model, "es", { sensitivity: "base" }) === 0) continue;
      if (/^(BONO|INCLUYE|Precio|Ahora|Desde|Cotizar|Reservar)/i.test(version)) continue;

      products.push(makeListingFallbackProduct(sourceKey, dealer, brand, clean(model, 180), clean(version, 240), url, finalPrice));
      if (!currentPrice && nextLinePrice) cursor += 1;
    }
  }

  return preserveDistinctSameLabelOffers(products);
}

function parseCartoniV2(html: string, url: string, sourceKey: string, dealer: string) {
  const brandListingSlug = cartoniBrandListingIdentity(url);
  if (brandListingSlug) return parseCartoniBrandListing(html, url, sourceKey, dealer, brandListingSlug);

  const list = rows(html);
  const { brandSlug, modelSlug } = pathIdentity(url);
  const brand = BRAND_NAMES[brandSlug.toLowerCase()] ?? brandSlug.toUpperCase();
  const model = pageModel(list, modelSlug);
  const products: AutomotiveProduct[] = [];
  const listPriceIndexes = list
    .map((line, index) => /^Precio(?: de)? lista/i.test(line) ? index : -1)
    .filter((index) => index >= 0);

  for (let position = 0; position < listPriceIndexes.length; position++) {
    const index = listPriceIndexes[position];
    const listPrice = price(list[index]) ?? embeddedPrice(list[index]) ?? price(list[index + 1]) ?? embeddedPrice(list[index + 1]);
    if (!listPrice) continue;

    const version = versionBeforeSummaryPrice(list, index, model);
    const nextPriceIndex = position + 1 < listPriceIndexes.length ? listPriceIndexes[position + 1] : list.length;
    const blockEnd = Math.min(list.length, nextPriceIndex, index + 26);
    const block = list.slice(index, blockEnd);
    let dealerBonus = 0;
    let financeBonus = 0;
    let finalPrice: number | null = null;

    for (let cursor = 0; cursor < block.length; cursor++) {
      if (/^Bono del mes/i.test(block[cursor])) dealerBonus = price(block[cursor]) ?? embeddedPrice(block[cursor]) ?? price(block[cursor + 1]) ?? embeddedPrice(block[cursor + 1]) ?? 0;
      if (/^Bono cr[eé]dito/i.test(block[cursor])) financeBonus = price(block[cursor]) ?? embeddedPrice(block[cursor]) ?? price(block[cursor + 1]) ?? embeddedPrice(block[cursor + 1]) ?? 0;
      if (/^Ahora/i.test(block[cursor])) finalPrice = price(block[cursor]) ?? embeddedPrice(block[cursor]) ?? price(block[cursor + 1]) ?? embeddedPrice(block[cursor + 1]);
    }

    finalPrice = finalPrice ?? Math.max(0, listPrice - dealerBonus - financeBonus);
    if (!finalPrice || finalPrice < 1_000_000) continue;
    products.push(makeProduct(sourceKey, dealer, brand, model, version, url, listPrice, dealerBonus, financeBonus, finalPrice));
  }

  return preserveDistinctSameLabelOffers(products);
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  if (parser === "cartoni") return parseCartoniV2(html, url, sourceKey, dealer);
  return baseParseMarketProducts(parser, html, url, sourceKey, dealer);
}
