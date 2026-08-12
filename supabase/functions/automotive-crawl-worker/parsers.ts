export type AutomotiveProduct = {
  external_id: string;
  source_key: string;
  brand: string;
  model: string;
  version: string;
  name: string;
  body_type: string;
  url: string;
  list_price: number | null;
  cash_price: number | null;
  final_price: number | null;
  metadata: Record<string, unknown>;
};

export type QueueItem = {
  kind: "automotive_dealer_catalog" | "automotive_model_page";
  stage: string;
  url: string;
  task_key: string;
};

const DERCO_BRANDS = ["Suzuki", "Mazda", "GWM", "Avatr", "Deepal", "Changan", "DFSK"];
const SALFA_BRANDS = ["Chevrolet", "Chery", "GAC", "Jaecoo", "JMC", "KGM", "Kia", "Mitsubishi", "Nissan", "Omoda", "Toyota"];
const POMPEYO_BRANDS = ["Nissan", "Peugeot", "MG", "Kia", "Subaru", "Geely", "Opel", "DFSK", "Landking", "Leapmotor", "Dongfeng", "Citroën", "Sinotruk"];
const GUILLERMO_BRANDS = [
  "Citroën", "Jetour", "GAC", "RAM", "Fiat", "Soueast", "Peugeot", "Opel", "JMC", "Jeep",
  "Mitsubishi", "Nissan", "Chery", "Kia", "MG", "DFSK", "Geely", "Subaru", "KGM", "Toyota",
  "Hyundai", "Ford", "Volkswagen", "Maxus", "Omoda", "Jaecoo", "Dongfeng", "Leapmotor",
];

export function clean(value: unknown, max = 220) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}

function canonicalBrand(value: string) {
  const normalized = slug(value);
  const aliases: Record<string, string> = {
    citroen: "Citroën", gac: "GAC", gwm: "GWM", jmc: "JMC", kgm: "KGM", mg: "MG", ram: "RAM",
    dfsk: "DFSK", soueast: "Soueast", jeep: "Jeep", fiat: "Fiat", opel: "Opel", peugeot: "Peugeot",
    mitsubishi: "Mitsubishi", nissan: "Nissan", jetour: "Jetour", geely: "Geely", subaru: "Subaru",
    toyota: "Toyota", hyundai: "Hyundai", ford: "Ford", volkswagen: "Volkswagen", maxus: "Maxus",
    chery: "Chery", kia: "Kia", omoda: "Omoda", jaecoo: "Jaecoo", dongfeng: "Dongfeng", leapmotor: "Leapmotor",
  };
  return aliases[normalized] ?? titleCase(value);
}

function price(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, raw) => {
      const code = Number.parseInt(raw, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button|option)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function lines(html: string) {
  return htmlToText(html).split("\n").map((line) => clean(line, 500)).filter(Boolean);
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function links(html: string, base: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], base);
    if (url) found.add(url.split("#")[0]);
  }
  return [...found];
}

function metaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return null;
}

function firstHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return match?.[1] ? clean(htmlToText(match[1])) : "";
}

