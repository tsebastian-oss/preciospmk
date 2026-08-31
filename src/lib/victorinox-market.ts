import { clickHouseQuery } from "@/lib/clickhouse";
import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";

type RawRow = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  category: string;
  smart_category: string;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean;
  observed_at: string | null;
  url: string;
};

export type VictorinoxMarketRow = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  category: string;
  currentPrice: number;
  regularPrice: number | null;
  promotionPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string;
};

export type VictorinoxSummaryRow = {
  category: string;
  brand: string;
  skuCount: number;
  retailers: number;
  averagePrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  promoPct: number;
};

const WATCH = new Set(["victorinox","tissot","seiko","citizen"]);
const TRAVEL = new Set(["victorinox","samsonite","american tourister","saxoline"]);
const TOOLS = new Set(["victorinox","leatherman"]);
const KNIVES = new Set(["victorinox","arcos","global","zwilling","tramontina","wusthof","wüsthof"]);
const ALL = [...new Set([...WATCH,...TRAVEL,...TOOLS,...KNIVES])];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL").replace(/\s+/g," ").trim();
}

function categoryFor(brand: string, text: string) {
  const b = normalize(brand);
  const t = normalize(text);

  if (b !== "victorinox") {
    if (WATCH.has(b)) return "Relojes";
    if (TRAVEL.has(b)) return "Equipo de viaje";
    if (TOOLS.has(b)) return "Navajas y multiherramientas";
    if (KNIVES.has(b)) return "Cuchillos";
    return null;
  }

  // Victorinox is multi-category. Never infer "Relojes" from the word
  // "Victorinox" itself: the old /inox/ signal classified almost the whole
  // catalog as watches and collapsed the median.
  const watchAccessory = /correa|pulsera|strap|bateria|battery|repuesto|protector|estuche para reloj|watch case/.test(t);
  const watchSignal = /\breloj(?:es)?\b|\bwatch(?:es)?\b|chronograph|cronograf|quartz|cuarzo|automatico|automatic/.test(t);
  if (watchSignal && !watchAccessory) return "Relojes";

  if (/maleta|equipaje|mochila|bolso|trolley|carry[- ]?on|spinner|luggage|suitcase|travel gear|necesser|neceser|billetera|pasaporte/.test(t)) {
    return "Equipo de viaje";
  }

  if (/navaj|multiherr|swiss army knife|spartan|climber|huntsman|cadet|classic sd|explorer|rambler|fieldmaster|swisstool/.test(t)) {
    return "Navajas y multiherramientas";
  }

  if (/cuchill|cuchiller|knife|santoku|mondador|fibrox|\bchef\b|afilador|pelador|tijera|rallador|tabla de corte|swiss classic|rosewood/.test(t)) {
    return "Cuchillos";
  }

  return null;
}

function brandLabel(value: string) {
  const key = normalize(value);
  const map: Record<string,string> = {
    victorinox:"Victorinox",tissot:"Tissot",seiko:"Seiko",citizen:"Citizen",
    samsonite:"Samsonite","american tourister":"American Tourister",saxoline:"Saxoline",
    leatherman:"Leatherman",arcos:"Arcos",global:"Global",zwilling:"Zwilling",
    tramontina:"Tramontina",wusthof:"Wusthof","wüsthof":"Wusthof",
  };
  return map[key] ?? value.trim();
}

