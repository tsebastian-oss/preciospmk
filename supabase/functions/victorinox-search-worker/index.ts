import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BRAND_SLUG="victorinox";

type Runtime={enabled?:boolean;api_key?:string|null;model?:string|null};
type Row={title:string;product_url:string;current_price:number|null;regular_price:number|null;in_stock:boolean|null;seller_name:string|null;category:string;source_freshness:string|null};

function norm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();}
function sourceKey(url:string){const m=url.match(/(MLCU?\d+)/i);if(m?.[1])return m[1].toUpperCase();return "web-"+crypto.subtle?crypto.randomUUID():String(Date.now());}
function outputText(r:any){return typeof r?.output_text==="string"?r.output_text.trim():(r?.output??[]).flatMap((x:any)=>x?.content??[]).filter((x:any)=>x?.type==="output_text"&&typeof x.text==="string").map((x:any)=>x.text).join("\n").trim();}
async function runtime(){for(let i=0;i<4;i++){const{data,error}=await supabase.rpc("get_ai_runtime_config_service");if(data)return data as Runtime;await new Promise(r=>setTimeout(r,350*(i+1)));if(i===3)throw new Error(error?.message||"runtime_config_error");}throw new Error("runtime_config_error");}
async function model(apiKey:string){try{const r=await fetch("https://api.openai.com/v1/models",{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000)});const j=await r.json();const ids=new Set<string>((j?.data??[]).map((x:any)=>String(x.id)));for(const id of ["gpt-5.6","gpt-5.5","gpt-5.1","gpt-5","gpt-4.1"])if(ids.has(id))return id;}catch{}return"gpt-4.1";}
function validUrl(mode:string,value:string){try{const u=new URL(value);return mode==="official"?u.hostname.endsWith("victorinoxstore.cl"):u.hostname.endsWith("mercadolibre.cl");}catch{return false}}
function category(title:string,reported:string){const t=norm(title+" "+reported);if(/reloj|watch|chrono|automatic|quartz/.test(t))return"Relojes";if(/maleta|equipaje|mochila|bolso|trolley|carry|spinner|travel|billetera|pasaporte|necesser/.test(t))return"Equipo de viaje";if(/navaj|multiherr|swiss army|spartan|climber|huntsman|cadet|classic sd|explorer|swisstool/.test(t))return"Navajas y multiherramientas";return"Cuchillos";}

