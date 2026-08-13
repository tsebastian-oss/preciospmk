import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type InsightV2Mode = "price-evolution" | "price-gaps" | "price-alerts" | "products" | "data-status";
export type InsightV2Filters = { brand?: string | null; productId?: string | null; query?: string | null; days?: number; page?: number; pageSize?: number };
type ScopedAccess = EnterpriseAccessContext & { industryConfigured?: boolean; industrySlug?: string | null };
type Numeric = number | string;
type OptionRow = { value: string; products: Numeric };
type ProductOptionRow = { id: string; name: string; brand: string; retailer: string; latest_price: Numeric; last_observed_at: string | null; available_days: Numeric };
type EvolutionRow = { date: string; retailer: string; price: Numeric; products: Numeric };
type GapRow = { brand: string; category: string; retailers: Numeric; products: Numeric; low_retailer: string; high_retailer: string; low_price: Numeric; high_price: Numeric; gap_pct: Numeric };
type AlertRow = { id: string; name: string; brand: string | null; category: string | null; retailer: string; vertical: string; previous_price: Numeric; current_price: Numeric; previous_date: string; current_date: string; change_pct: Numeric; price_delta: Numeric; observed_at: string | null };
type ProductRow = { id: string; name: string; brand: string | null; category: string | null; retailer: string; vertical: string; price: Numeric; regular_price: Numeric; in_stock: boolean; observed_at: string | null; url: string };
type CountRow = { total: Numeric };
type StatusRow = { retailer: string; vertical: string; products: Numeric; latest_observed_at: string | null; observations_24h: Numeric };

