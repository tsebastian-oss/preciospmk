type JsonRecord = Record<string, unknown>;

export type ParsedProduct = {
  supermarket: string;
  external_id: string;
  parent_external_id: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  seller: string | null;
  seller_id: string | null;
  variant: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | null;
  offer_price: number;
  unit: string | null;
  unit_price: number | null;
  in_stock: boolean;
  observed_at: string;
  source_metadata: JsonRecord;
};

type Signals = {
  name: string | null;
  externalId: string | null;
  brand: string | null;
  category: string | null;
  regular: number | null;
  offer: number | null;
  unitPrice: number | null;
  unit: string | null;
  image: string | null;
  unavailable: boolean;
  metadata: JsonRecord;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/[^0-9,.-]/g, "");
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma > dot) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "");
  else normalized = normalized.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function plain(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decode(match[1]);
  }
  return null;
}

function h1(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match?.[1] ? plain(match[1]) : null;
}

function jsonLdPayloads(html: string): string[] {
  const payloads = Array.from(
    html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1].trim(),
  );
  const embedded = /"type":"application\/ld\+json","children":"((?:\\.|[^"\\])*)"/g;
  for (const match of html.matchAll(embedded)) {
    try {
      const value = JSON.parse(`"${match[1]}"`) as string;
      if (value.trim()) payloads.push(value);
    } catch {
      // Ignore malformed framework payloads.
    }
  }
  return payloads;
}

function types(node: JsonRecord): string[] {
  const raw = node["@type"];
  return Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
}

function collectProducts(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, output);
    return output;
  }
  const node = record(value);
  if (!node) return output;
  if (types(node).some((type) => type.toLowerCase() === "product")) output.push(node);
  for (const key of ["@graph", "itemListElement", "item", "hasVariant", "mainEntity"]) {
    if (node[key]) collectProducts(node[key], output);
  }
  return output;
}

function offers(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(offers);
  const item = record(value);
  if (!item) return [];
  if (item.offers) {
    const nested = offers(item.offers);
    if (nested.length) return nested;
  }
  return [item];
}

function image(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const item = record(first);
  return stringValue(first) ?? stringValue(item?.url) ?? stringValue(item?.contentUrl);
}

function brand(value: unknown): string | null {
  return stringValue(value) ?? stringValue(record(value)?.name);
}

function absolute(raw: string, base: string): string {
  try { return new URL(raw, base).toString(); } catch { return base; }
}

function canonicalProductUrl(retailer: string, raw: string, base: string): string {
  try {
    const url = new URL(raw, base);
    url.hash = "";
    if (["Salcobrand", "Cruz Verde", "Farmacias Ahumada"].includes(retailer)) url.search = "";
    return url.toString();
  } catch {
    return base;
  }
}

function idFromUrl(retailer: string, raw: string): string {
  const path = decodeURIComponent(new URL(raw).pathname);
  if (retailer === "Farmacias Ahumada") {
    return path.match(/-([0-9]{4,})\.html$/)?.[1] ?? path.split("/").filter(Boolean).at(-1) ?? raw;
  }
  if (retailer === "Cruz Verde") {
    return path.match(/\/([0-9]+)\.html$/)?.[1] ?? path.split("/").filter(Boolean).at(-1)?.replace(/\.html$/i, "") ?? raw;
  }
  return (path.split("/").filter(Boolean).at(-1) ?? raw).replace(/\.html$/i, "");
}

function categoryFromUrl(raw: string): string | null {
  try {
    const parts = new URL(raw).pathname
      .split("/")
      .filter(Boolean)
      .slice(0, -1)
      .map((item) => decodeURIComponent(item).replace(/[-_]+/g, " "))
      .filter((item) => !["products", "product"].includes(item.toLowerCase()));
    return parts.length ? parts.join(" > ") : null;
  } catch {
    return null;
  }
}

