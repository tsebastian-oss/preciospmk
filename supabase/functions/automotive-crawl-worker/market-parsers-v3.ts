import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v2.ts";

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
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

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] | null {
  const products = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser === "cartoni" && products) return normalizeCartoni(products, url, sourceKey);
  return products;
}
