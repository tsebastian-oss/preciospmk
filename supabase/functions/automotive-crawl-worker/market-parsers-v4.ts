import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v3.ts";
import { parsePortilloFlightVersions } from "./portillo-flight.ts";

function isSalazarBrandCatalog(url: string) {
  try {
    return /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(
  parser: string,
  html: string,
  url: string,
  sourceKey: string,
  dealer: string,
): AutomotiveProduct[] | null {
  // Salazar's /marcas/{brand}/nuevo pages are catalog/discovery pages, not vehicle models.
  // Returning an empty array prevents the legacy model parser from ingesting the catalog H1
  // (for example, "Nuevos: precios y modelos") as a fake vehicle identity.
  if (parser === "salazar_israel" && isSalazarBrandCatalog(url)) return [];

  const legacy = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser !== "portillo") return legacy;

  const structured = parsePortilloFlightVersions(html, url, sourceKey, dealer, legacy ?? []);
  return structured.length ? structured : legacy;
}
