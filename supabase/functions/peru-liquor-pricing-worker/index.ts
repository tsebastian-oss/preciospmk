
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";
const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

type Role = "brand" | "competitor";
type Spec = { key:string; name:string; aliases:string[]; category:"Pisco"|"Ron"|"Vino"; marketCategory:string; actualBrand:string; role:Role; ml:number };
type Target = { url:string; specs:Spec[] };
type Source = { retailer:string; domain:string; sourceType:string; priority:number; targets:Target[] };
type Parsed = Spec & { currentPrice:number; regularPrice:number|null; discountPct:number|null; promotion:boolean; sourceUrl:string };

const S = (key:string,name:string,aliases:string[],category:"Pisco"|"Ron"|"Vino",marketCategory:string,actualBrand:string,role:Role,ml:number):Spec =>
  ({key,name,aliases,category,marketCategory,actualBrand,role,ml});

const cgQ=S("cg-quebranta-700","Pisco Puro Quebranta Cuatro Gallos 700 ml",[
  "Pisco Puro Quebranta Cuatro Gallos Botella 700 mL","Pisco Puro Quebranta Cuatro Gallos 700ml","Pisco Cuatro Gallos Puro Quebranta Botella 700ml","Pisco CUATRO GALLOS Quebranta Botella 700ml"
],"Pisco","Pisco puro","Cuatro Gallos","brand",700);
const cgI=S("cg-italia-700","Pisco Puro Italia Cuatro Gallos 700 ml",[
  "Pisco Puro Italia Cuatro Gallos Botella 700 mL","Pisco Puro Cuatro Gallos Italia Botella 700 mL","Pisco Cuatro Gallos Puro Italia Botella 700ml","Pisco CUATRO GALLOS Italia Botella 700ml"
],"Pisco","Pisco puro","Cuatro Gallos","brand",700);
const cgMv=S("cg-mv-quebranta-700","Pisco Mosto Verde Quebranta Cuatro Gallos 700 ml",[
  "Pisco Mosto Verde Quebranta Cuatro Gallos Botella 700 mL","Pisco Mosto Verde Quebranta Cuatro Gallos 700ml"
],"Pisco","Pisco mosto verde","Cuatro Gallos","brand",700);
const man=S("mandatario-solera-750","Ron Mandatario Solera 750 ml",[
  "Ron Mandatario Solera Botella 750 mL","Ron Mandatario Solera Botella 700ml","Ron Mandatario Solera 750ml","Ron Mandatario Solera 700ml"
],"Ron","Ron premium","Mandatario","brand",750);
const ecoT=S("ecopello-tinto-750","Vino E. Copello Tinto Semiseco 750 ml",[
  "Vino Tinto Semiseco Blend E. Copello 750ml","Vino E. Copello Tinto Semiseco 750 ml","Vino Tinto Semiseco E. Copello 750ml","Vino E.Copello Tinto Semiseco Botella 750 mL"
],"Vino","Vino entrada","E. Copello","brand",750);
const ecoM=S("ecopello-moscato-750","Vino E. Copello Blanco Moscato 750 ml",[
  "Vino E.Copello Blanco Moscato Botella 750 mL","Vino E. Copello Blanco Moscato Botella 750 mL","Vino Blanco Semiseco Moscato E. Copello 750ml","Vino E. Copello Blanco Moscato 750 ml"
],"Vino","Vino entrada","E. Copello","brand",750);
const casas=S("casas-patronales-carmenere-750","Vino Casas Patronales Carmenere 750 ml",[
  "Vino Casas Patronales Carmenere Botella 750 mL","Vino Casas Patronales Carmenere 750 ml","Casas Patronales Carmenere 750ml"
],"Vino","Vino premium","Casas Patronales","brand",750);
const lag=S("lagarde-cabernet-750","Vino Lagarde Cabernet Sauvignon 750 ml",[
  "Vino Lagarde Cabernet Sauvignon Botella 750 mL","Vino Lagarde Cabernet Sauvignon 750 ml","Lagarde Cabernet Sauvignon 750ml"
],"Vino","Vino premium","Lagarde","brand",750);
const sqP=S("sq-quebranta-750","Pisco Quebranta Santiago Queirolo 750 ml",[
  "Pisco Quebranta Santiago Queirolo 42° Botella 750 mL","Pisco Quebranta Santiago Queirolo Botella 750 mL"
],"Pisco","Pisco puro","Santiago Queirolo","competitor",750);
const finca=S("finca-mv-quebranta-750","Pisco Mosto Verde Quebranta Finca Rotondo 750 ml",[
  "Pisco Mosto Verde Quebranta Finca Rotondo Botella 750 mL","Pisco Mosto Verde Quebranta Finca Rotondo 750 ml"
],"Pisco","Pisco mosto verde","Finca Rotondo","competitor",750);
const sqV=S("sq-magdalena-750","Vino Magdalena Santiago Queirolo 750 ml",[
  "Vino Magdalena Santiago Queriolo Botella 750 mL","Vino Magdalena Santiago Queirolo Botella 750 mL","Vino Santiago Queirolo Magdalena 750 ml"
],"Vino","Vino entrada","Santiago Queirolo","competitor",750);
const flor=S("flor-cana-12-750","Ron Flor de Caña 12 Años 750 ml",[
  "Ron Flor de Caña 12 Años Botella 750 mL","Ron Flor de Cana 12 Años Botella 750 mL"
],"Ron","Ron premium","Flor de Caña","competitor",750);

