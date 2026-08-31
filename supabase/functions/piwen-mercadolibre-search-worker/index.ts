import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, service);
const SUBJECT_SLUG = "piwen";

type Target = { brand: "Piwén"|"Alto La Cruz"|"Millantú"; role: "brand"|"competitor" };
type AiRow = {
  brand: string;
  title: string;
  product_url: string;
  current_price: number|null;
  regular_price: number|null;
  in_stock: boolean|null;
  seller_name: string|null;
  grams: number|null;
  family: string;
  source_freshness: string|null;
};
type Runtime = { enabled?: boolean; api_key?: string|null; model?: string|null };

const TARGETS: Target[] = [
  { brand:"Piwén", role:"brand" },
  { brand:"Alto La Cruz", role:"competitor" },
  { brand:"Millantú", role:"competitor" },
];

function norm(v:string){
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}
function keyFor(productUrl:string){
  const m=productUrl.match(/(MLCU?\d+)/i);
  if(m?.[1]) return m[1].toUpperCase();
  return "ML-"+crypto.randomUUID();
}
function familyFor(title:string, reported:string){
  const t=norm(title);
  if(/castan(?:a|as).*caju|caju|cashew/.test(t)) return "Castañas de cajú";
  if(/pistach/.test(t)) return "Pistachos";
  if(/almendr/.test(t)) return "Almendras";
  if(/nuez|nueces/.test(t)) return "Nueces";
  if(/mani/.test(t)) return "Maní";
  if(/avellan/.test(t)) return "Avellanas";
  if(/mix|frutos secos/.test(t)) return "Mixes";
  if(/semilla/.test(t)) return "Semillas";
  return reported && reported !== "Otro" ? reported : "Frutos secos";
}
function validMlUrl(value:string){
  try{
    const u=new URL(value);
    return (u.hostname==="www.mercadolibre.cl"||u.hostname==="mercadolibre.cl")
      && /(?:\/p\/MLC\d+|\/up\/MLCU\d+|MLC-\d+)/i.test(u.pathname);
  }catch{return false}
}
function outputText(r:any){
  return typeof r?.output_text==="string" ? r.output_text.trim()
    : (r?.output??[]).flatMap((x:any)=>x?.content??[])
      .filter((x:any)=>x?.type==="output_text"&&typeof x.text==="string")
      .map((x:any)=>x.text).join("\n").trim();
}
async function chooseModel(apiKey:string){
  try{
    const r=await fetch("https://api.openai.com/v1/models",{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000)});
    const j=await r.json().catch(()=>({}));
    const ids=new Set<string>(Array.isArray(j?.data)?j.data.map((x:any)=>String(x?.id||"")):[]);
    for(const id of ["gpt-5.5","gpt-5.4","gpt-5.2","gpt-5.1","gpt-5","gpt-4.1"]){if(ids.has(id)) return id;}
  }catch{}
  return "gpt-4.1";
}
async function webSearch(apiKey:string, model:string, target:Target):Promise<AiRow[]>{
  const prompt=`Busca exhaustivamente en MercadoLibre Chile (mercadolibre.cl) publicaciones de frutos secos de la marca "${target.brand}".
REQUISITOS:
- Solo devuelve publicaciones cuyo producto sea realmente de la marca ${target.brand}; evita homónimos (por ejemplo lugares llamados Millantú o marcas de papel).
- Prioriza almendras, castañas de cajú, pistachos, nueces, maní, mixes, avellanas, semillas y fruta deshidratada.
- Devuelve hasta 15 publicaciones distintas con URL canónica de MercadoLibre Chile.
- Usa el precio visible más reciente que encuentres. Si la publicación existe pero dice "no disponible", current_price=null e in_stock=false.
- regular_price solo si aparece un precio anterior/tachado explícito.
- grams es peso neto total del producto o pack en gramos, solo si se puede determinar.
- No inventes ningún precio, URL, vendedor, peso ni disponibilidad.
- source_freshness describe brevemente la antigüedad de la evidencia encontrada (por ejemplo "hoy", "3 días", "último mes").
La respuesta debe contener solo la estructura solicitada.`;

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},
    body:JSON.stringify({
      model,
      input:prompt,
      store:false,
      tools:[{type:"web_search_preview",search_context_size:"high",user_location:{type:"approximate",country:"CL",timezone:"America/Santiago"}}],
      tool_choice:"auto",
      max_output_tokens:3500,
      text:{format:{
        type:"json_schema",
        name:"mercadolibre_listings",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          properties:{
            listings:{
              type:"array",
              maxItems:15,
              items:{
                type:"object",
                additionalProperties:false,
                properties:{
                  brand:{type:"string"},
                  title:{type:"string"},
                  product_url:{type:"string"},
                  current_price:{type:["number","null"]},
                  regular_price:{type:["number","null"]},
                  in_stock:{type:["boolean","null"]},
                  seller_name:{type:["string","null"]},
                  grams:{type:["number","null"]},
                  family:{type:"string",enum:["Almendras","Castañas de cajú","Pistachos","Nueces","Maní","Mixes","Avellanas","Semillas","Fruta deshidratada","Otro"]},
                  source_freshness:{type:["string","null"]}
                },
                required:["brand","title","product_url","current_price","regular_price","in_stock","seller_name","grams","family","source_freshness"]
              }
            }
          },
          required:["listings"]
        }
      }}
    }),
    signal:AbortSignal.timeout(55_000)
  });
  const raw=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`openai_${response.status}:${String(raw?.error?.message||"").slice(0,240)}`);
  const text=outputText(raw);
  if(!text) return [];
  const parsed=JSON.parse(text);
  const rows=Array.isArray(parsed?.listings)?parsed.listings:[];
  return rows.filter((row:any)=>
    row && typeof row.title==="string" && typeof row.product_url==="string"
    && validMlUrl(row.product_url)
    && norm(row.brand||"").includes(norm(target.brand).replace("é","e").replace("ú","u"))
  ).map((row:any)=>({
    brand:target.brand,
    title:String(row.title).trim().slice(0,500),
    product_url:String(row.product_url),
    current_price:Number.isFinite(Number(row.current_price))&&Number(row.current_price)>0?Number(row.current_price):null,
    regular_price:Number.isFinite(Number(row.regular_price))&&Number(row.regular_price)>0?Number(row.regular_price):null,
    in_stock:typeof row.in_stock==="boolean"?row.in_stock:null,
    seller_name:typeof row.seller_name==="string"&&row.seller_name.trim()?row.seller_name.trim().slice(0,160):null,
    grams:Number.isFinite(Number(row.grams))&&Number(row.grams)>0?Math.round(Number(row.grams)):null,
    family:familyFor(String(row.title),String(row.family||"")),
    source_freshness:typeof row.source_freshness==="string"?row.source_freshness.slice(0,80):null
  }));
}
async function ensureSource(brandId:string){
  const payload={retailer_name:"MercadoLibre Chile",domain:"mercadolibre.cl",source_type:"marketplace",search_url:"https://www.mercadolibre.cl/tienda/piwen",priority:110,active:true};
  const {data:existing,error:lookupError}=await supabase.from("brands_vertical_sources").select("id").eq("brand_id",brandId).eq("domain","mercadolibre.cl").maybeSingle();
  if(lookupError) throw lookupError;
  if(existing?.id){const {error}=await supabase.from("brands_vertical_sources").update(payload).eq("id",existing.id);if(error)throw error;return existing.id as string;}
  const {data,error}=await supabase.from("brands_vertical_sources").insert({brand_id:brandId,...payload}).select("id").single();if(error)throw error;return data.id as string;
}
async function persist(brandId:string,sourceId:string,target:Target,row:AiRow){
  const sourceKey=keyFor(row.product_url);
  const canonical=`mercadolibre:${sourceKey.toLowerCase()}`;
  const family=familyFor(row.title,row.family);
  const {data:product,error:pErr}=await supabase.from("brands_vertical_products").upsert({
    brand_id:brandId,external_sku:sourceKey,name:row.title,category:family,product_url:row.product_url,canonical_key:canonical,
    active:row.in_stock!==false,last_seen_at:new Date().toISOString(),
    attributes:{actualBrand:target.brand,role:target.role,marketplace:"MercadoLibre Chile",family,grams:row.grams,sourcePolicy:"openai-web-search"}
  },{onConflict:"brand_id,canonical_key"}).select("id").single();
  if(pErr) throw pErr;

  const pricePerKg=row.current_price&&row.grams?Math.round(row.current_price*1000/row.grams):null;
  const discountPct=row.regular_price&&row.current_price&&row.regular_price>row.current_price?Math.round((1-row.current_price/row.regular_price)*1000)/10:null;

  const {data:latest}=await supabase.from("brands_vertical_listings")
    .select("current_price,regular_price,in_stock,observed_at")
    .eq("source_id",sourceId).eq("source_product_key",sourceKey)
    .order("observed_at",{ascending:false}).limit(1).maybeSingle();

  const same=latest
    && Number(latest.current_price??0)===Number(row.current_price??0)
    && Number(latest.regular_price??0)===Number(row.regular_price??0)
    && latest.in_stock===row.in_stock
    && Date.now()-new Date(latest.observed_at).getTime()<20*60*60*1000;
  if(same) return {inserted:false,key:sourceKey};

  const {error:lErr}=await supabase.from("brands_vertical_listings").insert({
    brand_id:brandId,source_id:sourceId,product_id:product.id,source_product_key:sourceKey,title:row.title,brand_name:target.brand,
    seller_name:row.seller_name,category:family,product_url:row.product_url,regular_price:row.regular_price,current_price:row.current_price,
    currency:"CLP",in_stock:row.in_stock,
    attributes:{actualBrand:target.brand,role:target.role,marketplace:"MercadoLibre Chile",family,grams:row.grams,pricePerKg,discountPct,snapshotType:"automatic",verification:"openai_web_search_mercadolibre",sourceFreshness:row.source_freshness},
    raw:{collector:"piwen-mercadolibre-search-worker-v1",retrieval:"OpenAI Responses web_search",sourceFreshness:row.source_freshness},
    observed_at:new Date().toISOString()
  });
  if(lErr) throw lErr;
  return {inserted:true,key:sourceKey};
}