async function search(apiKey:string,modelName:string,mode:"official"|"marketplace"):Promise<Row[]>{
 const prompt=mode==="official"?`
Revisa el sitio oficial chileno de Victorinox: victorinoxstore.cl.
Busca productos actualmente visibles con precio en estas secciones: Relojes, Equipo de viaje, Navajas y multiherramientas, Cuchillos.
Fuentes prioritarias:
https://www.victorinoxstore.cl/relojes/
https://www.victorinoxstore.cl/equipo-de-viaje
https://www.victorinoxstore.cl/cuchillos/
https://www.victorinoxstore.cl/navajas-y-multiherramientas
Devuelve hasta 45 productos distintos. No inventes datos. Solo URLs de victorinoxstore.cl.
`:`
Busca exhaustivamente en MercadoLibre Chile publicaciones actuales de productos Victorinox. Prioriza relojes, equipo de viaje, navajas/multiherramientas y cuchillos. Devuelve hasta 30 publicaciones distintas. Solo productos realmente Victorinox y URLs de mercadolibre.cl. No inventes precio, stock, seller ni URL.
`;
 const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({
  model:modelName,input:prompt+"\nPara cada producto entrega title, product_url, current_price CLP, regular_price si hay precio anterior, in_stock, seller_name, category y source_freshness. Responde solo con la estructura pedida.",store:false,
  tools:[{type:"web_search_preview",search_context_size:"high",user_location:{type:"approximate",country:"CL",timezone:"America/Santiago"}}],
  tool_choice:{type:"web_search_preview"},max_output_tokens:7000,
  text:{format:{type:"json_schema",name:"victorinox_products",strict:true,schema:{type:"object",additionalProperties:false,properties:{listings:{type:"array",maxItems:50,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},product_url:{type:"string"},current_price:{type:["number","null"]},regular_price:{type:["number","null"]},in_stock:{type:["boolean","null"]},seller_name:{type:["string","null"]},category:{type:"string"},source_freshness:{type:["string","null"]}},required:["title","product_url","current_price","regular_price","in_stock","seller_name","category","source_freshness"]}}},required:["listings"]}}}
 }),signal:AbortSignal.timeout(65_000)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`openai_${r.status}:${j?.error?.message||""}`);
 const text=outputText(j);if(!text)return[];const rows=JSON.parse(text)?.listings??[];
 return rows.filter((x:any)=>x&&typeof x.title==="string"&&validUrl(mode,String(x.product_url||""))).map((x:any)=>({
  title:String(x.title).slice(0,500),product_url:String(x.product_url),
  current_price:Number(x.current_price)>0?Number(x.current_price):null,
  regular_price:Number(x.regular_price)>0?Number(x.regular_price):null,
  in_stock:typeof x.in_stock==="boolean"?x.in_stock:null,
  seller_name:typeof x.seller_name==="string"?x.seller_name.slice(0,160):null,
  category:category(String(x.title),String(x.category||"")),
  source_freshness:typeof x.source_freshness==="string"?x.source_freshness.slice(0,80):null
 }));
}
async function getSource(brandId:string,mode:"official"|"marketplace"){const domain=mode==="official"?"victorinoxstore.cl":"mercadolibre.cl";const retailer=mode==="official"?"Victorinox Store Chile":"Mercado Libre";const type=mode==="official"?"official":"marketplace";const{data,error}=await supabase.from("brands_vertical_sources").select("id").eq("brand_id",brandId).eq("domain",domain).maybeSingle();if(error)throw error;if(data?.id){await supabase.from("brands_vertical_sources").update({retailer_name:retailer,source_type:type,active:true}).eq("id",data.id);return data.id as string;}const ins=await supabase.from("brands_vertical_sources").insert({brand_id:brandId,retailer_name:retailer,domain,source_type:type,search_url:mode==="official"?"https://www.victorinoxstore.cl/":"https://listado.mercadolibre.cl/victorinox",priority:mode==="official"?130:115,active:true}).select("id").single();if(ins.error)throw ins.error;return ins.data.id as string;}
async function persist(brandId:string,sourceId:string,mode:"official"|"marketplace",row:Row){const key=mode==="marketplace"?(row.product_url.match(/(MLCU?\d+)/i)?.[1]?.toUpperCase()||"ml-"+crypto.randomUUID()):"official-"+btoa(row.product_url).replace(/[^a-z0-9]/gi,"").slice(-70);const canonical=`${mode}:${key.toLowerCase()}`;const p=await supabase.from("brands_vertical_products").upsert({brand_id:brandId,external_sku:key,name:row.title,category:row.category,product_url:row.product_url,canonical_key:canonical,active:row.in_stock!==false,last_seen_at:new Date().toISOString(),attributes:{actualBrand:"Victorinox",role:"brand",channel:mode,sourceFreshness:row.source_freshness}},{onConflict:"brand_id,canonical_key"}).select("id").single();if(p.error)throw p.error;
 const latest=await supabase.from("brands_vertical_listings").select("current_price,regular_price,in_stock,observed_at").eq("source_id",sourceId).eq("source_product_key",key).order("observed_at",{ascending:false}).limit(1).maybeSingle();
 const same=latest.data&&Number(latest.data.current_price??0)===Number(row.current_price??0)&&Number(latest.data.regular_price??0)===Number(row.regular_price??0)&&latest.data.in_stock===row.in_stock&&Date.now()-new Date(latest.data.observed_at).getTime()<20*3600*1000;if(same)return false;
 const l=await supabase.from("brands_vertical_listings").insert({brand_id:brandId,source_id:sourceId,product_id:p.data.id,source_product_key:key,title:row.title,brand_name:"Victorinox",seller_name:row.seller_name,category:row.category,product_url:row.product_url,regular_price:row.regular_price,current_price:row.current_price,currency:"CLP",in_stock:row.in_stock,attributes:{actualBrand:"Victorinox",role:"brand",channel:mode,verification:"openai_web_search",sourceFreshness:row.source_freshness},raw:{collector:"victorinox-search-worker-v1",mode},observed_at:new Date().toISOString()});if(l.error)throw l.error;return true;}
async function run(mode:"official"|"marketplace"){const b=await supabase.from("brands_vertical_brands").select("id").eq("slug",BRAND_SLUG).single();if(b.error)throw new Error(b.error.message||"brand_lookup_error");const sourceId=await getSource(b.data.id,mode);const cfg=await runtime();if(!cfg.enabled||!cfg.api_key)throw new Error("ai_runtime_unavailable");const m=await model(cfg.api_key);const rows=await search(cfg.api_key,m,mode);let inserted=0,priced=0;const errors:string[]=[];for(const row of rows){try{if(await persist(b.data.id,sourceId,mode,row))inserted++;if(row.current_price)priced++;}catch(error){errors.push(error instanceof Error?error.message:JSON.stringify(error));}}const usable=rows.length-errors.length;await supabase.from("brands_vertical_sources").update({last_crawled_at:new Date().toISOString(),last_status:`ok:${usable}:inserted:${inserted}:priced:${priced}:errors:${errors.length}`,last_error:errors.length?errors.slice(0,3).join(" | ").slice(0,700):null}).eq("id",sourceId);return{mode,model:m,found:rows.length,usable,inserted,priced,errors:errors.slice(0,5)};}

Deno.serve(async(req:Request)=>{if(req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});const supplied=req.headers.get("x-victorinox-worker-token");const cfg=await supabase.from("qsr_worker_config").select("token").eq("id",1).single();if(!supplied||!cfg.data?.token||supplied!==cfg.data.token)return Response.json({error:"unauthorized"},{status:401});const body=await req.json().catch(()=>({}));const mode=body?.mode==="marketplace"?"marketplace":"official";try{return Response.json({ok:true,result:await run(mode)});}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:JSON.stringify(e)},{status:500});}});
