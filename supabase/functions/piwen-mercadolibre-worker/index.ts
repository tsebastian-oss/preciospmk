import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36";
const BRAND_SLUG = "piwen";

type Target = {
  brand: "Piwén" | "Alto La Cruz" | "Millantú";
  role: "brand" | "competitor";
  aliases: string[];
  searchUrls: string[];
  fallbackUrls: string[];
};

type ParsedListing = {
  key: string;
  title: string;
  brand: string;
  seller: string | null;
  category: string;
  family: string | null;
  grams: number | null;
  currentPrice: number | null;
  regularPrice: number | null;
  inStock: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  url: string;
  sourcePayload: Record<string, unknown>;
};

const TARGETS: Target[] = [
  {
    brand: "Piwén",
    role: "brand",
    aliases: ["piwen", "piwén"],
    searchUrls: [
      "https://www.mercadolibre.cl/tienda/piwen",
      "https://listado.mercadolibre.cl/frutos-secos-piwen",
    ],
    fallbackUrls: [
      "https://www.mercadolibre.cl/piwen-almendra-natural-1-kilo-sin-sal-frutos-secos/p/MLC37030161",
      "https://www.mercadolibre.cl/piwen-castanas-de-caju-sin-sal-1-kilo-anacardos-snack-frutos-secos-saludables/p/MLC37056337",
      "https://www.mercadolibre.cl/pistachos-salado-con-cascara-piwen-de-1-kg/p/MLC65495393",
      "https://www.mercadolibre.cl/almendras-francesas-piwen-100g-sin-sal-frutos-secos-snack-almendras-confitadas/p/MLC62542840",
    ],
  },
  {
    brand: "Alto La Cruz",
    role: "competitor",
    aliases: ["alto la cruz", "alto lacruz"],
    searchUrls: [
      "https://listado.mercadolibre.cl/frutos-secos-alto-la-cruz",
      "https://listado.mercadolibre.cl/alto-la-cruz-frutos-secos",
    ],
    fallbackUrls: [
      "https://www.mercadolibre.cl/almendras-tostadas-enteras-700g-frutos-secos-alto-la-cruz/p/MLC65359625",
      "https://www.mercadolibre.cl/mix-frutos-secos-pistacho-almendras-avellanas-chilena-y-mas-happy-hour-alto-la-cruz-linea-colors-450g/p/MLC65358406",
      "https://www.mercadolibre.cl/mix-tostado-alto-la-cruz-700g/p/MLC65363187",
    ],
  },
  {
    brand: "Millantú",
    role: "competitor",
    aliases: ["millantu", "millantú"],
    searchUrls: [
      "https://listado.mercadolibre.cl/frutos-secos-millantu",
      "https://listado.mercadolibre.cl/millantu",
    ],
    fallbackUrls: [
      "https://www.mercadolibre.cl/almendras-saladas-millantu-doy-pack-80-g/p/MLC26334548",
      "https://www.mercadolibre.cl/castana-de-caju-salada-80-gr-pack-8-unidades-millantu/up/MLCU1799155379",
      "https://www.mercadolibre.cl/mix-premium-pack-14-unidades-millantu/up/MLCU1799072549",
      "https://www.mercadolibre.cl/mix-frutos-secos-120-gr-pack-8-unidades-millantu/up/MLCU1799160313",
    ],
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return htmlDecode(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function productKey(url: string) {
  const match = url.match(/\/(MLCU?\d+)(?:\?|\/|$)/i) ?? url.match(/(MLCU?\d+)/i);
  if (match?.[1]) return match[1].toUpperCase();
  return "mlc-" + normalize(url).replace(/[^a-z0-9]+/g, "-").slice(-80);
}

function familyFor(title: string) {
  const n = normalize(title);
  if (/castan(?:a|as).*caju|caju|cashew/.test(n)) return "Castañas de cajú";
  if (/pistach/.test(n)) return "Pistachos";
  if (/almendr/.test(n)) return "Almendras";
  if (/nuez|nueces/.test(n)) return "Nueces";
  if (/mani/.test(n)) return "Maní";
  if (/mix|frutos secos/.test(n)) return "Mixes";
  if (/avellan/.test(n)) return "Avellanas";
  if (/semilla/.test(n)) return "Semillas";
  if (/cranber|arandano|pasa|ciruela|damasco/.test(n)) return "Fruta deshidratada";
  return null;
}

function gramsFor(text: string) {
  const n = normalize(text).replace(/,/g, ".");
  const kg = n.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) {
    const value = Number(kg[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : null;
  }
  const grams = n.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)\b/);
  if (grams) {
    const value = Number(grams[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  return null;
}

function numeric(value: unknown) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function matchesTarget(target: Target, parsedBrand: string, title: string) {
  const b = normalize(parsedBrand);
  const t = normalize(title);
  return target.aliases.some((alias) => {
    const a = normalize(alias);
    return b === a || b.includes(a) || t.includes(a);
  });
}

async function fetchRaw(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "es-CL,es;q=0.9,en;q=0.7",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (raw.length < 500) throw new Error(`short_html:${raw.length}`);
  return { raw, finalUrl: response.url || url };
}

function extractLinks(raw: string) {
  const links = new Set<string>();
  for (const match of raw.matchAll(/href=["'](https:\/\/www\.mercadolibre\.cl\/[^"'#]+)["']/gi)) {
    let url = htmlDecode(match[1]);
    if (!/(?:\/p\/MLC\d+|\/up\/MLCU\d+|\/MLC-\d+)/i.test(url)) continue;
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      const itemFilter = parsed.searchParams.get("pdp_filters");
      parsed.search = itemFilter ? `?pdp_filters=${encodeURIComponent(itemFilter)}` : "";
      url = parsed.toString();
    } catch {}
    links.add(url);
    if (links.size >= 35) break;
  }
  return [...links];
}

function productJsonLd(raw: string) {
  for (const match of raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = htmlDecode(match[1]).trim();
    if (!block) continue;
    try {
      const parsed = JSON.parse(block);
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      const product = candidates.find((item: any) => {
        const type = item?.["@type"];
        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
      });
      if (product) return product;
    } catch {}
  }
  return null;
}

function parseListing(target: Target, raw: string, url: string): ParsedListing | null {
  const json: any = productJsonLd(raw);
  const text = stripTags(raw);

  const title =
    String(json?.name ?? "").trim() ||
    stripTags(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    stripTags(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (!title) return null;

  const brandValue = typeof json?.brand === "string" ? json.brand : String(json?.brand?.name ?? "");
  if (!matchesTarget(target, brandValue, title)) return null;

  const offers = Array.isArray(json?.offers) ? json.offers[0] : json?.offers;
  let currentPrice = numeric(offers?.price);
  if (!currentPrice) {
    currentPrice = numeric(raw.match(/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i)?.[1]);
  }
  if (!currentPrice) {
    currentPrice = numeric(raw.match(/"price"\s*:\s*"?([0-9]{3,9}(?:\.[0-9]+)?)"?/i)?.[1]);
  }

  let regularPrice: number | null = null;
  const oldPrice = raw.match(/andes-money-amount--previous[\s\S]{0,450}?andes-money-amount__fraction[^>]*>([0-9.]+)</i)?.[1];
  if (oldPrice) regularPrice = numeric(oldPrice);
  if (regularPrice && currentPrice && regularPrice <= currentPrice) regularPrice = null;

  let inStock: boolean | null = null;
  const availability = String(offers?.availability ?? "");
  if (/InStock/i.test(availability)) inStock = true;
  else if (/OutOfStock|Discontinued/i.test(availability)) inStock = false;
  if (/este producto no est[aá] disponible|publicaci[oó]n finalizada|sin stock/i.test(normalize(text))) inStock = false;
  if (inStock == null && currentPrice) inStock = true;

  const sellerMatch = text.match(/Vendido por\s+([A-Za-z0-9À-ÿ._ -]{2,80}?)(?:\s+MercadoL[ií]der|\s+Ir a la p[aá]gina|\s+Seguir|\s+\+\d|$)/i);
  const seller = sellerMatch?.[1]?.trim() || null;
  const rating = numeric(json?.aggregateRating?.ratingValue);
  const reviewCountRaw = Number(json?.aggregateRating?.reviewCount ?? json?.aggregateRating?.ratingCount ?? 0);
  const reviewCount = Number.isFinite(reviewCountRaw) && reviewCountRaw > 0 ? Math.round(reviewCountRaw) : null;
  const family = familyFor(title + " " + text.slice(0, 2500));
  const grams = gramsFor(title + " " + text.slice(0, 3000));

  return {
    key: productKey(url),
    title,
    brand: target.brand,
    seller,
    category: family ?? "Frutos secos",
    family,
    grams,
    currentPrice,
    regularPrice,
    inStock,
    rating,
    reviewCount,
    url,
    sourcePayload: {
      jsonLd: Boolean(json),
      availability: availability || null,
      scrapedAt: new Date().toISOString(),
    },
  };
}

async function ensureSource(brandId: string) {
  const { data: existing, error: lookupError } = await supabase
    .from("brands_vertical_sources")
    .select("id")
    .eq("brand_id", brandId)
    .eq("domain", "mercadolibre.cl")
    .maybeSingle();
  if (lookupError) throw lookupError;
  const payload = {
    retailer_name: "MercadoLibre Chile",
    domain: "mercadolibre.cl",
    source_type: "marketplace",
    search_url: "https://listado.mercadolibre.cl/frutos-secos-piwen",
    priority: 110,
    active: true,
  };
  if (existing?.id) {
    const { error } = await supabase.from("brands_vertical_sources").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id as string;
  }
  const { data, error } = await supabase.from("brands_vertical_sources").insert({ brand_id: brandId, ...payload }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function persist(brandId: string, sourceId: string, target: Target, item: ParsedListing) {
  const canonical = `mercadolibre:${item.key.toLowerCase()}`;
  const { data: product, error: productError } = await supabase
    .from("brands_vertical_products")
    .upsert({
      brand_id: brandId,
      external_sku: item.key,
      name: item.title,
      category: item.category,
      product_url: item.url,
      canonical_key: canonical,
      active: item.inStock !== false,
      last_seen_at: new Date().toISOString(),
      attributes: {
        actualBrand: target.brand,
        role: target.role,
        marketplace: "MercadoLibre Chile",
        family: item.family,
        grams: item.grams,
        sourcePolicy: "marketplace-live",
      },
    }, { onConflict: "brand_id,canonical_key" })
    .select("id")
    .single();
  if (productError) throw productError;

  const pricePerKg = item.currentPrice && item.grams ? Math.round(item.currentPrice * 1000 / item.grams) : null;
  const discountPct = item.regularPrice && item.currentPrice && item.regularPrice > item.currentPrice
    ? Math.round((1 - item.currentPrice / item.regularPrice) * 1000) / 10
    : null;

  const { error: listingError } = await supabase.from("brands_vertical_listings").insert({
    brand_id: brandId,
    source_id: sourceId,
    product_id: product.id,
    source_product_key: item.key,
    title: item.title,
    brand_name: target.brand,
    seller_name: item.seller,
    category: item.category,
    product_url: item.url,
    regular_price: item.regularPrice,
    current_price: item.currentPrice,
    currency: "CLP",
    in_stock: item.inStock,
    rating: item.rating,
    review_count: item.reviewCount,
    attributes: {
      actualBrand: target.brand,
      role: target.role,
      marketplace: "MercadoLibre Chile",
      family: item.family,
      grams: item.grams,
      pricePerKg,
      discountPct,
      snapshotType: "automatic",
      verification: "mercadolibre_product_page",
    },
    raw: {
      collector: "piwen-mercadolibre-worker-v1",
      sourceUrl: item.url,
      ...item.sourcePayload,
    },
    observed_at: new Date().toISOString(),
  });
  if (listingError) throw listingError;
}

async function collectTarget(brandId: string, sourceId: string, target: Target) {
  const urls = new Set<string>(target.fallbackUrls);
  const searchDetails: Record<string, unknown>[] = [];

  for (const searchUrl of target.searchUrls) {
    try {
      const { raw } = await fetchRaw(searchUrl);
      const found = extractLinks(raw);
      found.forEach((url) => urls.add(url));
      searchDetails.push({ url: searchUrl, status: "ok", links: found.length });
    } catch (error) {
      searchDetails.push({ url: searchUrl, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const maxUrls = target.brand === "Piwén" ? 18 : 14;
  const selected = [...urls].slice(0, maxUrls);
  let persisted = 0;
  let withPrice = 0;
  const details: Record<string, unknown>[] = [];

  for (const url of selected) {
    try {
      const { raw, finalUrl } = await fetchRaw(url);
      const parsed = parseListing(target, raw, finalUrl);
      if (!parsed) {
        details.push({ url, status: "skipped:not-target" });
      } else {
        await persist(brandId, sourceId, target, parsed);
        persisted++;
        if (parsed.currentPrice) withPrice++;
        details.push({ url: parsed.url, status: "ok", key: parsed.key, price: parsed.currentPrice, inStock: parsed.inStock });
      }
    } catch (error) {
      details.push({ url, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  return { brand: target.brand, persisted, withPrice, searched: selected.length, searchDetails, details };
}

async function collect(onlyBrand?: string) {
  const { data: brand, error: brandError } = await supabase
    .from("brands_vertical_brands")
    .select("id")
    .eq("slug", BRAND_SLUG)
    .single();
  if (brandError || !brand) throw new Error("brand_not_found:piwen");

  const sourceId = await ensureSource(brand.id);
  const selected = onlyBrand
    ? TARGETS.filter((target) => normalize(target.brand) === normalize(onlyBrand))
    : TARGETS;
  if (!selected.length) throw new Error("unknown_brand");

  const { data: run } = await supabase.from("brands_vertical_discovery_runs").insert({
    brand_id: brand.id,
    status: "running",
    started_at: new Date().toISOString(),
    sources_attempted: 1,
    notes: JSON.stringify({ collector: "piwen-mercadolibre-worker-v1", targets: selected.map((target) => target.brand) }),
  }).select("id").single();

  const results: Record<string, unknown>[] = [];
  let total = 0;
  let withPrice = 0;

  for (const target of selected) {
    const result = await collectTarget(brand.id, sourceId, target);
    results.push(result);
    total += result.persisted;
    withPrice += result.withPrice;
  }

  const status = total > 0 ? "completed" : "failed";
  await supabase.from("brands_vertical_sources").update({
    last_crawled_at: new Date().toISOString(),
    last_status: total > 0 ? `ok:${total}:priced:${withPrice}` : "degraded:last-valid-retained",
    last_error: total > 0 ? null : JSON.stringify(results).slice(0, 900),
  }).eq("id", sourceId);

  if (run?.id) {
    await supabase.from("brands_vertical_discovery_runs").update({
      status,
      sources_succeeded: total > 0 ? 1 : 0,
      listings_found: total,
      products_found: total,
      finished_at: new Date().toISOString(),
      notes: JSON.stringify({ collector: "piwen-mercadolibre-worker-v1", results }).slice(0, 15000),
    }).eq("id", run.id);
  }

  return { status, listingsFound: total, pricedListings: withPrice, results };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

  const token = request.headers.get("x-marketplace-worker-token");
  const { data: config } = await supabase.from("qsr_worker_config").select("token").eq("id", 1).single();
  if (!token || !config?.token || token !== config.token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  try {
    const result = await collect(typeof body.brand === "string" ? body.brand : undefined);
    return Response.json({ ok: true, observedAt: new Date().toISOString(), result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