const SOURCES:Source[]=[
 {retailer:"Tottus Perú",domain:"tottus.com.pe",sourceType:"retailer",priority:100,targets:[
   {url:"https://www.tottus.com.pe/tottus-pe/marca/CUATRO%20GALLOS",specs:[cgQ,cgI,cgMv]},
   {url:"https://www.tottus.com.pe/tottus-pe/articulo/113379269/Ron%20Mandatario%20Solera%20Botella%20750%20mL/113379271",specs:[man]},
   {url:"https://www.tottus.com.pe/tottus-pe/marca/E.COPELLO",specs:[ecoT,ecoM]},
   {url:"https://www.tottus.com.pe/tottus-pe/marca/CASAS%20PATRONALES",specs:[casas]},
   {url:"https://www.tottus.com.pe/tottus-pe/marca/LAGARDE",specs:[lag]},
   {url:"https://www.tottus.com.pe/tottus-pe/lista/CATG16854/Pisco",specs:[sqP,finca]},
   {url:"https://www.tottus.com.pe/tottus-pe/marca/SANTIAGO%20QUEIROLO",specs:[sqV]},
   {url:"https://www.tottus.com.pe/tottus-pe/marca/FLOR%20DE%20CA%C3%91A",specs:[flor]}
 ]},
 {retailer:"Metro Perú",domain:"metro.pe",sourceType:"retailer",priority:95,targets:[
   {url:"https://www.metro.pe/pisco-puro-quebranta-cuatro-gallos-700ml/p",specs:[cgQ]},
   {url:"https://www.metro.pe/pisco-puro-italia-cuatro-gallos-700ml/p",specs:[cgI]},
   {url:"https://www.metro.pe/vino-tinto-semiseco-blend-e-copello-750ml-2/p",specs:[ecoT]},
   {url:"https://www.metro.pe/vino-blanco-semiseco-moscato-e-copello-750ml-2/p",specs:[ecoM]}
 ]},
 {retailer:"Wong",domain:"wong.pe",sourceType:"retailer",priority:95,targets:[
   {url:"https://app.wong.pe/cervezas-vinos-y-licores/licores/pisco/45241?PS=18&map=c%2Cc%2Cc%2CproductClusterSearchableIds",specs:[cgQ,cgI,cgMv]},
   {url:"https://app.wong.pe/cervezas-vinos-y-licores/40352?PS=18&map=c%2CproductClusterSearchableIds",specs:[man]}
 ]},
 {retailer:"Vivanda",domain:"vivanda.com.pe",sourceType:"retailer",priority:90,targets:[
   {url:"https://www.vivanda.com.pe/pisco-cuatro-gallos-puro-quebranta-botella-700ml/p",specs:[cgQ]},
   {url:"https://www.vivanda.com.pe/pisco-cuatro-gallos-puro-italia-botella-700ml/p",specs:[cgI]},
   {url:"https://www.vivanda.com.pe/ron-mandatario-solera-botella-700ml/p",specs:[man]}
 ]},
 {retailer:"Plaza Vea / Makro",domain:"makro.plazavea.com.pe",sourceType:"retailer",priority:85,targets:[
   {url:"https://www.makro.plazavea.com.pe/vinos-licores-y-cervezas/licores/pisco/cuatro-gallos",specs:[cgQ,cgI,cgMv]}
 ]}
];

