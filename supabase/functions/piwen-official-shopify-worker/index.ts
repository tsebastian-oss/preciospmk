import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SHOP_URL = "https://www.piwen.cl";
const PRODUCTS_URL = SHOP_URL + "/products.json?limit=250";
const BRAND_SLUG = "piwen";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";

type ShopifyVariant = {
  id: number;
  title: string;
  sku?: string | null;
  available: boolean;
  price: string | number;
  grams?: number | null;
  compare_at_price?: string | number | null;
  updated_at?: string | null;
};

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[];
  published_at?: string | null;
  updated_at?: string | null;
  variants?: ShopifyVariant[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

function familyFor(title: string, productType: string) {
  const n = normalize(title + " " + productType);
  if (/castan(?:a|as).*caju|caju|cashew/.test(n)) return "Castañas de cajú";
  if (/pistach/.test(n)) return "Pistachos";
  if (/almendr/.test(n)) return "Almendras";
  if (/avellan/.test(n)) return "Avellanas";
  if (/nuez|nueces/.test(n)) return "Nueces";
  if (/mani/.test(n)) return "Maní";
  if (/mix|frutos secos/.test(n)) return "Mixes";
  if (/semilla|pepita/.test(n)) return "Semillas";
  if (/pasa|cranber|arandano|ciruela|damasco|fruta deshidrat/.test(n)) return "Fruta deshidratada";
  if (/cereal|avena|quinoa|legumbre/.test(n)) return "Cereales y legumbres";
  if (/chocolate|cacao/.test(n)) return "Chocolates";
  return productType?.trim() || "Otros";
}

function numberValue(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatFor(grams: number | null, variantTitle: string) {
  if (grams && grams > 0) {
    if (grams >= 1000 && grams % 1000 === 0) return `${grams / 1000} kg`;
    return `${grams} g`;
  }
  return variantTitle || "Único";
}

async function fetchCatalog() {
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= 4; page++) {
    const response = await fetch(`${PRODUCTS_URL}&page=${page}`, {
      headers: {
        "user-agent": UA,
        accept: "application/json",
        "accept-language": "es-CL,es;q=0.9",
        "cache-control": "no-cache",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`shopify_http_${response.status}`);
    const payload = await response.json().catch(() => null) as { products?: ShopifyProduct[] } | null;
    const batch = Array.isArray(payload?.products) ? payload!.products! : [];
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

async function ensureSource(brandId: string) {
  const payload = {
    retailer_name: "Piwén.cl",
    domain: "piwen.cl",
    source_type: "official",
    search_url: PRODUCTS_URL,
    priority: 125,
    active: true,
  };
  const { data: existing, error: lookupError } = await supabase
    .from("brands_vertical_sources")
    .select("id")
    .eq("brand_id", brandId)
    .eq("domain", "piwen.cl")
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.id) {
    const { error } = await supabase.from("brands_vertical_sources").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id as string;
  }
  const { data, error } = await supabase
    .from("brands_vertical_sources")
    .insert({ brand_id: brandId, ...payload })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function persistVariant(
  brandId: string,
  sourceId: string,
  product: ShopifyProduct,
  variant: ShopifyVariant,
  observedAt: string,
) {
  const currentPrice = numberValue(variant.price);
  const regularPriceRaw = numberValue(variant.compare_at_price);
  const regularPrice = regularPriceRaw && currentPrice != null && regularPriceRaw > currentPrice ? regularPriceRaw : null;
  const grams = Number(variant.grams ?? 0) > 0 ? Math.round(Number(variant.grams)) : null;
  const family = familyFor(product.title, product.product_type ?? "");
  const format = formatFor(grams, variant.title);
  const productUrl = `${SHOP_URL}/products/${product.handle}?variant=${variant.id}`;
  const sourceKey = `shopify:${product.id}:${variant.id}`;
  const canonicalKey = `piwen:${product.handle}:${variant.id}`;
  const pricePerKg = currentPrice != null && grams ? Math.round(currentPrice * 1000 / grams) : null;
  const discountPct = regularPrice && currentPrice != null
    ? Math.round((1 - currentPrice / regularPrice) * 1000) / 10
    : null;

  const { data: dbProduct, error: productError } = await supabase
    .from("brands_vertical_products")
    .upsert({
      brand_id: brandId,
      external_sku: variant.sku || sourceKey,
      name: `${product.title} · ${format}`,
      category: family,
      product_url: productUrl,
      canonical_key: canonicalKey,
      active: Boolean(variant.available),
      last_seen_at: observedAt,
      attributes: {
        actualBrand: "Piwén",
        role: "brand",
        family,
        grams,
        format,
        shopifyProductId: String(product.id),
        shopifyVariantId: String(variant.id),
        variantTitle: variant.title,
        productType: product.product_type ?? null,
        tags: product.tags ?? [],
        vendor: product.vendor ?? null,
        sourcePolicy: "official-shopify",
      },
    }, { onConflict: "brand_id,canonical_key" })
    .select("id")
    .single();
  if (productError) throw productError;

  const startOfDay = observedAt.slice(0, 10) + "T00:00:00.000Z";
  const { data: latest } = await supabase
    .from("brands_vertical_listings")
    .select("id,current_price,regular_price,in_stock,observed_at")
    .eq("source_id", sourceId)
    .eq("source_product_key", sourceKey)
    .gte("observed_at", startOfDay)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sameToday = latest
    && Number(latest.current_price ?? 0) === Number(currentPrice ?? 0)
    && Number(latest.regular_price ?? 0) === Number(regularPrice ?? 0)
    && latest.in_stock === Boolean(variant.available);

  if (sameToday) {
    return { inserted: false, priced: currentPrice != null && currentPrice > 0, available: Boolean(variant.available) };
  }

  const { error: listingError } = await supabase.from("brands_vertical_listings").insert({
    brand_id: brandId,
    source_id: sourceId,
    product_id: dbProduct.id,
    source_product_key: sourceKey,
    title: `${product.title} · ${format}`,
    brand_name: "Piwén",
    seller_name: "Piwén",
    category: family,
    product_url: productUrl,
    regular_price: regularPrice,
    current_price: currentPrice,
    currency: "CLP",
    in_stock: Boolean(variant.available),
    attributes: {
      actualBrand: "Piwén",
      role: "brand",
      family,
      grams,
      format,
      pricePerKg,
      discountPct,
      marketplace: null,
      channel: "Piwén.cl",
      pricingSource: "official",
      verification: "shopify_products_json",
      shopifyProductId: String(product.id),
      shopifyVariantId: String(variant.id),
      variantTitle: variant.title,
      tags: product.tags ?? [],
      publishedAt: product.published_at ?? null,
      productUpdatedAt: product.updated_at ?? null,
      variantUpdatedAt: variant.updated_at ?? null,
    },
    raw: {
      collector: "piwen-official-shopify-worker-v1",
      endpoint: PRODUCTS_URL,
      shopifyProductId: product.id,
      shopifyVariantId: variant.id,
    },
    observed_at: observedAt,
  });
  if (listingError) throw listingError;

  return { inserted: true, priced: currentPrice != null && currentPrice > 0, available: Boolean(variant.available) };
}

async function collect() {
  const { data: brand, error: brandError } = await supabase
    .from("brands_vertical_brands")
    .select("id")
    .eq("slug", BRAND_SLUG)
    .single();
  if (brandError || !brand) throw new Error("brand_not_found:piwen");

  const sourceId = await ensureSource(brand.id);
  const observedAt = new Date().toISOString();

  const { data: run } = await supabase.from("brands_vertical_discovery_runs").insert({
    brand_id: brand.id,
    status: "running",
    started_at: observedAt,
    sources_attempted: 1,
    notes: JSON.stringify({ collector: "piwen-official-shopify-worker-v1", source: "piwen.cl" }),
  }).select("id").single();

  try {
    const products = await fetchCatalog();
    let variants = 0;
    let inserted = 0;
    let priced = 0;
    let available = 0;
    const families = new Set<string>();

    for (const product of products) {
      const productVariants = Array.isArray(product.variants) ? product.variants : [];
      for (const variant of productVariants) {
        variants += 1;
        const family = familyFor(product.title, product.product_type ?? "");
        families.add(family);
        const result = await persistVariant(brand.id, sourceId, product, variant, observedAt);
        if (result.inserted) inserted += 1;
        if (result.priced) priced += 1;
        if (result.available) available += 1;
      }
    }

    await supabase.from("brands_vertical_sources").update({
      last_crawled_at: observedAt,
      last_status: `ok:products:${products.length}:variants:${variants}:inserted:${inserted}:priced:${priced}`,
      last_error: null,
    }).eq("id", sourceId);

    if (run?.id) {
      await supabase.from("brands_vertical_discovery_runs").update({
        status: "completed",
        sources_succeeded: 1,
        listings_found: variants,
        products_found: variants,
        finished_at: new Date().toISOString(),
        notes: JSON.stringify({
          collector: "piwen-official-shopify-worker-v1",
          products: products.length,
          variants,
          inserted,
          priced,
          available,
          families: [...families].sort(),
        }),
      }).eq("id", run.id);
    }

    return {
      status: "completed",
      products: products.length,
      variants,
      inserted,
      priced,
      available,
      families: [...families].sort(),
      source: "Piwén.cl",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("brands_vertical_sources").update({
      last_crawled_at: observedAt,
      last_status: "degraded:last-valid-retained",
      last_error: message.slice(0, 700),
    }).eq("id", sourceId);
    if (run?.id) {
      await supabase.from("brands_vertical_discovery_runs").update({
        status: "failed",
        sources_succeeded: 0,
        finished_at: new Date().toISOString(),
        notes: JSON.stringify({ collector: "piwen-official-shopify-worker-v1", error: message }),
      }).eq("id", run.id);
    }
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

  const token = request.headers.get("x-piwen-worker-token");
  const { data: config, error: configError } = await supabase
    .from("qsr_worker_config")
    .select("token")
    .eq("id", 1)
    .single();

  if (configError || !token || !config?.token || token !== config.token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return Response.json({ ok: true, observedAt: new Date().toISOString(), result: await collect() });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
});
