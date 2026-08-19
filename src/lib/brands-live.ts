export type LiveBrandRole = "brand" | "competitor";

export type LiveBrandItem = {
  key: string;
  name: string;
  category: string;
  currentPrice: number;
  regularPrice: number | null;
  discountPct: number | null;
  units: number | null;
  unitPrice: number | null;
  benchmark: string | null;
  benchmarkLabel: string | null;
};

export type LiveBrandSource = {
  role: LiveBrandRole;
  brand: string;
  channel: string;
  location: string;
  url: string;
  status: "ok" | "degraded";
  observedAt: string;
  items: LiveBrandItem[];
  metrics: {
    items: number;
    promoItems: number;
    lowestPrice: number | null;
    maxDiscountPct: number | null;
  };
  error: string | null;
};

export type LiveBrandBenchmark = {
  key: string;
  label: string;
  subject: { brand: string; price: number; unitPrice: number | null };
  competitor: { brand: string; price: number; unitPrice: number | null };
  gapPct: number | null;
  leader: string | null;
  note: string;
};

export type LiveCompetitivePulse = {
  status: "live" | "partial" | "unavailable";
  category: string;
  subjectBrand: string;
  competitorBrand: string;
  channel: string;
  market: string;
  observedAt: string;
  sources: LiveBrandSource[];
  benchmarks: LiveBrandBenchmark[];
};

type ItemSpec = {
  key: string;
  name: string;
  aliases?: string[];
  category: string;
  units?: number;
  benchmark?: string;
  benchmarkLabel?: string;
};

type SourceConfig = {
  role: LiveBrandRole;
  brand: string;
  channel: string;
  location: string;
  urls: string[];
  items: ItemSpec[];
};

type VerticalConfig = {
  category: string;
  subjectBrand: string;
  competitorBrand: string;
  market: string;
  channel: string;
  sources: SourceConfig[];
};

