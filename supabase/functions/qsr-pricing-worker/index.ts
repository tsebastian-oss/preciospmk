import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";

type Role = "brand" | "competitor";
type Spec = { key:string; name:string; aliases:string[]; category:string; units?:number; benchmark?:string; promoMechanic?:string };
type Target = { brand:string; role:Role; url:string; location:string; specs:Spec[] };
type Source = { domain:string; retailer:string; sourceType:"official"|"marketplace"; priority:number; targets:Target[] };
type Vertical = { slug:string; sources:Source[] };
type Parsed = Spec & { brand:string; role:Role; url:string; location:string; currentPrice:number; regularPrice:number|null; discountPct:number|null; promotion:boolean };

const KK: Spec[] = [
  {key:"krispy-kreme:kk-pokemon-12",name:"Docena Pokemon",aliases:["Docena Pokemon"],category:"Edición limitada",units:12},
  {key:"krispy-kreme:kk-pokemon-6",name:"6Pack Pokemon",aliases:["6Pack Pokemon","6 Pack Pokemon"],category:"Edición limitada",units:6},
  {key:"krispy-kreme:kk-basic-og",name:"Docena Basic + Docena OG",aliases:["Docena Basic + Docena OG"],category:"Promociones",units:24,promoMechanic:"Bundle 12+12"},
  {key:"krispy-kreme:kk-select-og",name:"Docena Select + Docena OG",aliases:["Docena Select + Docena OG"],category:"Promociones",units:24,promoMechanic:"Bundle 12+12"},
  {key:"krispy-kreme:kk-sprinkles-6",name:"6Pack Sprinkles",aliases:["6Pack Sprinkles","6 Pack Sprinkles"],category:"Packs",units:6},
  {key:"krispy-kreme:kk-complemento",name:"Complemento Perfecto",aliases:["Complemento Perfecto"],category:"Combos",promoMechanic:"Combo café + 2 doughnuts"},
  {key:"krispy-kreme:kk-og-3",name:"3 Pack Original Glazed",aliases:["3 pack Original Glazed","3 Pack Original Glazed"],category:"Original Glazed",units:3},
  {key:"krispy-kreme:kk-og-6",name:"6 Pack Original Glazed",aliases:["6 Pack Original Glazed"],category:"Original Glazed",units:6,benchmark:"pack-6"},
  {key:"krispy-kreme:kk-og-12",name:"Docena Original Glazed",aliases:["Docena Original Glazed"],category:"Original Glazed",units:12,benchmark:"pack-12"},
  {key:"krispy-kreme:kk-og-24",name:"Doble Docena Original Glazed",aliases:["Doble Docena Original Glazed"],category:"Original Glazed",units:24,benchmark:"pack-24"},
  {key:"krispy-kreme:kk-choice-3",name:"3 Pack a Elección",aliases:["3 Pack a Eleccion","3 Pack a Elección"],category:"Pack a Elección",units:3},
  {key:"krispy-kreme:kk-choice-6",name:"6 Pack a Elección",aliases:["6 Pack a Eleccion","6 Pack a Elección"],category:"Pack a Elección",units:6},
  {key:"krispy-kreme:kk-basic-12",name:"Escoge tu Docena Basic",aliases:["Escoge tu Docena Basic"],category:"Pack a Elección",units:12},
  {key:"krispy-kreme:kk-select-12",name:"Escoge tu Docena Select",aliases:["Escoge tu Docena Select"],category:"Pack a Elección",units:12},
  {key:"krispy-kreme:kk-premium-12",name:"Escoge tu Docena Premium",aliases:["Escoge tu Docena Premium"],category:"Pack a Elección",units:12},
];

const DUNKIN_RAPPI: Spec[] = [
  {key:"dunkin:dunkin-unit",name:"Donut",aliases:["Donut 1 Unidad","Donut"],category:"Donuts",units:1},
  {key:"dunkin:dunkin-6",name:"Donuts x6 (Paga 5)",aliases:["Donuts x6 (paga 5)","6 Donuts Classic (Paga 5)"],category:"Packs",units:6,benchmark:"pack-6",promoMechanic:"Paga 5"},
  {key:"dunkin:dunkin-12",name:"Donuts x12 (Paga 9)",aliases:["Donuts x12 (paga 9)","12 Donuts Classic (paga 9)"],category:"Packs",units:12,benchmark:"pack-12",promoMechanic:"Paga 9"},
  {key:"dunkin:dunkin-24",name:"24 Donuts (Paga 16)",aliases:["24 Donuts (paga 16)","24 Donuts Classic (Paga 16)"],category:"Packs",units:24,benchmark:"pack-24",promoMechanic:"Paga 16"},
];

