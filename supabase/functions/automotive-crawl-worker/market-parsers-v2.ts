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
  for (let cursor = listPriceIndex - 1; cursor >= Math.max(0, listPriceIndex - 22); cursor--) {
    if (!price(list[cursor])) continue;
    for (let versionIndex = cursor - 1; versionIndex >= Math.max(0, cursor - 3); versionIndex--) {
      const candidate = clean(list[versionIndex], 220);
      if (!candidate || candidate.localeCompare(model, "es", { sensitivity: "base" }) === 0) continue;
      if (/^(VERSIONES|Motor|Combustible|Transmisi[oó]n|Tracci[oó]n|Precio|Precio desde)$/i.test(candidate)) continue;
      if (/^(4X2|4X4|Autom[aá]tica|Mec[aá]nica|Gasolina|Di[eé]sel|El[eé]ctrico|H[ií]brido)$/i.test(candidate)) continue;
      if (price(candidate)) continue;
      return candidate.replace(/\s+i$/i, "").trim();
    }
    break;
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

function parseCartoniV2(html: string, url: string, sourceKey: string, dealer: string) {
  const list = rows(html);
  const { brandSlug, modelSlug } = pathIdentity(url);
  const brand = BRAND_NAMES[brandSlug.toLowerCase()] ?? brandSlug.toUpperCase();
  const model = pageModel(list, modelSlug);
  const products: AutomotiveProduct[] = [];

  for (let index = 0; index < list.length; index++) {
    if (!/^Precio de lista/i.test(list[index])) continue;
    const listPrice = price(list[index]) ?? price(list[index + 1]);
    if (!listPrice) continue;

    const version = versionBeforeSummaryPrice(list, index, model);
    const block = list.slice(index, Math.min(list.length, index + 16));
    let dealerBonus = 0;
    let financeBonus = 0;
    let finalPrice: number | null = null;

    for (let cursor = 0; cursor < block.length; cursor++) {
      if (/^Bono del mes/i.test(block[cursor])) dealerBonus = price(block[cursor]) ?? price(block[cursor + 1]) ?? 0;
      if (/^Bono cr[eé]dito/i.test(block[cursor])) financeBonus = price(block[cursor]) ?? price(block[cursor + 1]) ?? 0;
      if (/^Ahora/i.test(block[cursor])) finalPrice = price(block[cursor]) ?? price(block[cursor + 1]);
    }

    finalPrice = finalPrice ?? Math.max(0, listPrice - dealerBonus - financeBonus);
    if (!finalPrice || finalPrice < 1_000_000) continue;
    products.push(makeProduct(sourceKey, dealer, brand, model, version, url, listPrice, dealerBonus, financeBonus, finalPrice));
  }

  return [...new Map(products.map((item) => [item.external_id, item])).values()];
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  if (parser === "cartoni") return parseCartoniV2(html, url, sourceKey, dealer);
  return baseParseMarketProducts(parser, html, url, sourceKey, dealer);
}