const VERTICALS: Record<string, VerticalConfig> = {
  "krispy-kreme": {
    category: "Doughnuts & Cafetería",
    subjectBrand: "Krispy Kreme",
    competitorBrand: "Dunkin",
    market: "Santiago, Chile",
    channel: "Rappi",
    sources: [
      {
        role: "brand",
        brand: "Krispy Kreme",
        channel: "Rappi",
        location: "Alto Las Condes / Kennedy",
        urls: [
          "https://www.rappi.cl/restaurantes/900094816-krispy-kreme",
          "https://www.rappi.cl/restaurantes/900103402-krispy-kreme",
          "https://www.rappi.cl/restaurantes/900104391-krispy-kreme",
        ],
        items: [
          { key: "kk-3-og", name: "3 Pack Original Glazed", aliases: ["3 pack Original Glazed", "3 Pack Original Glazed"], category: "Packs", units: 3 },
          { key: "kk-6-og", name: "6 Pack Original Glazed", aliases: ["6 Pack Original Glazed", "6Pack Original Glazed"], category: "Packs", units: 6, benchmark: "pack-6", benchmarkLabel: "Pack de 6" },
          { key: "kk-dozen-basic", name: "Escoge tu Docena Basic", aliases: ["Escoge tu Docena Basic"], category: "Packs", units: 12, benchmark: "pack-12", benchmarkLabel: "Pack de 12" },
          { key: "kk-dozen-select", name: "Escoge tu Docena Select", aliases: ["Escoge tu Docena Select"], category: "Packs", units: 12 },
          { key: "kk-basic-plus-og", name: "Docena Basic + Docena OG", aliases: ["Docena Basic + Docena OG"], category: "Promociones", units: 24, benchmark: "pack-24", benchmarkLabel: "Pack de 24" },
          { key: "kk-select-plus-og", name: "Docena Select + Docena OG", aliases: ["Docena Select + Docena OG"], category: "Promociones", units: 24 },
          { key: "kk-complemento", name: "Complemento Perfecto", aliases: ["Complemento Perfecto"], category: "Combos" },
        ],
      },
      {
        role: "competitor",
        brand: "Dunkin",
        channel: "Rappi",
        location: "Alto Las Condes / Kennedy",
        urls: [
          "https://www.rappi.cl/restaurantes/900016060-dunkin",
          "https://www.rappi.cl/restaurantes/900019742-dunkin",
        ],
        items: [
          { key: "dunkin-unit", name: "Donut", aliases: ["Donut", "Donut (Unidad)"], category: "Donuts", units: 1 },
          { key: "dunkin-6", name: "Donuts x6 (paga 5)", aliases: ["Donuts x6 (paga 5)", "6 Donuts Classic (Paga 5)", "Donuts x6"], category: "Packs", units: 6, benchmark: "pack-6", benchmarkLabel: "Pack de 6" },
          { key: "dunkin-12", name: "Donuts x12 (paga 9)", aliases: ["Donuts x12 (paga 9)", "12 Donuts Classic (paga 9)", "Donuts x12"], category: "Packs", units: 12, benchmark: "pack-12", benchmarkLabel: "Pack de 12" },
          { key: "dunkin-24", name: "24 Donuts (paga 16)", aliases: ["24 Donuts (paga 16)", "24 Donuts Classic (Paga 16)", "24 Donuts Classic Eleccion"], category: "Packs", units: 24, benchmark: "pack-24", benchmarkLabel: "Pack de 24" },
          { key: "dunkin-hotd-6", name: "Caja 6 donuts edición limitada", aliases: ["Caja 6 donuts House of the Dragon"], category: "Edición limitada", units: 6 },
          { key: "dunkin-hotd-12", name: "Caja 12 donuts edición limitada", aliases: ["Caja 12 donuts House of the Dragon"], category: "Edición limitada", units: 12 },
        ],
      },
    ],
  },
  "little-caesars": {
    category: "Pizza QSR",
    subjectBrand: "Little Caesars",
    competitorBrand: "Papa Johns",
    market: "Santiago, Chile",
    channel: "Rappi",
    sources: [
      {
        role: "brand",
        brand: "Little Caesars",
        channel: "Rappi",
        location: "Vitacura / Las Condes",
        urls: [
          "https://www.rappi.cl/restaurantes/900015160-little-caesars-pizza",
          "https://www.rappi.cl/restaurantes/900025168-little-caesars-pizza",
        ],
        items: [
          { key: "lc-pepperoni", name: "Classic Pepperoni Familiar", aliases: ["Classic Pepperoni Familiar", "Classic Pepperoni"], category: "Pizzas clásicas", units: 1, benchmark: "pepperoni-familiar", benchmarkLabel: "Pepperoni familiar" },
          { key: "lc-cheese", name: "Classic Cheese Familiar", aliases: ["Classic Cheese Familiar", "Classic Cheese"], category: "Pizzas clásicas", units: 1 },
          { key: "lc-extra-pepperoni", name: "Extra Pepperoni Familiar", aliases: ["Extra Pepperoni Familiar", "Extra Pepperoni"], category: "Especialidades", units: 1 },
          { key: "lc-duo-duo", name: "Duo Duo Familiar", aliases: ["Duo Duo Familiar"], category: "Edición limitada", units: 1 },
          { key: "lc-duo-combo", name: "Combo Duo Duo", aliases: ["Combo Duo Duo"], category: "Combos", units: 1 },
          { key: "lc-ultimate-pair", name: "Ultimate Supreme + Classic Cheese", aliases: ["Ultimate Supreme + Classic Cheese"], category: "Combos", units: 2 },
          { key: "lc-trio", name: "Trio Perfecto", aliases: ["Trio Perfecto"], category: "Combos", units: 3 },
        ],
      },
      {
        role: "competitor",
        brand: "Papa Johns",
        channel: "Rappi",
        location: "Vitacura / Las Condes",
        urls: [
          "https://www.rappi.cl/restaurantes/900017927-papa-johns-pizza",
          "https://www.rappi.cl/restaurantes/900017926-papa-johns-pizza",
        ],
        items: [
          { key: "pj-pepperoni", name: "Pizza Super Pepperoni", aliases: ["Pizza Super Pepperoni", "Super Pepperoni Familiar"], category: "Pizzas familiares", units: 1, benchmark: "pepperoni-familiar", benchmarkLabel: "Pepperoni familiar" },
          { key: "pj-rappi-pizza", name: "Rappi Pizza", aliases: ["Rappi Pizza"], category: "Pizzas familiares", units: 1 },
          { key: "pj-discount", name: "Descuentos Locos", aliases: ["Descuentos Locos"], category: "Promociones", units: 1 },
          { key: "pj-dupla", name: "Dupla de Familiares + Bebida", aliases: ["Dupla de Familiares + Bebida"], category: "Combos", units: 2 },
          { key: "pj-combo-month", name: "Combo Del Mes", aliases: ["Combo Del Mes"], category: "Combos", units: 1 },
          { key: "pj-lunch", name: "Combo Lunch", aliases: ["Combo Lunch"], category: "Combos", units: 1 },
        ],
      },
    ],
  },
};