function currentPrice(row: RawRow) {
  const offer = Number(row.offer_price ?? 0);
  const regular = Number(row.regular_price ?? 0);
  return offer > 0 ? offer : regular > 0 ? regular : 0;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(ordered.length/2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
}

function round(value: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function victorinoxMarketIntelligence(_access: EnterpriseAccessContext) {
  const quoted = ALL.map(item => `'${item.replaceAll("'","''")}'`).join(",");
  const rows = await clickHouseQuery<RawRow>(`
    SELECT
      toString(p.id) AS id,
      p.supermarket AS retailer,
      ifNull(p.brand,'') AS brand,
      p.name AS name,
      ifNull(p.category,'') AS category,
      ifNull(p.smart_category,'') AS smart_category,
      toFloat64(ifNull(s.regular_price,0)) AS regular_price,
      toFloat64(ifNull(s.offer_price,0)) AS offer_price,
      s.in_stock AS in_stock,
      toString(s.observed_at) AS observed_at,
      p.url AS url
    FROM products p
    INNER JOIN product_latest_price_state s ON s.product_id=p.id
    WHERE lowerUTF8(ifNull(p.brand,'')) IN (${quoted})
      AND s.observed_at >= now() - INTERVAL 90 DAY
      AND if(toFloat64(ifNull(s.offer_price,0))>0,toFloat64(s.offer_price),toFloat64(ifNull(s.regular_price,0)))>0
    LIMIT 8500
  `, {}, 9_000);

  const seen = new Set<string>();
  const market: VictorinoxMarketRow[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const category = categoryFor(row.brand, `${row.name} ${row.category} ${row.smart_category}`);
    if (!category) continue;
    const price = currentPrice(row);
    if (!price) continue;
    const regular = Number(row.regular_price ?? 0) > 0 ? Number(row.regular_price) : null;
    market.push({
      id: row.id,
      retailer: row.retailer,
      brand: brandLabel(row.brand),
      name: row.name,
      category,
      currentPrice: price,
      regularPrice: regular,
      promotionPct: regular && regular > price ? round((regular-price)/regular*100,1) : null,
      inStock: Boolean(row.in_stock),
      observedAt: row.observed_at,
      url: row.url,
    });
  }

  const grouped = new Map<string, VictorinoxMarketRow[]>();
  for (const row of market) {
    const key = `${row.category}::${row.brand}`;
    grouped.set(key,[...(grouped.get(key)??[]),row]);
  }

  const summary: VictorinoxSummaryRow[] = [...grouped.entries()].map(([key,items]) => {
    const [category,brand] = key.split("::");
    const prices = items.map(item=>item.currentPrice).filter(value=>value>0);
    return {
      category,
      brand,
      skuCount: new Set(items.map(item=>item.id)).size,
      retailers: new Set(items.map(item=>item.retailer)).size,
      averagePrice: round(prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : null),
      medianPrice: round(median(prices)),
      minPrice: round(prices.length ? Math.min(...prices) : null),
      maxPrice: round(prices.length ? Math.max(...prices) : null),
      promoPct: round(items.length ? items.filter(item=>(item.promotionPct??0)>0).length/items.length*100 : 0,1) ?? 0,
    };
  });

  const categories = ["Relojes","Equipo de viaje","Navajas y multiherramientas","Cuchillos"];
  const position = categories.map(category => {
    const categoryRows = summary.filter(row=>row.category===category);
    const own = categoryRows.find(row=>row.brand==="Victorinox") ?? null;
    const competitorMedians = categoryRows.filter(row=>row.brand!=="Victorinox" && row.medianPrice).map(row=>row.medianPrice as number);
    const benchmark = median(competitorMedians);
    const priceIndex = own?.medianPrice && benchmark ? round(own.medianPrice/benchmark*100,1) : null;
    return {
      category,
      own,
      benchmarkMedian: round(benchmark),
      priceIndex,
      premiumPct: priceIndex == null ? null : round(priceIndex-100,1),
      competitors: categoryRows.filter(row=>row.brand!=="Victorinox").sort((a,b)=>(a.medianPrice??Infinity)-(b.medianPrice??Infinity)),
    };
  });

  const retailers = [...new Set(market.map(row=>row.retailer))].sort((a,b)=>a.localeCompare(b,"es"));
  const brands = [...new Set(market.map(row=>row.brand))].sort((a,b)=>a.localeCompare(b,"es"));
  const lastObservedAt = market.map(row=>row.observedAt).filter((v):v is string=>Boolean(v)).sort().at(-1) ?? null;

  const insights: string[] = [];
  const strongestPremium = [...position].filter(x=>x.priceIndex!=null).sort((a,b)=>(b.priceIndex??0)-(a.priceIndex??0))[0];
  if (strongestPremium) insights.push(`El mayor premium relativo de Victorinox aparece en ${strongestPremium.category}: índice ${strongestPremium.priceIndex} con benchmark = 100.`);
  const lowest = [...position].filter(x=>x.priceIndex!=null).sort((a,b)=>(a.priceIndex??Infinity)-(b.priceIndex??Infinity))[0];
  if (lowest && lowest.category !== strongestPremium?.category) insights.push(`La categoría más cercana al mercado es ${lowest.category}: índice ${lowest.priceIndex}.`);
  const promoted = market.filter(row=>row.brand==="Victorinox" && (row.promotionPct??0)>0);
  if (promoted.length) insights.push(`${promoted.length} SKU Victorinox aparecen con precio promocional en la última muestra.`);
  insights.push(`El universo competitivo visible reúne ${brands.length} marcas en ${retailers.length} retailers.`);

  return {
    source: "clickhouse" as const,
    generatedAt: new Date().toISOString(),
    lastObservedAt,
    categories,
    retailers,
    brands,
    kpis: {
      marketSkus: market.length,
      ownSkus: new Set(market.filter(row=>row.brand==="Victorinox").map(row=>row.id)).size,
      competitorBrands: new Set(market.filter(row=>row.brand!=="Victorinox").map(row=>row.brand)).size,
      retailers: retailers.length,
      promotedOwnSkus: promoted.length,
    },
    position,
    summary,
    listings: market,
    insights,
  };
}