const DUNKIN_OFFICIAL: Spec[] = [
  {key:"dunkin:dunkin-americano-m",name:"Americano M",aliases:["Americano M"],category:"Café"},
  {key:"dunkin:dunkin-latte-m",name:"Latte M",aliases:["Latte M"],category:"Café"},
];

const LC: Spec[] = [
  {key:"little-caesars:lc-duo-duo",name:"Duo Duo Familiar",aliases:["Duo Duo Familiar"],category:"Promociones",promoMechanic:"Edición limitada"},
  {key:"little-caesars:lc-combo-duo",name:"Combo Duo Duo",aliases:["Combo Duo Duo"],category:"Promociones",promoMechanic:"Combo"},
  {key:"little-caesars:lc-ultimate-cheese",name:"Ultimate Supreme + Classic Cheese",aliases:["Ultimate Supreme + Classic Cheese"],category:"Combos",units:2},
  {key:"little-caesars:lc-super-cheese",name:"Super Cheese + Classic Cheese",aliases:["Super Cheese + Classic Cheese"],category:"Combos",units:2},
  {key:"little-caesars:lc-duo-full",name:"Duo Full",aliases:["Duo Full"],category:"Combos"},
  {key:"little-caesars:lc-trio",name:"Trio Perfecto",aliases:["Trio Perfecto"],category:"Combos",units:3},
  {key:"little-caesars:lc-cuarteto",name:"El Cuarteto del Sabor",aliases:["El Cuarteto del Sabor"],category:"Combos",units:4},
  {key:"little-caesars:lc-combo-extra",name:"Combo Extra Pepperoni",aliases:["COMBO EXTRA PEPPERONI","Combo Extra Pepperoni"],category:"Combos"},
  {key:"little-caesars:lc-pepperoni",name:"Classic Pepperoni Familiar",aliases:["Classic Pepperoni Familiar"],category:"Pizzas clásicas",benchmark:"pepperoni-familiar"},
  {key:"little-caesars:lc-cheese",name:"Classic Cheese Familiar",aliases:["Classic Cheese Familiar"],category:"Pizzas clásicas"},
  {key:"little-caesars:lc-extra",name:"Extra Pepperoni Familiar",aliases:["Extra Pepperoni Familiar"],category:"Pizzas clásicas"},
  {key:"little-caesars:lc-jamon",name:"Jamón Familiar",aliases:["Jamón Familiar","Jamon Familiar"],category:"Pizzas clásicas"},
  {key:"little-caesars:lc-super-pepperoni",name:"Super Cheese Pepperoni Familiar",aliases:["Super Cheese Pepperoni Familiar"],category:"Especialidades"},
  {key:"little-caesars:lc-italian",name:"Italian 3 Cheese Familiar",aliases:["Italian 3 Cheese Familiar"],category:"Pizzas clásicas"},
  {key:"little-caesars:lc-4n1",name:"4N1 Familiar",aliases:["4N1 Familiar"],category:"Pizzas clásicas"},
  {key:"little-caesars:lc-ultimate",name:"Ultimate Supreme Familiar",aliases:["Ultimate Supreme Familiar"],category:"Especialidades"},
  {key:"little-caesars:lc-3meat",name:"3 Meat Treat Familiar",aliases:["3 Meat Treat Familiar"],category:"Especialidades"},
  {key:"little-caesars:lc-veggie",name:"Veggie Familiar",aliases:["Veggie Familiar"],category:"Especialidades"},
  {key:"little-caesars:lc-hawaiian",name:"Hula Hawaiian Familiar",aliases:["Hula Hawaiian Familiar"],category:"Especialidades"},
];

const PJ: Spec[] = [
  {key:"papa-johns:pj-combo-palitos",name:"Papa Combo Palitos",aliases:["Papa Combo Palitos"],category:"Promociones",promoMechanic:"Combo"},
  {key:"papa-johns:pj-super-duo",name:"Super Duo",aliases:["Super Duo"],category:"Promociones",units:2,promoMechanic:"2 pizzas + envío"},
  {key:"papa-johns:pj-epic-one",name:"Epic One!",aliases:["Epic One!"],category:"Promociones",promoMechanic:"Pizza familiar"},
  {key:"papa-johns:pj-combo-rolls",name:"Papa Combo Rolls",aliases:["Papa Combo Rolls"],category:"Promociones",promoMechanic:"Combo"},
];