function breadcrumbCategory(html: string, productName: string | null): string | null {
  for (const payload of jsonLdPayloads(html)) {
    try {
      const root = JSON.parse(payload) as unknown;
      const stack: unknown[] = [root];
      while (stack.length) {
        const value = stack.pop();
        if (Array.isArray(value)) {
          stack.push(...value);
          continue;
        }
        const node = record(value);
        if (!node) continue;
        if (types(node).some((type) => type.toLowerCase() === "breadcrumblist") && Array.isArray(node.itemListElement)) {
          const names = node.itemListElement
            .map((entry) => {
              const item = record(entry);
              const nested = record(item?.item);
              return stringValue(item?.name) ?? stringValue(nested?.name);
            })
            .filter((item): item is string => Boolean(item))
            .map((item) => decode(item))
            .filter((item) => !/^inicio$|^home$/i.test(item));
          while (names.length && productName && names.at(-1)?.toLowerCase() === productName.toLowerCase()) names.pop();
          const meaningful = names.filter((item) => !/^productos?$|^farmacias?$/i.test(item));
          if (meaningful.length) return meaningful.at(-1) ?? null;
        }
        for (const child of Object.values(node)) {
          if (child && typeof child === "object") stack.push(child);
        }
      }
    } catch {
      // Continue through all public structured-data blocks.
    }
  }
  return null;
}

function label(content: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(
    `${escaped}\\s*:?\\s*([^|/]{2,120}?)(?=\\s+(?:Forma Farmac[eé]utica|Dosis por|Precio|Detalles|Formato|Condici[oó]n|Registro|Laboratorio|Marca|Concentracion)\\b|$)`,
    "i",
  ));
  return match?.[1]?.trim() ?? null;
}

function price(content: string, pattern: RegExp): number | null {
  const match = content.match(pattern);
  return match?.[1] ? numberValue(match[1]) : null;
}