async function run(onlyBrand?:string){
  const {data:subject,error:bErr}=await supabase.from("brands_vertical_brands").select("id").eq("slug",SUBJECT_SLUG).single();
  if(bErr||!subject) throw new Error("brand_not_found:piwen");
  const sourceId=await ensureSource(subject.id);

  const {data:runtime,error:rErr}=await supabase.rpc("get_ai_runtime_config_service");
  const cfg=(runtime??{}) as Runtime;
  if(rErr||!cfg.enabled||!cfg.api_key) throw new Error("ai_runtime_unavailable");
  const model=await chooseModel(cfg.api_key);

  const targets=onlyBrand?TARGETS.filter(x=>norm(x.brand)===norm(onlyBrand)):TARGETS;
  if(!targets.length) throw new Error("unknown_brand");
  const results:any[]=[];
  let found=0,inserted=0,priced=0;

  for(const target of targets){
    try{
      const rows=await webSearch(cfg.api_key,model,target);
      let targetInserted=0,targetPriced=0;
      for(const row of rows){
        const saved=await persist(subject.id,sourceId,target,row);
        if(saved.inserted) targetInserted++;
        if(row.current_price) targetPriced++;
      }
      found+=rows.length;inserted+=targetInserted;priced+=targetPriced;
      results.push({brand:target.brand,status:rows.length?"ok":"no_data",found:rows.length,inserted:targetInserted,priced:targetPriced});
    }catch(error){
      results.push({brand:target.brand,status:"error",error:error instanceof Error?error.message:String(error)});
    }
  }

  const status=found>0?"completed":"failed";
  await supabase.from("brands_vertical_sources").update({
    last_crawled_at:new Date().toISOString(),
    last_status:found>0?`ok:${found}:inserted:${inserted}:priced:${priced}`:"degraded:last-valid-retained",
    last_error:found>0?null:JSON.stringify(results).slice(0,900)
  }).eq("id",sourceId);
  return {status,model,found,inserted,priced,results};
}

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return Response.json({error:"method_not_allowed"},{status:405});
  const token=request.headers.get("x-marketplace-worker-token");
  const {data:config}=await supabase.from("qsr_worker_config").select("token").eq("id",1).single();
  if(!token||!config?.token||token!==config.token) return Response.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>({}));
  try{return Response.json({ok:true,observedAt:new Date().toISOString(),result:await run(typeof body.brand==="string"?body.brand:undefined)});}
  catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
});