const VERTICALS: Vertical[] = [
  {slug:"krispy-kreme",sources:[
    {domain:"rappi.cl",retailer:"Rappi · Krispy Kreme vs Dunkin",sourceType:"marketplace",priority:100,targets:[
      {brand:"Krispy Kreme",role:"brand",url:"https://www.rappi.cl/restaurantes/900094816-krispy-kreme",location:"Kennedy, Las Condes",specs:KK},
      {brand:"Dunkin",role:"competitor",url:"https://www.rappi.cl/restaurantes/900025506-dunkin",location:"Toesca, Santiago",specs:DUNKIN_RAPPI},
    ]},
    {domain:"pide.dunkin.cl",retailer:"Dunkin Chile · Pedido oficial",sourceType:"official",priority:90,targets:[
      {brand:"Dunkin",role:"competitor",url:"https://pide.dunkin.cl/pedir",location:"Chile",specs:DUNKIN_OFFICIAL},
    ]},
  ]},
  {slug:"little-caesars",sources:[
    {domain:"rappi.cl",retailer:"Rappi · Little Caesars",sourceType:"marketplace",priority:100,targets:[
      {brand:"Little Caesars",role:"brand",url:"https://www.rappi.cl/restaurantes/900025168-little-caesars-pizza",location:"Las Tranqueras, Las Condes",specs:LC},
    ]},
    {domain:"papajohns.cl",retailer:"Papa Johns Chile · Promociones",sourceType:"official",priority:90,targets:[
      {brand:"Papa Johns",role:"competitor",url:"https://www.papajohns.cl/promociones/",location:"Chile",specs:PJ},
    ]},
  ]},
];

