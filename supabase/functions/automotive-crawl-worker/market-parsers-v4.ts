import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v3.ts";
import { parsePortilloFlightVersions } from "./portillo-flight.ts";

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
  const legacy = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser !== "portillo") return legacy;

  const structured = parsePortilloFlightVersions(html, url, sourceKey, dealer, legacy ?? []);
  return structured.length ? structured : legacy;
}