const CURRENT_PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";
function number(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function clean(value: string | null | undefined, max = 220) { return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function period(value: number | undefined) { return [7, 30, 90, 180].includes(Number(value)) ? Number(value) : 30; }
function smartCategory(alias = "p") { return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`; }
function addString(params: ClickHouseParams, name: string, value: string) { params[name] = { type: "String", value }; return `{${name}:String}`; }
function addStringList(predicates: string[], params: ClickHouseParams, column: string, values: string[], prefix: string) {
  const unique = [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (!unique.length) return;
  const placeholders = unique.map((value, index) => addString(params, `${prefix}_${index}`, value));
  predicates.push(`${column} IN (${placeholders.join(", ")})`);
}
function tokens(value: string) {
  const stop = new Set(["de","del","la","las","el","los","un","una","unos","unas","y","en","con","para","por"]);
  return [...new Set(value.toLocaleLowerCase("es-CL").replace(/[^\p{L}\p{N}]+/gu," ").split(/\s+/).filter((item) => item.length >= 2 && !stop.has(item)))].slice(0, 8);
}
function basePredicates(access: ScopedAccess, params: ClickHouseParams, alias = "p") {
  const predicates = [`${alias}.retailer_type IN ('supermarket','department_store','pharmacy','home_improvement')`];
  addStringList(predicates, params, `${alias}.supermarket`, access.retailers ?? [], "scope_retailer");
  addStringList(predicates, params, `${alias}.brand`, access.brands ?? [], "scope_brand");
  addStringList(predicates, params, smartCategory(alias), access.categories ?? [], "scope_category");
  if (access.industryConfigured && access.industrySlug && access.industrySlug !== "all") {
    if (access.industrySlug === "grocery") predicates.push(`${alias}.retailer_type = 'supermarket'`);
    else predicates.push(`${alias}.industry_slug = ${addString(params,"scope_industry",access.industrySlug)}`);
  }
  return predicates;
}
function brandPredicate(predicates: string[], params: ClickHouseParams, brand: string | null | undefined) {
  const value = clean(brand, 160); if (value) predicates.push(`p.brand = ${addString(params,"requested_brand",value)}`);
}
function exactProductPredicate(predicates: string[], params: ClickHouseParams, productId: string | null | undefined) {
  const value = clean(productId, 120); if (value) predicates.push(`toString(p.id) = ${addString(params,"requested_product_id",value)}`);
}
function queryPredicates(predicates: string[], params: ClickHouseParams, query: string | null | undefined) {
  tokens(clean(query, 220)).forEach((token,index) => {
    const p = addString(params,`search_${index}`,token);
    predicates.push(`(positionCaseInsensitiveUTF8(p.name,${p})>0 OR positionCaseInsensitiveUTF8(ifNull(p.brand,''),${p})>0 OR positionCaseInsensitiveUTF8(ifNull(${smartCategory()},''),${p})>0 OR positionCaseInsensitiveUTF8(p.supermarket,${p})>0)`);
  });
}

export async function insightV2BrandOptions(accessInput: EnterpriseAccessContext) {
  const access = accessInput as ScopedAccess; const params: ClickHouseParams = {}; const predicates = basePredicates(access,params); predicates.push("notEmpty(ifNull(p.brand,''))");
  const rows = await clickHouseQuery<OptionRow>(`SELECT ifNull(p.brand,'') value, uniqExact(p.id) products FROM products p FINAL WHERE ${predicates.join(" AND ")} GROUP BY value ORDER BY products DESC,value ASC LIMIT 1000`,params,6000);
  return rows.map((row)=>({value:row.value,products:number(row.products)}));
}

export async function insightV2ProductOptions(accessInput: EnterpriseAccessContext, brandInput: string, requestedDays: number) {
  const access=accessInput as ScopedAccess; const brand=clean(brandInput,160); if(!brand)return[]; const days=period(requestedDays);
  const params:ClickHouseParams={days_back:{type:"UInt16",value:days-1}}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,brand);
  predicates.push("d.effective_price>0"); predicates.push("d.price_date>=subtractDays(toDate(now(),'America/Santiago'),{days_back:UInt16})");
  const rows=await clickHouseQuery<ProductOptionRow>(`SELECT toString(p.id) id,p.name,ifNull(p.brand,'') brand,p.supermarket retailer,argMax(toFloat64(d.effective_price),d.observed_at) latest_price,toString(max(d.observed_at)) last_observed_at,uniqExact(d.price_date) available_days FROM daily_pricing_live d FINAL INNER JOIN products p FINAL ON p.id=d.product_id WHERE ${predicates.join(" AND ")} GROUP BY p.id,p.name,brand,retailer ORDER BY last_observed_at DESC,p.name ASC LIMIT 1200`,params,8000);
  return rows.map((row)=>({id:row.id,name:row.name,brand:row.brand,retailer:row.retailer,latestPrice:number(row.latest_price),lastObservedAt:row.last_observed_at,availableDays:number(row.available_days)}));
}

async function evolution(access:ScopedAccess,filters:InsightV2Filters){
  const days=period(filters.days); const params:ClickHouseParams={days_back:{type:"UInt16",value:days-1}}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,filters.brand); exactProductPredicate(predicates,params,filters.productId); predicates.push("d.effective_price>0"); predicates.push("d.price_date>=subtractDays(toDate(now(),'America/Santiago'),{days_back:UInt16})");
  const rows=await clickHouseQuery<EvolutionRow>(`SELECT toString(d.price_date) date,p.supermarket retailer,round(quantileTDigest(.5)(toFloat64(d.effective_price)),0) price,uniqExact(d.product_id) products FROM daily_pricing_live d FINAL INNER JOIN products p FINAL ON p.id=d.product_id WHERE ${predicates.join(" AND ")} GROUP BY d.price_date,p.supermarket ORDER BY d.price_date,p.supermarket`,params,8000);
  const retailers=[...new Set(rows.map((row)=>row.retailer))]; return {series:retailers.map((retailer)=>({retailer,points:rows.filter((row)=>row.retailer===retailer).map((row)=>({date:row.date,price:number(row.price),products:number(row.products)}))}))};
}

async function gaps(access:ScopedAccess,filters:InsightV2Filters){
  const params:ClickHouseParams={}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,filters.brand); predicates.push(`${CURRENT_PRICE}>0`); predicates.push("notEmpty(ifNull(p.brand,''))"); predicates.push(`notEmpty(ifNull(${smartCategory()},''))`);
  const rows=await clickHouseQuery<GapRow>(`WITH by_retailer AS (SELECT ifNull(p.brand,'') brand,${smartCategory()} category,p.supermarket retailer,uniqExact(p.id) products,round(quantileTDigest(.5)(${CURRENT_PRICE}),0) median_price FROM products p FINAL INNER JOIN product_latest_price_state s FINAL ON s.product_id=p.id WHERE ${predicates.join(" AND ")} GROUP BY brand,category,retailer HAVING products>=1 AND median_price>0), by_category AS (SELECT brand,category,uniqExact(retailer) retailers,sum(products) products,argMin(retailer,median_price) low_retailer,argMax(retailer,median_price) high_retailer,min(median_price) low_price,max(median_price) high_price,round((high_price-low_price)/greatest(low_price,1)*100,1) gap_pct FROM by_retailer GROUP BY brand,category HAVING retailers>=2 AND high_price>low_price), ranked AS (SELECT *,row_number() OVER(PARTITION BY brand ORDER BY gap_pct DESC,products DESC) rn FROM by_category) SELECT brand,category,retailers,products,low_retailer,high_retailer,low_price,high_price,gap_pct FROM ranked WHERE rn=1 ORDER BY gap_pct DESC,products DESC LIMIT 1000`,params,9000);
  return {gaps:rows.map((row)=>({brand:row.brand,category:row.category,retailers:number(row.retailers),products:number(row.products),lowRetailer:row.low_retailer,highRetailer:row.high_retailer,lowPrice:number(row.low_price),highPrice:number(row.high_price),gapPct:number(row.gap_pct)}))};
}

async function alerts(access:ScopedAccess,filters:InsightV2Filters){
  const lookback=Math.max(14,period(filters.days)); const params:ClickHouseParams={days_back:{type:"UInt16",value:lookback-1}}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,filters.brand); exactProductPredicate(predicates,params,filters.productId); predicates.push("d.effective_price>0"); predicates.push("d.price_date>=subtractDays(toDate(now(),'America/Santiago'),{days_back:UInt16})");
  const rows=await clickHouseQuery<AlertRow>(`WITH daily AS (SELECT toString(p.id) id,p.name name,p.brand brand,${smartCategory()} category,p.supermarket retailer,p.retailer_type vertical,d.price_date price_date,argMax(toFloat64(d.effective_price),d.observed_at) price,max(d.observed_at) observed_at FROM daily_pricing_live d FINAL INNER JOIN products p FINAL ON p.id=d.product_id WHERE ${predicates.join(" AND ")} GROUP BY p.id,p.name,p.brand,category,p.supermarket,p.retailer_type,d.price_date), ranked AS (SELECT *,row_number() OVER(PARTITION BY id ORDER BY price_date DESC) rn FROM daily), paired AS (SELECT id,any(name) name,any(brand) brand,any(category) category,any(retailer) retailer,any(vertical) vertical,maxIf(price,rn=2) previous_price,maxIf(price,rn=1) current_price,toString(maxIf(price_date,rn=2)) previous_date,toString(maxIf(price_date,rn=1)) current_date,toString(maxIf(observed_at,rn=1)) observed_at FROM ranked WHERE rn<=2 GROUP BY id) SELECT id,name,brand,category,retailer,vertical,previous_price,current_price,previous_date,current_date,round((current_price-previous_price)/previous_price*100,1) change_pct,round(current_price-previous_price,0) price_delta,observed_at FROM paired WHERE previous_price>0 AND current_price>0 AND previous_price!=current_price AND abs((current_price-previous_price)/previous_price*100)>=1 AND abs((current_price-previous_price)/previous_price*100)<=80 ORDER BY abs(change_pct) DESC,abs(price_delta) DESC LIMIT 250`,params,10000);
  return {alerts:rows.map((row)=>({id:row.id,name:row.name,brand:row.brand,category:row.category,retailer:row.retailer,vertical:row.vertical,previousPrice:number(row.previous_price),currentPrice:number(row.current_price),previousDate:row.previous_date,currentDate:row.current_date,changePct:number(row.change_pct),priceDelta:number(row.price_delta),observedAt:row.observed_at}))};
}

async function products(access:ScopedAccess,filters:InsightV2Filters){
  const page=Math.max(1,Math.min(10000,Math.trunc(Number(filters.page)||1))); const pageSize=Math.max(24,Math.min(120,Math.trunc(Number(filters.pageSize)||60))); const offset=(page-1)*pageSize;
  const params:ClickHouseParams={}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,filters.brand); queryPredicates(predicates,params,filters.query); predicates.push(`${CURRENT_PRICE}>0`);
  const where=predicates.join(" AND ");
  const [rows,countRows]=await Promise.all([
    clickHouseQuery<ProductRow>(`SELECT toString(p.id) id,p.name,p.brand,${smartCategory()} category,p.supermarket retailer,p.retailer_type vertical,${CURRENT_PRICE} price,toFloat64(ifNull(s.regular_price,0)) regular_price,s.in_stock,toString(s.observed_at) observed_at,p.url FROM products p FINAL INNER JOIN product_latest_price_state s FINAL ON s.product_id=p.id WHERE ${where} ORDER BY s.observed_at DESC,p.name ASC LIMIT ${pageSize} OFFSET ${offset}`,params,8000),
    clickHouseQuery<CountRow>(`SELECT count() total FROM products p FINAL INNER JOIN product_latest_price_state s FINAL ON s.product_id=p.id WHERE ${where}`,params,8000),
  ]);
  const total=number(countRows[0]?.total); return {products:rows.map((row)=>({id:row.id,name:row.name,brand:row.brand,category:row.category,retailer:row.retailer,vertical:row.vertical,price:number(row.price),regularPrice:number(row.regular_price),inStock:Boolean(row.in_stock),observedAt:row.observed_at,url:row.url})),total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize))};
}

async function dataStatus(access:ScopedAccess,filters:InsightV2Filters){
  const params:ClickHouseParams={}; const predicates=basePredicates(access,params); brandPredicate(predicates,params,filters.brand);
  const rows=await clickHouseQuery<StatusRow>(`SELECT p.supermarket retailer,any(p.retailer_type) vertical,uniqExact(p.id) products,toString(max(s.observed_at)) latest_observed_at,countIf(s.observed_at>=subtractHours(now(),24)) observations_24h FROM products p FINAL INNER JOIN product_latest_price_state s FINAL ON s.product_id=p.id WHERE ${predicates.join(" AND ")} GROUP BY p.supermarket ORDER BY latest_observed_at DESC`,params,7000);
  return {retailers:rows.map((row)=>({retailer:row.retailer,vertical:row.vertical,products:number(row.products),latestObservedAt:row.latest_observed_at,observations24h:number(row.observations_24h)}))};
}

export async function clickHouseInsightV2(accessInput:EnterpriseAccessContext,mode:InsightV2Mode,filters:InsightV2Filters){
  const access=accessInput as ScopedAccess; const normalized={brand:clean(filters.brand,160)||null,productId:clean(filters.productId,120)||null,query:clean(filters.query,220)||null,days:period(filters.days),page:filters.page,pageSize:filters.pageSize};
  let data:Record<string,unknown>; if(mode==="price-evolution")data=await evolution(access,normalized); else if(mode==="price-gaps")data=await gaps(access,normalized); else if(mode==="price-alerts")data=await alerts(access,normalized); else if(mode==="products")data=await products(access,normalized); else data=await dataStatus(access,normalized);
  return {source:"clickhouse" as const,mode,filters:normalized,generatedAt:new Date().toISOString(),...data};
}
