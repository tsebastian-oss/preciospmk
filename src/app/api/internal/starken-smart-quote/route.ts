import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const CITY_URL = "https://gateway.starken.cl/agency/city";
const QUOTE_URL = "https://gateway.starken.cl/quote/cotizador";

type City = Record<string, unknown>;
type QuoteInput = {
  origin: string;
  destination: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  deliveryType?: "DOMICILIO" | "AGENCIA";
  packageType?: "PAQUETE" | "DOCUMENTO";
  service?: string;
};

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(request: NextRequest) {
  const supplied = request.headers.get("x-chilexpress-worker-token") || "";
  if (!supplied) return false;
  const actual = await sha256(supplied);
  if (actual.length !== TOKEN_SHA256.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ TOKEN_SHA256.charCodeAt(i);
  return diff === 0;
}

function unwrapCities(payload: unknown): City[] {
  if (Array.isArray(payload)) return payload as City[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "response", "cities", "result"]) {
    if (Array.isArray(obj[key])) return obj[key] as City[];
  }
  return [];
}

function cityName(city: City) {
  for (const key of ["city", "ciudad", "name", "nombre", "label"]) {
    const value = city[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function cityCode(city: City) {
  for (const key of ["code_dls", "codigo", "id", "code", "value"]) {
    const value = city[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function findCity(cities: City[], requested: string) {
  const target = normalize(requested);
  const exact = cities.find((city) => normalize(cityName(city)) === target);
  if (exact) return exact;
  const starts = cities.find((city) => {
    const current = normalize(cityName(city));
    return current.startsWith(target) || target.startsWith(current);
  });
  if (starts) return starts;
  return cities.find((city) => normalize(JSON.stringify(city)).includes(target)) ?? null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(payload: unknown): number | null {
  const candidates: Array<{ key: string; value: number }> = [];
  function walk(value: unknown, path: string, depth: number) {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 20); i += 1) walk(value[i], path + "[" + i + "]", depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? path + "." + key : key;
      if (/(valor.*flete|flete|tarifa|precio|total)/i.test(key)) {
        const n = numeric(next);
        if (n) candidates.push({ key: p, value: n });
      }
      if (typeof next === "object" && next !== null) walk(next, p, depth + 1);
    }
  }
  walk(payload, "", 0);
  const priority = candidates.sort((a, b) => {
    const score = (x: string) => /valor.*flete/i.test(x) ? 0 : /flete/i.test(x) ? 1 : /tarifa|precio/i.test(x) ? 2 : 3;
    return score(a.key) - score(b.key) || a.value - b.value;
  });
  return priority[0]?.value ?? null;
}

function textField(payload: unknown, keys: RegExp) {
  let found: string | null = null;
  function walk(value: unknown, depth: number) {
    if (found || depth > 4 || value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      if (keys.test(key) && (typeof next === "string" || typeof next === "number")) {
        found = String(next);
        return;
      }
      if (typeof next === "object") walk(next, depth + 1);
    }
  }
  walk(payload, 0);
  return found;
}

async function quoteOne(cities: City[], input: QuoteInput) {
  const originCity = findCity(cities, input.origin);
  const destinationCity = findCity(cities, input.destination);
  const originCode = cityCode(originCity ?? {});
  const destinationCode = cityCode(destinationCity ?? {});
  if (!originCity || !destinationCity || originCode == null || destinationCode == null) {
    return { ok: false, input, error: "city_not_resolved", originCity, destinationCity };
  }

  const body = {
    alto: input.heightCm,
    ancho: input.widthCm,
    bulto: input.packageType || "PAQUETE",
    destino: destinationCode,
    entrega: input.deliveryType || "DOMICILIO",
    kilos: input.weightKg,
    largo: input.lengthCm,
    origen: originCode,
    servicio: input.service || "NORMAL",
  };

  const response = await fetch(QUOTE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  const rawText = await response.text();
  let payload: unknown = rawText.slice(0, 2500);
  try { payload = JSON.parse(rawText); } catch {}
  const priceClp = response.ok ? extractPrice(payload) : null;

  return {
    ok: response.ok && !!priceClp,
    status: response.status,
    input,
    origin: cityName(originCity),
    destination: cityName(destinationCity),
    originCode,
    destinationCode,
    priceClp,
    deliveryType: input.deliveryType || "DOMICILIO",
    serviceType: textField(payload, /(servicio|service)/i) || input.service || "NORMAL",
    deliveryLabel: textField(payload, /(entrega|delivery)/i) || input.deliveryType || "DOMICILIO",
    eta: textField(payload, /(fecha|plazo|dias|eta)/i),
    raw: payload,
  };
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const quotes: QuoteInput[] = Array.isArray(body?.quotes) ? body.quotes.slice(0, 30) : [];
    if (!quotes.length) return NextResponse.json({ error: "quotes_required" }, { status: 400 });

    const cityResponse = await fetch(CITY_URL, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const cityText = await cityResponse.text();
    let cityPayload: unknown = null;
    try { cityPayload = JSON.parse(cityText); } catch {}
    const cities = unwrapCities(cityPayload);
    if (!cityResponse.ok || !cities.length) {
      return NextResponse.json({ error: "starken_city_catalog_unavailable", status: cityResponse.status }, { status: 502 });
    }

    const results: unknown[] = [];
    for (let i = 0; i < quotes.length; i += 2) {
      const batch = quotes.slice(i, i + 2);
      results.push(...await Promise.all(batch.map((item) => quoteOne(cities, item))));
      if (i + 2 < quotes.length) await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const accepted = results.filter((item: any) => item?.ok && Number(item?.priceClp) > 0).length;
    return NextResponse.json({
      ok: true,
      cityCount: cities.length,
      requested: quotes.length,
      accepted,
      results,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
