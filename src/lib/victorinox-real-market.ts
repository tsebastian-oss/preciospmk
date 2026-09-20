import type { VictorinoxMarketRow, VictorinoxSummaryRow } from "@/lib/victorinox-market";

type VerticalListing = {
  id?: string; url?: string; title?: string; domain?: string; source?: string;
  inStock?: boolean; category?: string; observedAt?: string;
  currentPrice?: number | string; regularPrice?: number | string;
};

const CATEGORIES = ["Relojes","Equipo de viaje","Navajas y multiherramientas","Cuchillos"];

function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-CL").replace(/\s+/g," ").trim();}
function median(values:number[]){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function quantile(values:number[],q:number){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),p=(s.length-1)*q,b=Math.floor(p),r=p-b;return s[b+1]==null?s[b]:s[b]+r*(s[b+1]-s[b]);}
function round(value:number|null,digits=0){if(value==null||!Number.isFinite(value))return null;const f=10**digits;return Math.round(value*f)/f;}

function categoryFor(row:VerticalListing){
  const title=normalize(row.title??"");
  const category=normalize(row.category??"");
  const luggageSignal=/maleta|equipaje|trolley|carry[- ]?on|spinner|luggage|suitcase/.test(title);
  const luggageAccessory=/repuesto|rueda|candado|cobertor|funda|etiqueta|identificador|adaptador/.test(title);
  const pocketSignal=/navaj|cortapluma|swisstool|swiss tool|spartan|climber|huntsman|cadet|classic sd|explorer|rambler|fieldmaster|swiss champ|swisschamp|ranger ?grip|cybertool|work champ|outrider|super tinker|hiker|camper|sportsman|recruit|sentinel|evoke|hunter pro|wine master|mountaineer|handyman|minichamp|swiss lite/.test(title);
  const pocketAccessory=/multiherramientas para navajas|navaja.*juguete|^(funda|estuche|repuesto|aceite|cordon|lanyard|cadena|multiclip|alfiler|palillo|pinza)\b/.test(title);
  const knifeSignal=/cuchill|\bknife\b|santoku|mondador|paring|\bchef\b|trinchar|filetear|fibrox|bistec|pan y pasteleria|tomate y de mesa/.test(title);
  const kitchenAccessory=/pelador|rallador|tabla de corte|tijera|cuchara|tenedor|afilador|soporte|olla|sarten|cubierto|vajilla/.test(title);
  if(category==="relojes")return title.startsWith("reloj ")?"Relojes":null;
  if(category==="equipo de viaje"||category==="mochilas y bolsos")return luggageSignal&&!luggageAccessory?"Equipo de viaje":null;
  if(category==="navajas y multiherramientas"||category==="swiss army knife & tools")return pocketSignal&&!pocketAccessory?"Navajas y multiherramientas":null;
  if(category==="cuchillos")return knifeSignal&&!kitchenAccessory?"Cuchillos":null;
  return null;
}

function summarize(market:VictorinoxMarketRow[]){
  const groups=new Map<string,VictorinoxMarketRow[]>();
  market.forEach(row=>{const key=`${row.category}::${row.brand}`;groups.set(key,[...(groups.get(key)??[]),row]);});
  return [...groups.entries()].map(([key,items]):VictorinoxSummaryRow=>{
    const [category,brand]=key.split("::"),prices=items.map(x=>x.currentPrice).filter(x=>x>0);
    return {category,brand,skuCount:new Set(items.map(x=>x.id)).size,retailers:new Set(items.map(x=>x.retailer)).size,
      averagePrice:round(prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:null),medianPrice:round(median(prices)),
      minPrice:round(prices.length?Math.min(...prices):null),maxPrice:round(prices.length?Math.max(...prices):null),
      promoPct:round(items.length?items.filter(x=>(x.promotionPct??0)>0).length/items.length*100:0,1)??0};
  });
}

