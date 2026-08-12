import type { AutomotiveProduct, QueueItem } from "./parsers.ts";

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
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function text(html: string) {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button|option|strong)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

function rows(html: string) { return text(html).split("\n").map((line) => clean(line, 500)).filter(Boolean); }
function price(value: string | null | undefined) {
  if (!value || !value.includes("$")) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 1_000_000 ? parsed : null;
}
function absoluteUrl(value: string, base: string) { try { return new URL(value, base).toString(); } catch { return null; } }
function links(html: string, base: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], base); if (url) found.add(url.split("#")[0]);
  }
  return [...found];
}
function firstHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return match?.[1] ? clean(text(match[1]), 180) : "";
}
function titleCase(value: string) { return value.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }

function makeProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, listPrice: number, finalPrice: number, dealerBonus: number, financeBonus: number): AutomotiveProduct {
  return {
    external_id: `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`,
    source_key: sourceKey,
    brand, model, version,
    name: `${brand} ${model} · ${version}`,
    body_type: "Vehículo",
    url,
    list_price: listPrice,
    cash_price: Math.max(finalPrice, finalPrice + financeBonus),
    final_price: finalPrice,
    metadata: {
      parser: sourceKey,
      dealer,
      source_type: "dealer",
      capture_scope: "pricing_only",
      price_confidence: "explicit_detail",
      brand_bonus: 0,
      online_bonus: 0,
      dealer_bonus: dealerBonus,
      finance_bonus: financeBonus,
    },
  };
}

const CARTONI_BRANDS = ["toyota", "geely", "mg", "audi", "cupra", "seat", "skoda", "volkswagen", "ssang-yong", "byd", "jmc", "jeep"];
const CARTONI_CANONICAL: Record<string, string> = {
  toyota: "Toyota", geely: "Geely", mg: "MG", audi: "Audi", cupra: "Cupra", seat: "Seat", skoda: "Skoda",
  volkswagen: "Volkswagen", "ssang-yong": "KGM", byd: "BYD", jmc: "JMC", jeep: "Jeep",
};

function cartoniDiscovery(html: string, url: string, stage: string): QueueItem[] {
  if (stage === "root") {
    return CARTONI_BRANDS.map((brand) => ({
      kind: "automotive_dealer_catalog" as const,
      stage: "brand",
      url: `https://www.cartoni.cl/nuevos/${brand}`,
      task_key: `brand-${brand}`,
    }));
  }
  const discovered = links(html, url).filter((value) => {
    try {
      const parsed = new URL(value);
      if (!/(^|\.)cartoni\.cl$/i.test(parsed.hostname)) return false;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "m" && parts[1] === "nuevo") return parts.length === 4;
      return parts[0] === "nuevo" && parts.length === 3;
    } catch { return false; }
  });
  return [...new Set(discovered)].slice(0, 600).map((target) => ({
    kind: "automotive_model_page" as const,
    stage: "model",
    url: target,
    task_key: slug(new URL(target).pathname),
  }));
}