function valueAfter(block: string, label: string) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*\\$?\\s*([0-9.]+)`, "i");
  return price(block.match(pattern)?.[1]);
}

function nearestBrand(rows: string[], start: number, brands: string[], depth = 12) {
  for (let index = start; index >= Math.max(0, start - depth); index--) {
    const row = rows[index];
    const found = brands.find((brand) => row.localeCompare(brand, "es", { sensitivity: "base" }) === 0 || row.toLocaleLowerCase("es-CL").startsWith(`${brand.toLocaleLowerCase("es-CL")} `));
    if (found) return { brand: found, index };
  }
  return null;
}

function makeProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, listPrice: number | null, cashPrice: number | null, finalPrice: number | null, metadata: Record<string, unknown>): AutomotiveProduct | null {
  brand = clean(brand, 100);
  model = clean(model, 180);
  version = clean(version, 220) || "Precio desde";
  if (!brand || !model || !(finalPrice && finalPrice > 0)) return null;
  return {
    external_id: `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`,
    source_key: sourceKey,
    brand,
    model,
    version,
    name: `${brand} ${model} · ${version}`,
    body_type: "Vehículo",
    url,
    list_price: listPrice ?? cashPrice ?? finalPrice,
    cash_price: cashPrice ?? finalPrice,
    final_price: finalPrice,
    metadata: { parser: sourceKey, dealer, source_type: "dealer", capture_scope: "pricing_only", ...metadata },
  };
}

function rosselotDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base).filter((value) => {
    try { const url = new URL(value); const parts = url.pathname.split("/").filter(Boolean); return /(^|\.)rosselot\.cl$/i.test(url.hostname) && parts[0] === "nuevos" && parts.length >= 3; } catch { return false; }
  }).slice(0, 600).map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function salazarDiscovery(html: string, base: string, stage: string): QueueItem[] {
  const all = links(html, base).filter((value) => { try { return /(^|\.)salazarisrael\.cl$/i.test(new URL(value).hostname); } catch { return false; } });
  if (stage === "root") return all.filter((value) => /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(value).pathname)).slice(0, 160).map((url) => ({ kind: "automotive_dealer_catalog", stage: "brand", url, task_key: `brand-${slug(new URL(url).pathname)}` }));
  return all.filter((value) => /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(new URL(value).pathname)).slice(0, 500).map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function portilloDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base).filter((value) => { try { const url = new URL(value); return /(^|\.)portillo\.cl$/i.test(url.hostname) && /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(url.pathname); } catch { return false; } }).slice(0, 400).map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function pompeyoDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base).filter((value) => { try { const url = new URL(value); return /(^|\.)pompeyo\.cl$/i.test(url.hostname) && /^\/producto\/[^/?#]+\/?$/i.test(url.pathname); } catch { return false; } }).slice(0, 400).map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function guillermoDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base).filter((value) => {
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      return /(^|\.)guillermomorales\.cl$/i.test(url.hostname) && parts[0] === "autos-nuevos" && parts.length === 3 && !["tipo", "ofertas"].includes(parts[1]);
    } catch { return false; }
  }).slice(0, 500).map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function parseRosselot(html: string, url: string, sourceKey: string, dealer: string) {
  const text = htmlToText(html), path = new URL(url).pathname.split("/").filter(Boolean), versionHeading = text.match(/Versiones\s+([^,\n]+),\s*([^\n]+)/i);
  const brand = clean(versionHeading?.[1]) || titleCase(path[1] ?? ""), model = clean(versionHeading?.[2]) || clean(firstHeading(html)) || titleCase(path[2] ?? "");
  const markers = [...text.matchAll(/\nPrecio de Lista:\s*\$?\s*([0-9.]+)/gi)], products: AutomotiveProduct[] = [];
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index], before = text.slice(0, marker.index ?? 0).split("\n").filter(Boolean), version = clean(before.at(-1), 180);
    if (!version || /precios|versiones/i.test(version)) continue;
    const blockEnd = index + 1 < markers.length ? markers[index + 1].index ?? text.length : text.length, block = text.slice(marker.index ?? 0, blockEnd);
    const listPrice = price(marker[1]), brandBonus = valueAfter(block, "Bono Marca") ?? 0, onlineBonus = valueAfter(block, "Bono Online") ?? 0, dealerBonus = valueAfter(block, "Bono exclusivo Rosselot") ?? 0;
    const cashPrice = valueAfter(block, "Precio Contado") ?? (listPrice ? Math.max(0, listPrice - brandBonus - onlineBonus - dealerBonus) : null), financeBonus = valueAfter(block, "Bono Financiamiento") ?? 0, finalPrice = cashPrice ? Math.max(0, cashPrice - financeBonus) : listPrice;
    const product = makeProduct(sourceKey, dealer, brand, model, version, url, listPrice, cashPrice, finalPrice, { price_confidence: "explicit", brand_bonus: brandBonus, online_bonus: onlineBonus, dealer_bonus: dealerBonus, finance_bonus: financeBonus });
    if (product) products.push(product);
  }
  return products;
}

function parseSalazar(html: string, url: string, sourceKey: string, dealer: string) {
  const text = htmlToText(html), path = new URL(url).pathname.split("/").filter(Boolean), brand = titleCase(path[1] ?? "");
  const heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[3] ?? ""), model = clean(heading.replace(/^Nuevo\s+/i, "").replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/\s+Salazar Israel.*$/i, "").replace(/^Nueva?\s+/i, ""), 160) || titleCase(path[3] ?? "");
  const advertised = price(text.match(/(?:Desde|Precio(?:\s+desde)?)\s*\$?\s*([0-9.]+)/i)?.[1]), bonus = price(text.match(/Incluye\s+bono(?:\s+de)?\s*\$?\s*([0-9.]+)/i)?.[1]) ?? 0, listPrice = advertised && bonus ? advertised + bonus : advertised;
  const product = makeProduct(sourceKey, dealer, brand, model, "Precio desde", url, listPrice, advertised, advertised, { price_confidence: "advertised_from", list_price_derived: Boolean(advertised && bonus), brand_bonus: bonus, online_bonus: 0, dealer_bonus: 0, finance_bonus: 0 });
  return product ? [product] : [];
}

function parseDercocenter(html: string, url: string, sourceKey: string, dealer: string) {
  const rows = lines(html), products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Precio Lista\s*:/i.test(rows[index])) continue;
    const listPrice = price(rows[index]); let finalIndex = index - 1;
    while (finalIndex >= Math.max(0, index - 8) && !price(rows[finalIndex])) finalIndex--;
    if (finalIndex < 0) continue;
    const finalPrice = price(rows[finalIndex]), brandHit = nearestBrand(rows, finalIndex - 1, DERCO_BRANDS, 12);
    if (!brandHit || !finalPrice) continue;
    const candidates = rows.slice(brandHit.index + 1, finalIndex).filter((row) => !/^(SUV|Sed[aá]n|Hatchback|Pickup|Camioneta|El[eé]ctrico|H[ií]brido|Gasolina|Di[eé]sel|DCTO|Descuento|Destacado)/i.test(row) && !/%|\$/.test(row));
    const model = clean(candidates[0], 160), version = clean(candidates[1] ?? "Precio desde", 220); if (!model) continue;
    const block = rows.slice(index, Math.min(rows.length, index + 8)).join("\n"), financeBonus = valueAfter(block, "Bono Financiamiento") ?? 0, brandBonus = valueAfter(block, "Bono Marca") ?? 0, dealerBonus = valueAfter(block, "Bono Días 0KM") ?? valueAfter(block, "Bono Días 0 Km") ?? 0;
    const derivedCash = listPrice ? Math.max(0, listPrice - brandBonus - dealerBonus) : finalPrice + financeBonus, cashPrice = derivedCash > 0 ? derivedCash : finalPrice + financeBonus;
    const product = makeProduct(sourceKey, dealer, brandHit.brand, model, version, url, listPrice, cashPrice, finalPrice, { price_confidence: "explicit_listing", brand_bonus: brandBonus, online_bonus: 0, dealer_bonus: dealerBonus, finance_bonus: financeBonus || Math.max(0, cashPrice - finalPrice) });
    if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parseSalfa(html: string, url: string, sourceKey: string, dealer: string) {
  const rows = lines(html), products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Con financiamiento desde$/i.test(rows[index])) continue;
    const finalPrice = price(rows[index + 1]); if (!finalPrice) continue;
    const brandHit = nearestBrand(rows, index - 1, SALFA_BRANDS, 8); if (!brandHit) continue;
    const candidates = rows.slice(brandHit.index + 1, index).filter((row) => !/^(Autos|Camionetas|SUV|Ver|Cotizar|Nuevo)/i.test(row) && !/\$|%/.test(row)), model = clean(candidates.at(-1), 180); if (!model) continue;
    let cashPrice: number | null = null; for (let cursor = index + 2; cursor <= Math.min(rows.length - 1, index + 6); cursor++) if (/Precio contado/i.test(rows[cursor])) { cashPrice = price(rows[cursor + 1]); break; }
    cashPrice = cashPrice ?? finalPrice; const financeBonus = Math.max(0, cashPrice - finalPrice);
    const product = makeProduct(sourceKey, dealer, brandHit.brand, model, "Precio desde", url, cashPrice, cashPrice, finalPrice, { price_confidence: "advertised_from", brand_bonus: 0, online_bonus: 0, dealer_bonus: 0, finance_bonus: financeBonus });
    if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parsePortillo(html: string, url: string, sourceKey: string, dealer: string) {
  const path = new URL(url).pathname.split("/").filter(Boolean), brand = titleCase(path[1] ?? ""), heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[3] ?? "");
  const model = clean(heading.replace(/^Nuevo\s+/i, "").replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/\s+Portillo.*$/i, ""), 180) || titleCase(path[3] ?? ""), text = htmlToText(html);
  const finalPrice = price(text.match(/(?:Desde|Precio(?:\s+desde)?)\s*\$?\s*([0-9.]+)/i)?.[1]), advertisedBonus = price(text.match(/Incluye\s+bono(?:\s+de)?\s*\$?\s*([0-9.]+)/i)?.[1]) ?? 0, listPrice = finalPrice && advertisedBonus ? finalPrice + advertisedBonus : finalPrice;
  const product = makeProduct(sourceKey, dealer, brand, model, "Precio desde", url, listPrice, finalPrice, finalPrice, { price_confidence: "advertised_from", list_price_derived: Boolean(finalPrice && advertisedBonus), brand_bonus: 0, online_bonus: 0, dealer_bonus: advertisedBonus, finance_bonus: 0 });
  return product ? [product] : [];
}

function detectPompeyoIdentity(rows: string[], priceIndex: number) {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 6); index--) {
    const row = rows[index].replace(/^Nuevo\s+/i, "").trim();
    for (const brand of POMPEYO_BRANDS) {
      if (row.localeCompare(brand, "es", { sensitivity: "base" }) === 0) { const next = rows[index + 1] && index + 1 < priceIndex ? rows[index + 1].replace(/^Nuevo\s+/i, "").trim() : ""; if (next) return { brand, model: next }; }
      const lowered = row.toLocaleLowerCase("es-CL"), brandLower = brand.toLocaleLowerCase("es-CL"); if (lowered.startsWith(brandLower) && row.length > brand.length) { const rest = row.slice(brand.length).replace(/^\s*[-|·:]?\s*/, "").replace(/^Nuevo\s+/i, "").trim(); if (rest) return { brand, model: rest }; }
    }
  }
  return null;
}

function parsePompeyo(html: string, url: string, sourceKey: string, dealer: string) {
  const rows = lines(html), products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    const finalPrice = price(rows[index]); if (!finalPrice || !/^\$?\s*[0-9.$]+(?:\s|$)/.test(rows[index])) continue;
    const identity = detectPompeyoIdentity(rows, index); if (!identity) continue;
    const product = makeProduct(sourceKey, dealer, identity.brand, identity.model, "Precio desde", url, finalPrice, finalPrice, finalPrice, { price_confidence: "advertised_from", brand_bonus: 0, online_bonus: 0, dealer_bonus: 0, finance_bonus: 0 }); if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parseGuillermoRoot(html: string, url: string, sourceKey: string, dealer: string) {
  const rows = lines(html), products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Precio Desde$/i.test(rows[index])) continue;
    const finalPrice = price(rows[index + 1]); if (!finalPrice) continue;
    const brandHit = nearestBrand(rows, index - 1, GUILLERMO_BRANDS, 6); if (!brandHit) continue;
    const candidates = rows.slice(brandHit.index + 1, index).filter((row) => !/^(SUV|Camionetas|Hatchback|Sed[aá]n|El[eé]ctrico|Comerciales|Auto Nuevo|Nuevo)$/i.test(row) && !/\$|%/.test(row));
    const model = clean(candidates[0], 180); if (!model) continue;
    const product = makeProduct(sourceKey, dealer, brandHit.brand, model, "Precio desde", url, finalPrice, finalPrice, finalPrice, { price_confidence: "advertised_from_bonuses_included", brand_bonus: 0, online_bonus: 0, dealer_bonus: 0, finance_bonus: 0 }); if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parseGuillermoDetail(html: string, url: string, sourceKey: string, dealer: string) {
  const rows = lines(html), path = new URL(url).pathname.split("/").filter(Boolean), brand = canonicalBrand(path[1] ?? ""), heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[2] ?? "");
  const model = clean(heading.replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/\s+Guillermo Morales.*$/i, ""), 180) || titleCase(path[2] ?? ""), products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Precio lista\s*:/i.test(rows[index])) continue;
    const listPrice = price(rows[index]); if (!listPrice) continue;
    let finalIndex = index - 1; while (finalIndex >= Math.max(0, index - 6) && !price(rows[finalIndex])) finalIndex--; if (finalIndex < 0) continue;
    const finalPrice = price(rows[finalIndex]); if (!finalPrice) continue;
    const condition = rows.slice(finalIndex + 1, index).join(" ").toLowerCase();
    let version = "Precio desde";
    for (let cursor = finalIndex - 1; cursor >= Math.max(0, finalIndex - 6); cursor--) {
      const candidate = rows[cursor];
      if (!candidate || /^(COTIZAR|RESERVAR|Precio|Precios|Versiones|Combustible|Transmisi[oó]n|Cilindrada|SUV|Camionetas|Hatchback|Sed[aá]n|Comerciales)$/i.test(candidate)) continue;
      if (candidate.localeCompare(heading, "es", { sensitivity: "base" }) === 0 || candidate.localeCompare(model, "es", { sensitivity: "base" }) === 0 || candidate.localeCompare(brand, "es", { sensitivity: "base" }) === 0) continue;
      if (/\$|%/.test(candidate)) continue;
      version = clean(candidate, 220); break;
    }
    const totalBonus = Math.max(0, listPrice - finalPrice), financeBonus = condition.includes("financ") ? totalBonus : 0, dealerBonus = financeBonus ? 0 : totalBonus;
    const product = makeProduct(sourceKey, dealer, brand, model, version, url, listPrice, listPrice, finalPrice, { price_confidence: "explicit_detail", brand_bonus: 0, online_bonus: 0, dealer_bonus: dealerBonus, finance_bonus: financeBonus }); if (product) products.push(product);
  }
  if (products.length) return [...new Map(products.map((product) => [product.external_id, product])).values()];
  const text = htmlToText(html), finalPrice = price(text.match(/Precio Desde\s*\$?\s*([0-9.]+)/i)?.[1]);
  const fallback = makeProduct(sourceKey, dealer, brand, model, "Precio desde", url, finalPrice, finalPrice, finalPrice, { price_confidence: "advertised_from", brand_bonus: 0, online_bonus: 0, dealer_bonus: 0, finance_bonus: 0 });
  return fallback ? [fallback] : [];
}

export function discover(parser: string, html: string, url: string, stage: string): QueueItem[] {
  if (parser === "rosselot") return rosselotDiscovery(html, url);
  if (parser === "salazar_israel") return salazarDiscovery(html, url, stage);
  if (parser === "portillo") return portilloDiscovery(html, url);
  if (parser === "pompeyo") return pompeyoDiscovery(html, url);
  if (parser === "guillermo_morales") return guillermoDiscovery(html, url);
  return [];
}

export function parseProducts(parser: string, html: string, url: string, sourceKey: string, dealer: string, kind: "automotive_dealer_catalog" | "automotive_model_page") {
  if (parser === "rosselot") return parseRosselot(html, url, sourceKey, dealer);
  if (parser === "salazar_israel") return parseSalazar(html, url, sourceKey, dealer);
  if (parser === "dercocenter") return parseDercocenter(html, url, sourceKey, dealer);
  if (parser === "salfa_automotriz") return parseSalfa(html, url, sourceKey, dealer);
  if (parser === "portillo") return parsePortillo(html, url, sourceKey, dealer);
  if (parser === "pompeyo") return parsePompeyo(html, url, sourceKey, dealer);
  if (parser === "guillermo_morales") return kind === "automotive_dealer_catalog" ? parseGuillermoRoot(html, url, sourceKey, dealer) : parseGuillermoDetail(html, url, sourceKey, dealer);
  return [];
}