function cleanMetadataValue(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .split(/,\s*(?:desarrollado|producido|fabricado|elaborado)\b/i)[0]
    .split(/\s+(?:Almacenamiento|Presentaci[oó]n|Precauciones|Indicaciones|Contraindicaciones)\b/i)[0]
    .replace(/^[■•\-\s]+/, "")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

function signals(retailer: string, html: string, pageUrl: string): Signals {
  const content = plain(html);
  const name = h1(html);
  const metadata: JsonRecord = { capture_status: "accepted", parserVersion: "pharmacy-1.2" };
  const active = cleanMetadataValue(label(content, "Principio Activo") ?? label(content, "Principios Activos"));
  if (active) metadata.activeIngredient = active;
  const form = cleanMetadataValue(label(content, "Forma Farmacéutica") ?? label(content, "Forma Farmaceutica"));
  if (form) metadata.pharmaceuticalForm = form;
  const dosage = cleanMetadataValue(label(content, "Dosis por Forma Farmacéutica") ?? label(content, "Concentracion") ?? label(content, "Concentración"));
  if (dosage) metadata.dosage = dosage;
  const laboratory = cleanMetadataValue(label(content, "Laboratorio"));
  if (laboratory) metadata.laboratory = laboratory;
  const registration = cleanMetadataValue(label(content, "Registro Sanitario") ?? label(content, "Registro Farmacéutico"));
  if (registration) metadata.healthRegistration = registration;
  const prescription = content.match(/\b(Receta\s+(?:simple|retenida|archivada|m[eé]dica retenida)|Controlado|Venta\s+(?:libre|directa)|Sin receta)\b/i)?.[1];
  if (prescription) metadata.prescriptionRequirement = prescription;
  const category = meta(html, "product:category") ?? breadcrumbCategory(html, name);
  if (category) metadata.sourceCategory = category;
  const unavailable = /\b(?:sin stock|agotado|producto no disponible|no disponible)\b/i.test(content);

  if (retailer === "Salcobrand") {
    const regular = price(content, /\$?\s*([0-9.]+)\s+Precio Farmacia/i);
    const offer = price(content, /\$?\s*([0-9.]+)\s+Precio Internet/i) ?? regular;
    const unitMatch = content.match(/Precio por unidad de medida:\s*\$?\s*([0-9.]+)\s+por\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9 ]+)/i);
    return {
      name,
      externalId: content.match(/SKU:\s*([0-9A-Za-z_-]+)/i)?.[1] ?? null,
      brand: meta(html, "product:brand"),
      category,
      regular,
      offer,
      unitPrice: unitMatch?.[1] ? numberValue(unitMatch[1]) : null,
      unit: unitMatch?.[2]?.trim() ?? null,
      image: meta(html, "og:image"),
      unavailable,
      metadata: { ...metadata, pharmacyPrice: regular, internetPrice: offer },
    };
  }

  if (retailer === "Cruz Verde") {
    const offer = price(content, /\$\s*([0-9.]+)\s*\(Oferta\)/i);
    const regular = price(content, /(?:Precio reducido de\s*)?\$\s*([0-9.]+)\s*\(Normal\)/i);
    const unitMatch = content.match(/Precio por Unidad Fraccionada:\s*\$?\s*([0-9.]+)\s+por\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9 ]+)/i);
    return {
      name,
      externalId: html.match(/data-pid=["']([^"']+)["']/i)?.[1] ?? idFromUrl(retailer, pageUrl),
      brand: meta(html, "product:brand") ?? laboratory ?? null,
      category,
      regular,
      offer,
      unitPrice: unitMatch?.[1] ? numberValue(unitMatch[1]) : null,
      unit: unitMatch?.[2]?.trim() ?? null,
      image: meta(html, "og:image"),
      unavailable,
      metadata,
    };
  }

  const ahumadaOffer = numberValue(meta(html, "product:price:amount"));
  const ahumadaRegular = price(content, /Price reduced from\s*\$?\s*([0-9.]+)\s+to\s+Precio normal/i)
    ?? price(content, /Precio normal\s*[:\-]?\s*\$?\s*([0-9.]+)/i);
  const unitMatch = content.match(/(?:Precio unitario|\$\s*[0-9.]+\s*x)\s*:?\s*\$?\s*([0-9.]+)(?:\s+x\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?/i);
  return {
    name,
    externalId: idFromUrl(retailer, pageUrl),
    brand: meta(html, "product:brand") ?? cleanMetadataValue(label(content, "Marca")) ?? laboratory ?? null,
    category,
    regular: ahumadaRegular,
    offer: ahumadaOffer,
    unitPrice: unitMatch?.[1] ? numberValue(unitMatch[1]) : null,
    unit: unitMatch?.[2] ?? null,
    image: meta(html, "og:image"),
    unavailable,
    metadata: { ...metadata, normalPrice: ahumadaRegular, internetPrice: ahumadaOffer },
  };
}

