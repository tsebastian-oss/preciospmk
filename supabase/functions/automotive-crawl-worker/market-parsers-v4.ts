import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v3.ts";

function clean(value: unknown, max = 220) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
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

function rows(html: string) {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button|option|strong)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map((line) => clean(line, 500)).filter(Boolean);
}

function price(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 1_000_000 ? parsed : null;
}

function makeProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, listPrice: number, cashPrice: number, finalPrice: number, financeBonus: number, confidence: string): AutomotiveProduct {
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
      price_confidence: confidence,
      brand_bonus: 0,
      online_bonus: 0,
      dealer_bonus: 0,
      finance_bonus: financeBonus,
    },
  };
}

const SALFA_BRANDS = new Set(["Chevrolet","Chery","GAC","Jaecoo","JMC","KGM","KIA","Mitsubishi","Nissan","Omoda","Toyota"]);

function parseSalfa(html: string, url: string, sourceKey: string, dealer: string) {
  const list = rows(html);
  const products: AutomotiveProduct[] = [];
  for (let index = 0; index < list.length; index++) {
    const brandRaw = list[index];
    const brand = [...SALFA_BRANDS].find((value) => value.localeCompare(brandRaw.replace(/\s+(Híbrido|Eléctrico)$/i, ""), "es", { sensitivity: "base" }) === 0);
    if (!brand) continue;
    const model = clean(list[index + 1], 180);
    if (!model || /^(Con financiamiento|Precio contado|Ver más detalles)/i.test(model)) continue;

    const block = list.slice(index + 1, Math.min(list.length, index + 12));
    let financed: number | null = null;
    let cash: number | null = null;
    for (let cursor = 0; cursor < block.length; cursor++) {
      if (/^Con financiamiento desde/i.test(block[cursor])) financed = price(block[cursor]) ?? price(block[cursor + 1]);
      if (/^Precio contado/i.test(block[cursor])) cash = price(block[cursor]) ?? price(block[cursor + 1]);
    }
    if (!financed && !cash) continue;
    const finalPrice = financed ?? cash!;
    const cashPrice = cash ?? finalPrice;
    const financeBonus = Math.max(0, cashPrice - finalPrice);
    products.push(makeProduct(sourceKey, dealer, brand === "KIA" ? "Kia" : brand, model, "Precio desde", url, cashPrice, cashPrice, finalPrice, financeBonus, "explicit_listing"));
  }
  return [...new Map(products.map((item) => [item.external_id, item])).values()];
}

function parseBmw(html: string, url: string, sourceKey: string, dealer: string) {
  const text = decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const products: AutomotiveProduct[] = [];
  const pattern = /Válido para BMW\s+(.{2,120}?)\.\s*Precio Lista corresponde a\s*\$\s*([0-9.]+).*?Precio con bono\s*\$\s*([0-9.]+)(?:.*?incluye bono de\s*\$\s*([0-9.]+))?/gi;
  for (const match of text.matchAll(pattern)) {
    const version = clean(match[1], 140);
    const listPrice = price(match[2]);
    const finalPrice = price(match[3]);
    if (!version || !listPrice || !finalPrice) continue;
    const model = clean(version.split(/\s+/).slice(0, 2).join(" "), 80);
    const financeBonus = price(match[4]) ?? Math.max(0, listPrice - finalPrice);
    products.push(makeProduct(sourceKey, dealer, "BMW", model, version, url, listPrice, listPrice, finalPrice, financeBonus, "explicit_promotion"));
  }
  return [...new Map(products.map((item) => [item.external_id, item])).values()];
}

const DERCO_BRAND_PATHS = ["suzuki","mazda","renault","gwm","changan","deepal","jac"];
function dercoDiscovery(url: string, stage: string): QueueItem[] | null {
  if (stage !== "root") return null;
  return DERCO_BRAND_PATHS.map((brand) => ({
    kind: "automotive_dealer_catalog",
    stage: "brand",
    url: `https://www.dercocenter.cl/marcas/${brand}`,
    task_key: `brand-${brand}`,
  }));
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  if (parser === "dercocenter") return dercoDiscovery(url, stage) ?? baseDiscoverMarket(parser, html, url, stage);
  if (parser === "salfa_automotriz" || parser === "bmw_wbm") return [];
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  if (parser === "salfa_automotriz") return parseSalfa(html, url, sourceKey, dealer);
  if (parser === "bmw_wbm") return parseBmw(html, url, sourceKey, dealer);
  return baseParseMarketProducts(parser, html, url, sourceKey, dealer);
}