function cartoniParse(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const list = rows(html), path = new URL(url).pathname.split("/").filter(Boolean);
  const offset = path[0] === "m" ? 1 : 0;
  const brandSlug = path[offset + 1] ?? "";
  const brand = CARTONI_CANONICAL[brandSlug] ?? titleCase(brandSlug);
  const heading = firstHeading(html);
  const model = clean(heading.replace(/^NUEVO\s+/i, "").replace(new RegExp(`^${brand}\\s+`, "i"), ""), 160) || titleCase(path[offset + 2] ?? "Modelo");
  const products: AutomotiveProduct[] = [];

  for (let index = 0; index < list.length; index++) {
    if (!/^Precio de lista/i.test(list[index])) continue;
    const listPrice = price(list[index]) ?? price(list[index + 1]);
    if (!listPrice) continue;

    let version = "Precio desde";
    for (let cursor = index - 1; cursor >= Math.max(0, index - 12); cursor--) {
      const candidate = list[cursor];
      if (!candidate || price(candidate) || /^(Motor|Combustible|Transmisi[oó]n|Tracci[oó]n|VERSIONES|COTIZAR|AHORA|Precio)/i.test(candidate)) continue;
      if (candidate.localeCompare(model, "es", { sensitivity: "base" }) === 0 || candidate.localeCompare(heading, "es", { sensitivity: "base" }) === 0) continue;
      version = candidate.replace(/\s+i$/i, "").trim();
      break;
    }

    const block = list.slice(index, Math.min(list.length, index + 12));
    let dealerBonus = 0, financeBonus = 0, finalPrice: number | null = null;
    for (let cursor = 0; cursor < block.length; cursor++) {
      if (/^Bono del mes/i.test(block[cursor])) dealerBonus = price(block[cursor]) ?? price(block[cursor + 1]) ?? 0;
      if (/^Bono cr[eé]dito/i.test(block[cursor])) financeBonus = price(block[cursor]) ?? price(block[cursor + 1]) ?? 0;
      if (/^Ahora/i.test(block[cursor])) finalPrice = price(block[cursor]) ?? price(block[cursor + 1]);
    }
    finalPrice = finalPrice ?? Math.max(0, listPrice - dealerBonus - financeBonus);
    if (!finalPrice) continue;
    products.push(makeProduct(sourceKey, dealer, brand, model, version, url, listPrice, finalPrice, dealerBonus, financeBonus));
  }
  return [...new Map(products.map((item) => [item.external_id, item])).values()];
}

const KAUFMANN_MODELS = ["clase-a", "clase-c", "clase-e", "clase-s", "cle", "gla", "glc", "glc-coupe", "gle", "gle-coupe", "gls", "clase-g", "eqa"];
function kaufmannDiscovery(stage: string): QueueItem[] {
  if (stage !== "root") return [];
  return KAUFMANN_MODELS.map((model) => ({
    kind: "automotive_model_page" as const,
    stage: "model",
    url: `https://www.kaufmann.cl/automoviles/mercedes-benz/${model}`,
    task_key: `mercedes-${model}`,
  }));
}

function kaufmannParse(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const list = rows(html), heading = firstHeading(html), model = heading || titleCase(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "Mercedes-Benz");
  const products: AutomotiveProduct[] = [];
  for (let index = 0; index < list.length; index++) {
    if (!/^Precio lista$/i.test(list[index]) && !/^Precio lista\s+\$/i.test(list[index])) continue;
    const listPrice = price(list[index]) ?? price(list[index - 1]) ?? price(list[index + 1]);
    if (!listPrice) continue;

    let priceLabelIndex = index - 1;
    while (priceLabelIndex >= Math.max(0, index - 10) && !/^Precio$/i.test(list[priceLabelIndex])) priceLabelIndex--;
    let finalPrice: number | null = null;
    if (priceLabelIndex >= 0) {
      for (let cursor = priceLabelIndex + 1; cursor < index; cursor++) {
        const candidatePrice = price(list[cursor]); if (candidatePrice) { finalPrice = candidatePrice; break; }
      }
    }
    finalPrice = finalPrice ?? listPrice;

    let version = model;
    const start = priceLabelIndex >= 0 ? priceLabelIndex - 1 : index - 2;
    for (let cursor = start; cursor >= Math.max(0, index - 20); cursor--) {
      const candidate = list[cursor];
      if (!candidate || price(candidate) || /^(Precio|Consumo|Motor|Combustible|Versiones|Mostrar los datos|Descargar ficha|Cotizar)$/i.test(candidate)) continue;
      if (candidate.length > 110) continue;
      version = candidate;
      break;
    }
    products.push(makeProduct(sourceKey, dealer, "Mercedes-Benz", model, version, url, listPrice, finalPrice, Math.max(0, listPrice - finalPrice), 0));
  }
  return [...new Map(products.map((item) => [item.external_id, item])).values()];
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  if (parser === "cartoni") return cartoniDiscovery(html, url, stage);
  if (parser === "kaufmann") return kaufmannDiscovery(stage);
  return null;
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  if (parser === "cartoni") return cartoniParse(html, url, sourceKey, dealer);
  if (parser === "kaufmann") return kaufmannParse(html, url, sourceKey, dealer);
  return null;
}