function mapNode(retailer: string, pageUrl: string, node: JsonRecord, sig: Signals): ParsedProduct | null {
  const name = stringValue(node.name) ?? sig.name;
  if (!name) return null;
  const allOffers = offers(node.offers);
  const priced = allOffers
    .map((offer) => ({
      offer,
      price: numberValue(offer.price ?? offer.lowPrice ?? offer.salePrice ?? record(offer.priceSpecification)?.price),
    }))
    .filter((item): item is { offer: JsonRecord; price: number } => item.price !== null && item.price > 0)
    .sort((left, right) => left.price - right.price);
  const selected = priced[0]?.offer ?? allOffers[0] ?? {};
  const jsonLdOffer = priced[0]?.price ?? 0;
  const offerPrice = sig.offer ?? jsonLdOffer;
  if (offerPrice <= 0) return null;

  const explicitRegular = numberValue(
    selected.highPrice ?? selected.listPrice ?? selected.regularPrice ?? record(selected.priceSpecification)?.maxPrice,
  );
  const jsonLdRegular = [explicitRegular, ...priced.map((item) => item.price)]
    .filter((item): item is number => item !== null && item > offerPrice)
    .sort((left, right) => right - left)[0] ?? null;
  let regularPrice: number | null = sig.regular ?? jsonLdRegular;
  if (regularPrice !== null && regularPrice <= offerPrice) regularPrice = null;

  const rawUrl = stringValue(node.url) ?? stringValue(node["@id"]) ?? pageUrl;
  const productUrl = canonicalProductUrl(retailer, absolute(rawUrl, pageUrl), pageUrl);
  const externalId = String(
    node.sku ?? node.productID ?? node.gtin13 ?? node.gtin ?? node.mpn ?? sig.externalId ?? idFromUrl(retailer, productUrl),
  ).trim();
  if (!externalId) return null;
  const sellerValue = selected.seller ?? node.seller ?? node.manufacturer;
  const sellerRecord = record(sellerValue);
  const parent = record(node.isVariantOf);
  const availability = String(selected.availability ?? node.availability ?? "").toLowerCase();
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: stringValue(parent?.sku) ?? stringValue(parent?.productID),
    name,
    brand: brand(node.brand) ?? sig.brand ?? brand(node.manufacturer),
    category: stringValue(node.category) ?? sig.category ?? categoryFromUrl(productUrl),
    seller: stringValue(sellerValue) ?? stringValue(sellerRecord?.name) ?? retailer,
    seller_id: stringValue(sellerRecord?.identifier) ?? stringValue(selected.sellerId),
    variant: stringValue(node.size) ?? stringValue(node.model),
    url: productUrl,
    image_url: image(node.image) ?? sig.image,
    regular_price: regularPrice,
    offer_price: offerPrice,
    unit: sig.unit,
    unit_price: sig.unitPrice,
    in_stock: !sig.unavailable && !availability.includes("outofstock") && !availability.includes("soldout") && !availability.includes("discontinued"),
    observed_at: new Date().toISOString(),
    source_metadata: {
      parser: "pharmacy_json_ld_v2",
      priceCurrency: stringValue(selected.priceCurrency) ?? "CLP",
      pharmacyMetadata: sig.metadata,
      capture_status: "accepted",
    },
  };
}

function fallback(retailer: string, pageUrl: string, html: string, sig: Signals): ParsedProduct | null {
  const name = sig.name ?? meta(html, "og:title");
  const metaPrice = numberValue(meta(html, "product:price:amount"));
  const offer = sig.offer ?? metaPrice;
  if (!name || !offer || offer <= 0) return null;
  const externalId = sig.externalId ?? idFromUrl(retailer, pageUrl);
  if (!externalId) return null;
  const url = canonicalProductUrl(retailer, pageUrl, pageUrl);
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: null,
    name: decode(name),
    brand: sig.brand,
    category: sig.category ?? meta(html, "product:category") ?? categoryFromUrl(url),
    seller: retailer,
    seller_id: null,
    variant: null,
    url,
    image_url: sig.image,
    regular_price: sig.regular && sig.regular > offer ? sig.regular : null,
    offer_price: offer,
    unit: sig.unit,
    unit_price: sig.unitPrice,
    in_stock: !sig.unavailable,
    observed_at: new Date().toISOString(),
    source_metadata: {
      parser: "pharmacy_site_fallback_v2",
      pharmacyMetadata: sig.metadata,
      priceMissing: false,
      capture_status: "accepted",
    },
  };
}

export function parsePharmacyPage(retailer: string, pageUrl: string, html: string, allowFallback: boolean): ParsedProduct[] {
  const output = new Map<string, ParsedProduct>();
  const sig = signals(retailer, html, pageUrl);
  for (const payload of jsonLdPayloads(html)) {
    try {
      for (const node of collectProducts(JSON.parse(payload))) {
        const product = mapNode(retailer, pageUrl, node, sig);
        if (product) output.set(product.external_id, product);
      }
    } catch {
      // Continue through all public structured-data blocks.
    }
  }
  if (!output.size && allowFallback) {
    const product = fallback(retailer, pageUrl, html, sig);
    if (product) output.set(product.external_id, product);
  }
  return [...output.values()];
}