function decode(v:string){return v.replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'")}
function clean(raw:string){return decode(raw).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function clp(raw:string){const n=Number(raw.replace(/[^0-9]/g,""));return Number.isFinite(n)&&n>=500&&n<=300000?n:null}
function money(segment:string){const values:number[]=[];for(const match of segment.matchAll(/\$\s*([0-9]{1,3}(?:[.\s][0-9]{3})+|[0-9]{3,6})/g)){const n=clp(match[1]);if(n)values.push(n);if(values.length>=3)break}return values}
function parseTarget(text:string,target:Target):Parsed[]{
  const low=text.toLowerCase();const parsed:Parsed[]=[];
  for(const spec of target.specs){let index=-1;let alias="";for(const candidate of spec.aliases){const found=low.indexOf(candidate.toLowerCase());if(found>=0&&(index<0||found<index)){index=found;alias=candidate}}if(index<0)continue;
    const segment=text.slice(index+alias.length,index+alias.length+900);const prices=money(segment);if(!prices.length)continue;
    const discountMatch=segment.slice(0,650).match(/-\s*([0-9]{1,2})\s*%/);const currentPrice=prices[0];const regularPrice=discountMatch&&prices[1]&&prices[1]>currentPrice?prices[1]:null;const discountPct=discountMatch?Number(discountMatch[1]):regularPrice?Math.round((1-currentPrice/regularPrice)*100):null;
    parsed.push({...spec,brand:target.brand,role:target.role,url:target.url,location:target.location,currentPrice,regularPrice,discountPct,promotion:Boolean(discountPct||spec.promoMechanic)});
  }
  return parsed;
}
async function fetchPage(url:string){const rappi=new URL(url).hostname.includes("rappi.cl");const response=await fetch(url,{headers:{"user-agent":rappi?BOT_UA:BROWSER_UA,"accept":"text/html,application/xhtml+xml","accept-language":"es-CL,es;q=0.9,en;q=0.7","cache-control":"no-cache"},redirect:"follow",signal:AbortSignal.timeout(22000)});const raw=await response.text();if(!response.ok)throw new Error(`HTTP ${response.status}`);if(raw.length<500)throw new Error(`short_html:${raw.length}`);return clean(raw)}
async function ensureSource(brandId:string,source:Source){const {data:existing}=await supabase.from("brands_vertical_sources").select("id").eq("brand_id",brandId).eq("domain",source.domain).maybeSingle();if(existing?.id){await supabase.from("brands_vertical_sources").update({retailer_name:source.retailer,source_type:source.sourceType,priority:source.priority,active:true}).eq("id",existing.id);return existing.id}const {data,error}=await supabase.from("brands_vertical_sources").insert({brand_id:brandId,retailer_name:source.retailer,domain:source.domain,source_type:source.sourceType,priority:source.priority,active:true}).select("id").single();if(error)throw error;return data.id}
async function ensureProduct(brandId:string,item:Parsed){const {data,error}=await supabase.from("brands_vertical_products").upsert({brand_id:brandId,external_sku:item.key,name:item.name,category:item.category,product_url:item.url,canonical_key:item.key,active:true,last_seen_at:new Date().toISOString(),attributes:{actualBrand:item.brand,role:item.role,units:item.units??null,benchmark:item.benchmark??null}},{onConflict:"brand_id,canonical_key"}).select("id").single();if(error)throw error;return data.id}
async function persist(brandId:string,sourceId:string,item:Parsed){const productId=await ensureProduct(brandId,item);const unitPrice=item.units?Math.round(item.currentPrice/item.units):null;const {error}=await supabase.from("brands_vertical_listings").insert({brand_id:brandId,source_id:sourceId,product_id:productId,source_product_key:item.key,title:item.name,brand_name:item.brand,seller_name:item.brand,category:item.category,product_url:item.url,regular_price:item.regularPrice,current_price:item.currentPrice,currency:"CLP",in_stock:true,attributes:{actualBrand:item.brand,role:item.role,units:item.units??null,unitPrice,benchmark:item.benchmark??null,promotion:item.promotion,promoMechanic:item.promoMechanic??null,discountPct:item.discountPct,snapshotType:"automatic",verification:"source_page_observed",location:item.location},raw:{collector:"qsr-pricing-worker-v5",sourceUrl:item.url},observed_at:new Date().toISOString()});if(error)throw error}
async function collect(vertical:Vertical){const {data:brand,error}=await supabase.from("brands_vertical_brands").select("id").eq("slug",vertical.slug).single();if(error||!brand)throw new Error(`brand_not_found:${vertical.slug}`);const started=new Date().toISOString();const {data:run}=await supabase.from("brands_vertical_discovery_runs").insert({brand_id:brand.id,status:"running",started_at:started,sources_attempted:vertical.sources.length}).select("id").single();let sourcesSucceeded=0,listings=0;const products=new Set<string>();const details:any[]=[];
  for(const source of vertical.sources){const sourceId=await ensureSource(brand.id,source);let sourceListings=0;const targetDetails:any[]=[];for(const target of source.targets){try{const page=await fetchPage(target.url);const items=parseTarget(page,target);for(const item of items){await persist(brand.id,sourceId,item);sourceListings++;listings++;products.add(item.key)}targetDetails.push({brand:target.brand,url:target.url,found:items.length,status:items.length?"ok":"no-data"})}catch(e){targetDetails.push({brand:target.brand,url:target.url,found:0,status:"error",error:e instanceof Error?e.message:String(e)})}}
    if(sourceListings>0)sourcesSucceeded++;await supabase.from("brands_vertical_sources").update({last_crawled_at:new Date().toISOString(),last_status:sourceListings?`ok:${sourceListings}`:"degraded:last-valid-retained",last_error:sourceListings?null:JSON.stringify(targetDetails).slice(0,700)}).eq("id",sourceId);details.push({domain:source.domain,found:sourceListings,targets:targetDetails});}
  const status=sourcesSucceeded===vertical.sources.length?"completed":sourcesSucceeded>0?"partial":"failed";if(run?.id)await supabase.from("brands_vertical_discovery_runs").update({status,sources_succeeded:sourcesSucceeded,listings_found:listings,products_found:products.size,finished_at:new Date().toISOString(),notes:JSON.stringify(details)}).eq("id",run.id);return {slug:vertical.slug,status,sourcesSucceeded,sourcesAttempted:vertical.sources.length,listingsFound:listings,productsFound:products.size,details};
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});
  const token=req.headers.get("x-qsr-worker-token");const {data:config}=await supabase.from("qsr_worker_config").select("token").eq("id",1).single();if(!token||!config?.token||token!==config.token)return Response.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>({}));const slug=String(body.slug||"all");const selected=slug==="all"?VERTICALS:VERTICALS.filter(v=>v.slug===slug);if(!selected.length)return Response.json({error:"unknown_slug"},{status:400});const results=[];for(const vertical of selected){try{results.push(await collect(vertical))}catch(e){results.push({slug:vertical.slug,status:"failed",error:e instanceof Error?e.message:String(e)})}}return Response.json({ok:true,observedAt:new Date().toISOString(),results});
});