function decode(s:string){return s.replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;|&#34;/gi,'"').replace(/&#39;|&apos;/gi,"'")}
function clean(s:string){return decode(s).replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function pen(s:string){const n=Number(s.replace(/\s/g,"").replace(",","."));return Number.isFinite(n)&&n>=10&&n<=1000?n:null}
function values(segment:string){const out:number[]=[];const re=/S\/\s*([0-9]{1,4}(?:[.,][0-9]{1,2})?)/gi;for(const m of segment.matchAll(re)){const v=pen(m[1]);if(v&&!out.some(x=>Math.abs(x-v)<.001))out.push(v);if(out.length>=5)break}return out}
function parse(raw:string,t:Target){
  const text=clean(raw),low=text.toLocaleLowerCase("es-PE"),out:Parsed[]=[];
  for(const s of t.specs){
    let idx=-1,alias="",bestDistance=999999;
    for(const a of s.aliases){
      const needle=a.toLocaleLowerCase("es-PE");
      let from=0;
      while(true){
        const pos=low.indexOf(needle,from);
        if(pos<0)break;
        const after=text.slice(pos+a.length,pos+a.length+700);
        const distance=after.indexOf("S/");
        if(distance>=0&&distance<bestDistance){idx=pos;alias=a;bestDistance=distance}
        from=pos+Math.max(1,needle.length);
      }
    }
    if(idx<0)continue;
    const seg=text.slice(idx,idx+alias.length+1300);
    const prices=values(seg);
    if(!prices.length)continue;
    const p1=prices[0],p2=prices[1]??null;
    const current=p2&&p2<p1&&p2/p1>.5?p2:p1;
    const regular=p1>current*1.015?p1:(prices.find(x=>x>current*1.015)??null);
    const pm=seg.match(/-\s*([0-9]{1,2}(?:[.,][0-9])?)\s*%/);
    const d=pm?Number(pm[1].replace(",",".")):regular?Math.round((1-current/regular)*1000)/10:null;
    out.push({...s,currentPrice:current,regularPrice:regular,discountPct:d,promotion:Boolean(d&&d>0),sourceUrl:t.url});
  }
  return out
}
async function fetchPage(url:string){const h={"user-agent":UA,"accept":"text/html,application/xhtml+xml","accept-language":"es-PE,es;q=0.9,en;q=0.6","cache-control":"no-cache"};let r=await fetch(url,{headers:h,redirect:"follow",signal:AbortSignal.timeout(22000)});let raw=await r.text();if(!r.ok||raw.length<500){r=await fetch(url,{headers:{...h,"user-agent":BOT},redirect:"follow",signal:AbortSignal.timeout(22000)});raw=await r.text()}if(!r.ok)throw new Error("HTTP "+r.status);if(raw.length<500)throw new Error("short_html:"+raw.length);return raw}
async function sourceId(brandId:string,s:Source){const {data:e}=await sb.from("brands_vertical_sources").select("id").eq("brand_id",brandId).eq("domain",s.domain).maybeSingle();if(e?.id){await sb.from("brands_vertical_sources").update({retailer_name:s.retailer,source_type:s.sourceType,priority:s.priority,active:true,search_url:s.targets[0]?.url??null}).eq("id",e.id);return e.id}const {data,error}=await sb.from("brands_vertical_sources").insert({brand_id:brandId,retailer_name:s.retailer,domain:s.domain,source_type:s.sourceType,priority:s.priority,active:true,search_url:s.targets[0]?.url??null}).select("id").single();if(error)throw new Error(JSON.stringify(error));return data.id}
async function productId(brandId:string,x:Parsed){const {data,error}=await sb.from("brands_vertical_products").upsert({brand_id:brandId,external_sku:x.key,name:x.name,category:x.category,subcategory:x.marketCategory,product_url:x.sourceUrl,canonical_key:x.key,active:true,last_seen_at:new Date().toISOString(),attributes:{actualBrand:x.actualBrand,role:x.role,ml:x.ml,marketCategory:x.marketCategory,benchmark:"pen-l"}},{onConflict:"brand_id,canonical_key"}).select("id").single();if(error)throw new Error(JSON.stringify(error));return data.id}
async function persist(brandId:string,sid:string,x:Parsed){const pid=await productId(brandId,x);const unitPrice=Math.round((x.currentPrice/(x.ml/1000))*100)/100;const {error}=await sb.from("brands_vertical_listings").insert({brand_id:brandId,source_id:sid,product_id:pid,source_product_key:x.key,title:x.name,brand_name:x.actualBrand,seller_name:x.actualBrand,category:x.category,product_url:x.sourceUrl,regular_price:x.regularPrice,current_price:x.currentPrice,currency:"PEN",in_stock:true,attributes:{actualBrand:x.actualBrand,role:x.role,ml:x.ml,marketCategory:x.marketCategory,unitPrice,benchmark:"pen-l",benchmarkLabel:"S/ por litro",promotion:x.promotion,discountPct:x.discountPct,snapshotType:"automatic",verification:"public_page_observed",market:"PE"},raw:{collector:"peru-liquor-pricing-worker-v1",sourceUrl:x.sourceUrl},observed_at:new Date().toISOString()});if(error)throw new Error(JSON.stringify(error))}
async function pool<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){const out:R[]=[];let i=0;async function run(){while(true){const n=i++;if(n>=items.length)break;out[n]=await fn(items[n])}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));return out}
async function collect(){const {data:b,error:be}=await sb.from("brands_vertical_brands").select("id").eq("slug","bodegas-don-luis").single();if(be||!b)throw new Error("brand_not_found");const {data:run}=await sb.from("brands_vertical_discovery_runs").insert({brand_id:b.id,status:"running",started_at:new Date().toISOString(),sources_attempted:SOURCES.length}).select("id").single();const jobs=SOURCES.flatMap(source=>source.targets.map(target=>({source,target})));const got=await pool(jobs,5,async j=>{try{const raw=await fetchPage(j.target.url);const items=parse(raw,j.target);return {...j,items,status:items.length?"ok":"no-data",error:null}}catch(e){return {...j,items:[] as Parsed[],status:"error",error:e instanceof Error?e.message:String(e)}}});let listings=0,succeeded=0;const products=new Set<string>(),details:any[]=[];for(const s of SOURCES){const sid=await sourceId(b.id,s);const rows=got.filter(x=>x.source.domain===s.domain);let n=0;for(const r of rows)for(const x of r.items){await persist(b.id,sid,x);n++;listings++;products.add(x.key)}if(n>0)succeeded++;const errs=rows.filter(x=>x.status!=="ok").map(x=>({url:x.target.url,status:x.status,error:x.error}));await sb.from("brands_vertical_sources").update({last_crawled_at:new Date().toISOString(),last_status:n?"ok:"+n:"degraded:last-valid-retained",last_error:errs.length?JSON.stringify(errs).slice(0,1200):null}).eq("id",sid);details.push({retailer:s.retailer,domain:s.domain,found:n,attemptedTargets:rows.length,errors:errs})}const status=succeeded===SOURCES.length?"completed":succeeded>0?"partial":"failed";if(run?.id)await sb.from("brands_vertical_discovery_runs").update({status,sources_succeeded:succeeded,listings_found:listings,products_found:products.size,finished_at:new Date().toISOString(),notes:JSON.stringify(details)}).eq("id",run.id);return {slug:"bodegas-don-luis",status,sourcesSucceeded:succeeded,sourcesAttempted:SOURCES.length,listingsFound:listings,productsFound:products.size,details}}
Deno.serve(async(req:Request)=>{if(req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});const token=req.headers.get("x-worker-token");if(!token)return Response.json({error:"unauthorized"},{status:401});const {data:ok,error:ae}=await sb.rpc("verify_peru_liquor_worker_token",{p_token:token});if(ae||ok!==true)return Response.json({error:"unauthorized"},{status:401});const body=await req.json().catch(()=>({}));if(body?.slug&&body.slug!=="bodegas-don-luis")return Response.json({error:"unknown_slug"},{status:400});try{const result=await collect();return Response.json({ok:result.status!=="failed",observedAt:new Date().toISOString(),result})}catch(e){return Response.json({ok:false,observedAt:new Date().toISOString(),error:e instanceof Error?e.message:String(e)},{status:500})}});
