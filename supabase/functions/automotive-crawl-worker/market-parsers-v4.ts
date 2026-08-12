import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v3.ts";
import { parsePortilloFlightVersions } from "./portillo-flight.ts";

function clean(value: unknown, max = 260) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function cellText(value: string) {
  return clean(decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")), 320);
}

function clp(value: string) {
  const normalized = value.replace(/[^0-9]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 1_000_000 ? parsed : 0;
}

function parseSubaruChile(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const products = new Map<string, AutomotiveProduct>();
  let currentModel = "";

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cellText(match[1]));
    if (cells.length < 7) continue;

    const hasModelCell = cells.length >= 8;
    if (hasModelCell && cells[0]) currentModel = clean(cells[0], 180);
    if (!currentModel) continue;

    const offset = hasModelCell ? 1 : 0;
    const version = clean(cells[offset], 240);
    const listPrice = clp(cells[offset + 1] ?? "");
    const directBonus = clp(cells[offset + 2] ?? "");
    const cashPrice = clp(cells[offset + 3] ?? "") || Math.max(0, listPrice - directBonus);
    const financeBonus = clp(cells[offset + 4] ?? "");
    const finalPrice = clp(cells[offset + 5] ?? "") || Math.max(0, cashPrice - financeBonus);
    if (!version || !listPrice || !finalPrice) continue;

    const externalId = `${sourceKey}:${slug(`${currentModel}-${version}`)}`;
    products.set(externalId, {
      external_id: externalId,
      source_key: sourceKey,
      brand: "Subaru",
      model: currentModel,
      version,
      name: `Subaru ${currentModel} · ${version}`,
      body_type: "Vehículo",
      url,
      list_price: listPrice,
      cash_price: cashPrice || listPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "brand",
        capture_scope: "version_pricing",
        price_confidence: "official_structured_table",
        identity_source: "official_subaru_price_table",
        brand_bonus: directBonus,
        online_bonus: 0,
        dealer_bonus: 0,
        finance_bonus: financeBonus,
      },
    });
  }

  return [...products.values()];
}

function isSalazarBrandCatalog(url: string) {
  try {
    return /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  if (parser === "subaru_chile") return [];
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(
  parser: string,
  html: string,
  url: string,
  sourceKey: string,
  dealer: string,
): AutomotiveProduct[] | null {
  if (parser === "subaru_chile") return parseSubaruChile(html, url, sourceKey, dealer);

  // Salazar's /marcas/{brand}/nuevo pages are catalog/discovery pages, not vehicle models.
  // Returning an empty array prevents the legacy model parser from ingesting the catalog H1
  // (for example, "Nuevos: precios y modelos") as a fake vehicle identity.
  if (parser === "salazar_israel" && isSalazarBrandCatalog(url)) return [];

  const legacy = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser !== "portillo") return legacy;

  const structured = parsePortilloFlightVersions(html, url, sourceKey, dealer, legacy ?? []);
  return structured.length ? structured : legacy;
}