export function mergeVictorinoxOfficialMarket(base:any,vertical:any){
  const raw:Array<VerticalListing>=Array.isArray(vertical?.listings)?vertical.listings:[];
  const latest=new Map<string,VictorinoxMarketRow>();
  for(const row of raw){
    if(normalize(row.domain??"")!=="victorinoxstore.cl")continue;
    const category=categoryFor(row),price=Number(row.currentPrice??0),regular=Number(row.regularPrice??0);
    if(!category||price<=0||row.inStock===false)continue;
    const key=`${category}::${normalize(row.title??"")}`;
    const item:VictorinoxMarketRow={id:String(row.id??key),retailer:"Victorinox Store Chile",brand:"Victorinox",name:String(row.title??""),
      category,currentPrice:price,regularPrice:regular>0?regular:null,promotionPct:regular>price?round((regular-price)/regular*100,1):null,
      inStock:true,observedAt:row.observedAt??null,url:String(row.url??"")};
    const previous=latest.get(key);
    if(!previous||String(item.observedAt??"")>String(previous.observedAt??""))latest.set(key,item);
  }
  const official=[...latest.values()];
  const competition:Array<VictorinoxMarketRow>=(Array.isArray(base?.listings)?base.listings:[]).filter((x:any)=>x.brand!=="Victorinox");
  const market=[...official,...competition];
  const summary=summarize(market);
  const position=CATEGORIES.map(category=>{
    const rows=summary.filter(x=>x.category===category),own=rows.find(x=>x.brand==="Victorinox")??null;
    const eligibleCompetitors=rows.filter(x=>x.brand!=="Victorinox"&&x.medianPrice&&x.skuCount>=5);
    const competitorMedians=eligibleCompetitors.map(x=>x.medianPrice as number);
    const benchmark=median(competitorMedians),priceIndex=own?.medianPrice&&benchmark?round(own.medianPrice/benchmark*100,1):null;
    const categoryRows=market.filter(x=>x.category===category&&x.inStock!==false&&x.currentPrice>0);
    const ownPrices=categoryRows.filter(x=>x.brand==="Victorinox").map(x=>x.currentPrice);
    const competitorPrices=categoryRows.filter(x=>x.brand!=="Victorinox").map(x=>x.currentPrice);
    const low=quantile(ownPrices,.1),high=quantile(ownPrices,.9);
    const comparable=low!=null&&high!=null?competitorPrices.filter(x=>x>=low&&x<=high):[];
    const pool=comparable.length>=5?comparable:[],comparableBenchmark=median(pool);
    const comparablePriceIndex=own?.medianPrice&&comparableBenchmark?round(own.medianPrice/comparableBenchmark*100,1):null;
    return {category,own,benchmarkMedian:round(benchmark),priceIndex,premiumPct:priceIndex==null?null:round(priceIndex-100,1),
      comparableBenchmarkMedian:round(comparableBenchmark),comparablePriceIndex,comparablePremiumPct:comparablePriceIndex==null?null:round(comparablePriceIndex-100,1),
      comparableSample:pool.length,comparableBand:{low:round(low),high:round(high)},
      competitors:eligibleCompetitors.sort((a,b)=>(a.medianPrice??Infinity)-(b.medianPrice??Infinity))};
  });
  const retailers=[...new Set(market.map(x=>x.retailer))].sort((a,b)=>a.localeCompare(b,"es"));
  const brands=[...new Set(market.map(x=>x.brand))].sort((a,b)=>a.localeCompare(b,"es"));
  const observed=market.map(x=>x.observedAt).filter((x):x is string=>Boolean(x)).sort().at(-1)??null;
  const promoted=official.filter(x=>(x.promotionPct??0)>0);
  const watch=summary.find(x=>x.category==="Relojes"&&x.brand==="Victorinox");
  const watchListMedian=round(median(official.filter(x=>x.category==="Relojes").map(x=>x.regularPrice??x.currentPrice)));
  const insights=[
    watch?`Relojes Victorinox: mediana vigente $${Math.round(watch.medianPrice??0).toLocaleString("es-CL")} y mediana de lista $${Math.round(watchListMedian??0).toLocaleString("es-CL")} sobre ${watch.skuCount} modelos oficiales.`:"",
    `${promoted.length} SKU Victorinox tienen descuento vigente en la captura oficial.`,
    `La comparación reúne ${Math.max(0,brands.length-1)} marcas competidoras en ${Math.max(0,retailers.length-1)} canales de mercado.`
  ].filter(Boolean);
  return {source:"victorinox-official+clickhouse",generatedAt:new Date().toISOString(),lastObservedAt:observed,categories:CATEGORIES,retailers,brands,
    kpis:{marketSkus:market.length,ownSkus:official.length,competitorBrands:new Set(competition.map(x=>x.brand)).size,retailers:retailers.length,promotedOwnSkus:promoted.length},
    position,summary,listings:market,insights,presentationMode:false,
    dataQuality:{officialSource:"victorinoxstore.cl",officialProducts:official.length,watchProducts:watch?.skuCount??0,watchCurrentMedian:watch?.medianPrice??null,watchListMedian,competitionSource:"ClickHouse",syntheticData:false,
      minimumSample:5,categoryCoverage:CATEGORIES.map(category=>{const own=summary.find(x=>x.category===category&&x.brand==="Victorinox");return {category,products:own?.skuCount??0,reliable:(own?.skuCount??0)>=5};})}};
}