function decodeText(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function searchableText(html: string) {
  return decodeText(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseClp(raw: string | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 500 && parsed <= 300_000 ? parsed : null;
}

function priceCandidate(segment: string) {
  const moneyMatches = Array.from(segment.matchAll(/\$\s*([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{3,6})/g));
  const prices = moneyMatches
    .map(match => ({ value: parseClp(match[1]), index: match.index ?? Number.MAX_SAFE_INTEGER }))
    .filter((value): value is { value: number; index: number } => value.value != null);
  if (prices.length) return prices;

  const jsonMatches = Array.from(segment.matchAll(/(?:currentPrice|salePrice|price)["'\\:\s]+([0-9]{3,6})/gi));
  return jsonMatches
    .map(match => ({ value: parseClp(match[1]), index: match.index ?? Number.MAX_SAFE_INTEGER }))
    .filter((value): value is { value: number; index: number } => value.value != null);
}

function findItem(text: string, spec: ItemSpec): LiveBrandItem | null {
  const lower = text.toLowerCase();
  const aliases = [spec.name, ...(spec.aliases || [])];
  let best: { current: number; regular: number | null; discount: number | null; distance: number } | null = null;

  for (const alias of aliases) {
    const needle = alias.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const found = lower.indexOf(needle, cursor);
      if (found < 0) break;
      const segment = text.slice(found + alias.length, found + alias.length + 1050);
      const candidates = priceCandidate(segment);
      if (candidates.length) {
        const current = candidates[0].value;
        const regular = candidates.slice(1, 4).map(value => value.value).find(value => value > current && value <= current * 2.5) ?? null;
        const prefix = segment.slice(0, Math.min(candidates[0].index + 20, 180));
        const explicit = prefix.match(/-\s*([0-9]{1,2})\s*%/);
        const calculated = regular && regular > current ? Math.round((1 - current / regular) * 100) : null;
        const discount = explicit ? Number(explicit[1]) : calculated;
        const result = { current, regular, discount, distance: candidates[0].index };
        if (!best || result.distance < best.distance) best = result;
      }
      cursor = found + needle.length;
    }
  }

  if (!best) return null;
  const units = spec.units && spec.units > 0 ? spec.units : null;
  return {
    key: spec.key,
    name: spec.name,
    category: spec.category,
    currentPrice: best.current,
    regularPrice: best.regular,
    discountPct: best.discount,
    units,
    unitPrice: units ? Math.round(best.current / units) : null,
    benchmark: spec.benchmark || null,
    benchmarkLabel: spec.benchmarkLabel || null,
  };
}

function metrics(items: LiveBrandItem[]) {
  const discounts = items.map(item => item.discountPct).filter((value): value is number => value != null && value > 0);
  return {
    items: items.length,
    promoItems: discounts.length,
    lowestPrice: items.length ? Math.min(...items.map(item => item.currentPrice)) : null,
    maxDiscountPct: discounts.length ? Math.max(...discounts) : null,
  };
}

async function fetchSource(config: SourceConfig): Promise<LiveBrandSource> {
  const observedAt = new Date().toISOString();
  let lastError = "No fue posible leer la fuente.";
  let usedUrl = config.urls[0];

  for (const url of config.urls) {
    usedUrl = url;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "es-CL,es;q=0.9",
          "user-agent": "Mozilla/5.0 (compatible; MGPPriceMonitor/2.0; +https://mgpconsultoria.cl)",
        },
        signal: AbortSignal.timeout(9_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const text = searchableText(html);
      const items = config.items.map(spec => findItem(text, spec)).filter((item): item is LiveBrandItem => Boolean(item));
      if (!items.length) throw new Error("La fuente respondió, pero no expuso precios parseables.");
      return {
        role: config.role,
        brand: config.brand,
        channel: config.channel,
        location: config.location,
        url,
        status: "ok",
        observedAt,
        items,
        metrics: metrics(items),
        error: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    role: config.role,
    brand: config.brand,
    channel: config.channel,
    location: config.location,
    url: usedUrl,
    status: "degraded",
    observedAt,
    items: [],
    metrics: metrics([]),
    error: lastError,
  };
}

function buildBenchmarks(sources: LiveBrandSource[]): LiveBrandBenchmark[] {
  const subject = sources.find(source => source.role === "brand");
  const competitor = sources.find(source => source.role === "competitor");
  if (!subject || !competitor) return [];

  const left = new Map(subject.items.filter(item => item.benchmark).map(item => [item.benchmark, item]));
  const right = new Map(competitor.items.filter(item => item.benchmark).map(item => [item.benchmark, item]));
  const keys = Array.from(left.keys()).filter((key): key is string => Boolean(key && right.has(key)));

  return keys.map(key => {
    const a = left.get(key)!;
    const b = right.get(key)!;
    const aValue = a.unitPrice ?? a.currentPrice;
    const bValue = b.unitPrice ?? b.currentPrice;
    const gapPct = bValue > 0 ? Math.round(((aValue - bValue) / bValue) * 1000) / 10 : null;
    return {
      key,
      label: a.benchmarkLabel || b.benchmarkLabel || key,
      subject: { brand: subject.brand, price: a.currentPrice, unitPrice: a.unitPrice },
      competitor: { brand: competitor.brand, price: b.currentPrice, unitPrice: b.unitPrice },
      gapPct,
      leader: aValue === bValue ? "Empate" : aValue < bValue ? subject.brand : competitor.brand,
      note: key === "pepperoni-familiar" ? "Benchmark direccional: las recetas y toppings no son idénticos." : "Comparación por formato equivalente; delivery puede variar por local y promoción.",
    };
  });
}

export function supportsLiveBrand(slug: string) {
  return Boolean(VERTICALS[slug]);
}

export async function getLiveCompetitivePulse(slug: string): Promise<LiveCompetitivePulse | null> {
  const config = VERTICALS[slug];
  if (!config) return null;

  const sources = await Promise.all(config.sources.map(fetchSource));
  const ok = sources.filter(source => source.status === "ok").length;
  return {
    status: ok === sources.length ? "live" : ok > 0 ? "partial" : "unavailable",
    category: config.category,
    subjectBrand: config.subjectBrand,
    competitorBrand: config.competitorBrand,
    channel: config.channel,
    market: config.market,
    observedAt: new Date().toISOString(),
    sources,
    benchmarks: buildBenchmarks(sources),
  };
}
