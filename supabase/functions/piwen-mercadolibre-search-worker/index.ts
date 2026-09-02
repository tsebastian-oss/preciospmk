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
async function workerToken(){
  let lastError:string|null=null;
  for(let attempt=0;attempt<4;attempt++){
    const {data,error}=await supabase.from("qsr_worker_config").select("token").eq("id",1).single();
    if(data?.token) return {token:String(data.token),error:null};
    lastError=error?.message??"token_not_found";
    await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
  }
  return {token:null,error:lastError};
}

async function runtimeConfig(){
  let lastError:string|null=null;
  for(let attempt=0;attempt<4;attempt++){
    const {data,error}=await supabase.rpc("get_ai_runtime_config_service");
    if(data) return {data:data as Runtime,error:null};
    lastError=error?.message??"runtime_config_not_found";
    await new Promise(resolve=>setTimeout(resolve,450*(attempt+1)));
  }
  return {data:null,error:lastError};
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
  const anchors = target.brand==="Piwén" ? [
    "https://www.mercadolibre.cl/tienda/piwen",
    "https://www.mercadolibre.cl/piwen-almendra-natural-1-kilo-sin-sal-frutos-secos/p/MLC37030161",
    "https://www.mercadolibre.cl/piwen-castanas-de-caju-sin-sal-1-kilo-anacardos-snack-frutos-secos-saludables/p/MLC37056337",
    "https://www.mercadolibre.cl/pistachos-salado-con-cascara-piwen-de-1-kg/p/MLC65495393"
  ] : target.brand==="Alto La Cruz" ? [
    "https://www.mercadolibre.cl/almendras-tostadas-enteras-700g-frutos-secos-alto-la-cruz/p/MLC65359625",
    "https://www.mercadolibre.cl/mix-frutos-secos-pistacho-almendras-avellanas-chilena-y-mas-happy-hour-alto-la-cruz-linea-colors-450g/p/MLC65358406"
  ] : [
    "https://www.mercadolibre.cl/almendras-saladas-millantu-doy-pack-80-g/p/MLC26334548",
    "https://www.mercadolibre.cl/pistachos-salados-millantu-doy-pack-150-g/p/MLC29360995",
    "https://www.mercadolibre.cl/castana-de-caju-salada-80-gr-pack-8-unidades-millantu/up/MLCU1799155379"
  ];
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
- Empieza verificando estas URL conocidas y luego busca publicaciones adicionales de la misma marca:
${anchors.join("\n")}
La respuesta debe contener solo la estructura solicitada.`;

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},
    body:JSON.stringify({
      model,
      input:prompt,
      store:false,
      tools:[{type:"web_search_preview",search_context_size:"high",user_location:{type:"approximate",country:"CL",timezone:"America/Santiago"}}],
      tool_choice:{type:"web_search_preview"},
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
async function persist(brandId:string,sourceId:string,target:Target,row:AiRow,runId:string|null,observedAt:string){
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

  const {error:lErr}=await supabase.from("brands_vertical_listings").insert({
    brand_id:brandId,source_id:sourceId,product_id:product.id,source_product_key:sourceKey,title:row.title,brand_name:target.brand,
    seller_name:row.seller_name,category:family,product_url:row.product_url,regular_price:row.regular_price,current_price:row.current_price,
    currency:"CLP",in_stock:row.in_stock,
    attributes:{actualBrand:target.brand,role:target.role,marketplace:"MercadoLibre Chile",family,grams:row.grams,pricePerKg,discountPct,snapshotType:"automatic",verification:"openai_web_search_mercadolibre",sourceFreshness:row.source_freshness,discoveryRunId:runId},
    raw:{collector:"piwen-mercadolibre-search-worker-v2",retrieval:"OpenAI Responses web_search",sourceFreshness:row.source_freshness,discoveryRunId:runId},
    observed_at:observedAt
  });
  if(lErr) throw lErr;
  return {inserted:true,key:sourceKey};
}

async function run(onlyBrand?:string){
  const {data:subject,error:bErr}=await supabase.from("brands_vertical_brands").select("id").eq("slug",SUBJECT_SLUG).single();
  if(bErr||!subject) throw new Error("brand_not_found:piwen");
  const sourceId=await ensureSource(subject.id);
  const observedAt=new Date().toISOString();

  const {data:discoveryRun,error:runErr}=await supabase.from("brands_vertical_discovery_runs").insert({
    brand_id:subject.id,
    status:"running",
    started_at:observedAt,
    sources_attempted:1,
    notes:JSON.stringify({collector:"piwen-mercadolibre-search-worker-v2",source:"mercadolibre.cl",onlyBrand:onlyBrand??null})
  }).select("id").single();
  if(runErr) throw runErr;

  try{
    const runtime=await runtimeConfig();
    const cfg=(runtime.data??{}) as Runtime;
    if(runtime.error||!cfg.enabled||!cfg.api_key) throw new Error("ai_runtime_unavailable:"+String(runtime.error??"missing_config"));
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
          const saved=await persist(subject.id,sourceId,target,row,discoveryRun?.id??null,observedAt);
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
    const finishedAt=new Date().toISOString();
    await supabase.from("brands_vertical_sources").update({
      last_crawled_at:finishedAt,
      last_status:found>0?`ok:${found}:inserted:${inserted}:priced:${priced}`:"degraded:last-valid-retained",
      last_error:found>0?null:JSON.stringify(results).slice(0,900)
    }).eq("id",sourceId);
    if(discoveryRun?.id){
      await supabase.from("brands_vertical_discovery_runs").update({
        status,
        sources_succeeded:found>0?1:0,
        listings_found:found,
        products_found:found,
        finished_at:finishedAt,
        notes:JSON.stringify({collector:"piwen-mercadolibre-search-worker-v2",model,found,inserted,priced,results})
      }).eq("id",discoveryRun.id);
    }
    return {status,model,found,inserted,priced,results,runId:discoveryRun?.id??null};
  }catch(error){
    if(discoveryRun?.id){
      await supabase.from("brands_vertical_discovery_runs").update({
        status:"failed",
        sources_succeeded:0,
        finished_at:new Date().toISOString(),
        notes:JSON.stringify({collector:"piwen-mercadolibre-search-worker-v2",error:error instanceof Error?error.message:String(error)})
      }).eq("id",discoveryRun.id);
    }
    throw error;
  }
}

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return Response.json({error:"method_not_allowed"},{status:405});
  const token=request.headers.get("x-marketplace-worker-token");
  const expected=await workerToken();
  if(!token||!expected.token||token!==expected.token) return Response.json({
    error:"unauthorized",
    reason:!token?"missing_header":expected.error?"config_error":!expected.token?"config_missing":"token_mismatch",
    suppliedLength:token?.length??0,
    expectedLength:expected.token?.length??0,
    configError:expected.error
  },{status:401});
  const body=await request.json().catch(()=>({}));
  try{return Response.json({ok:true,observedAt:new Date().toISOString(),result:await run(typeof body.brand==="string"?body.brand:undefined)});}
  catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
});
