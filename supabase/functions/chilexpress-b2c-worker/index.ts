import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Runtime={enabled?:boolean;api_key?:string|null;model?:string|null};
type ProviderKey="blue"|"starken"|"correos"|"chilexpress";

const PROVIDERS:Record<ProviderKey,{name:string;group:string;domains:string[];seedUrls:string[];notes:string}> = {
  blue:{name:"Blue Express",group:"Blue Express",domains:["blue.cl"],seedUrls:["https://www.blue.cl/docs/enviar/tarifario-pyme.pdf","https://www.blue.cl/"],notes:"Prioriza tarifarios PDF oficiales y tablas de zonas/regiones."},
  starken:{name:"Starken",group:"Starken",domains:["starken.cl"],seedUrls:["https://www.starken.cl/tarifa-simple","https://www.starken.cl/cotizador"],notes:"Prioriza Tarifa Simple y el cotizador oficial. Si el precio dinámico no es visible públicamente, no lo inventes."},
  correos:{name:"CorreosChile",group:"CorreosChile",domains:["correos.cl"],seedUrls:["https://www.correos.cl/cotizador"],notes:"Usa solo el cotizador público/referencial. No uses APIs que requieran credenciales de cliente."},
  chilexpress:{name:"Chilexpress",group:"Chilexpress",domains:["chilexpress.cl"],seedUrls:["https://www.chilexpress.cl/"],notes:"Busca tarifas públicas/cotizador oficial para construir la referencia propia."}
};

const DESTINATIONS=["Santiago Centro","Rancagua","Valparaíso","Talca","Chillán","Concepción","La Serena","Copiapó","Temuco","Valdivia","Puerto Montt","Antofagasta","Iquique","Arica"];
const STARKEN_ANCHORS=["Santiago","Arica","Iquique","Antofagasta","Copiapó","La Serena","Valparaíso","Rancagua","Talca","Chillán","Concepción","Temuco","Valdivia","Puerto Montt","Coyhaique","Punta Arenas"];
const WEIGHTS=[0.5,1,3,5,6,10,20];
const STARKEN_PROFILES=[
  {weightKg:0.5,heightCm:10,widthCm:10,lengthCm:20,label:"0–0,5 kg"},
  {weightKg:1,heightCm:10,widthCm:15,lengthCm:25,label:"0,5–1 kg"},
  {weightKg:3,heightCm:15,widthCm:20,lengthCm:30,label:"1–3 kg"},
  {weightKg:5,heightCm:20,widthCm:30,lengthCm:40,label:"3–6 kg"},
  {weightKg:10,heightCm:25,widthCm:25,lengthCm:60,label:"6–10 kg"}
];

function clean(v:string){return String(v??"").replace(/[\u0000-\u001f\u007f]/g,"").trim()}
function canonicalDestination(v:string){
  const raw=clean(v),n=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z]/g,"");
  if(n.startsWith("santiag"))return "Santiago Centro";
  if(n.startsWith("rancag"))return "Rancagua";
  if(n.startsWith("valpar"))return "Valparaíso";
  if(n.startsWith("talca"))return "Talca";
  if(n.startsWith("chill"))return "Chillán";
  if(n.startsWith("concepci"))return "Concepción";
  if(n.startsWith("laserena"))return "La Serena";
  if(n.startsWith("copiap"))return "Copiapó";
  if(n.startsWith("temuco"))return "Temuco";
  if(n.startsWith("valdiv"))return "Valdivia";
  if(n.startsWith("puertomont"))return "Puerto Montt";
  if(n.startsWith("antofag"))return "Antofagasta";
  if(n.startsWith("iquiq"))return "Iquique";
  if(n.startsWith("arica"))return "Arica";
  return raw;
}
function sourceEvidenceValid(key:ProviderKey,x:any){
  const ev=clean(x?.evidence||""),url=clean(x?.source_url||""),fresh=clean(x?.source_freshness||"");
  if(!/\$\s*[0-9]/.test(ev))return false;
  if(key==="correos")return /\.pdf(?:$|[?#])/i.test(url)&&/2026/.test(fresh);
  return true;
}
function hostOk(key:ProviderKey,url:string){try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,"");return PROVIDERS[key].domains.some(d=>h===d||h.endsWith("."+d));}catch{return false}}
function outputText(j:any){return typeof j?.output_text==="string"?j.output_text.trim():(j?.output??[]).flatMap((x:any)=>x?.content??[]).filter((x:any)=>x?.type==="output_text"&&typeof x.text==="string").map((x:any)=>x.text).join("\n").trim()}
async function runtime(){const {data,error}=await sb.rpc("get_ai_runtime_config_service");if(error||!data)throw new Error(error?.message||"ai_runtime_missing");return data as Runtime}
async function model(apiKey:string,preferred?:string|null){if(preferred&&preferred!=="auto")return preferred;try{const r=await fetch("https://api.openai.com/v1/models",{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(8000)});const j=await r.json();const ids=new Set<string>((j?.data??[]).map((x:any)=>String(x.id)));for(const id of ["gpt-5.6","gpt-5.5","gpt-5.1","gpt-5","gpt-4.1"])if(ids.has(id))return id;}catch{}return "gpt-4.1"}
async function digest(s:string){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,24)}
function weightBand(w:number|null){if(!w||w<=0)return"Sin peso";if(w<=0.5)return"0–0,5 kg";if(w<=1)return"0,5–1 kg";if(w<=3)return"1–3 kg";if(w<=6)return"3–6 kg";if(w<=10)return"6–10 kg";if(w<=20)return"10–20 kg";return"20+ kg"}

async function searchStarkenDirect(workerToken:string,triggerKind:string){
  const quotes:any[]=[];
  const destinations=triggerKind==="manual"?DESTINATIONS:STARKEN_ANCHORS;
  let origins=["Santiago"];
  if(triggerKind==="schedule"){
    const day=Math.floor(Date.now()/86_400_000);
    const first=day%STARKEN_ANCHORS.length;
    origins=[STARKEN_ANCHORS[first],STARKEN_ANCHORS[(first+7)%STARKEN_ANCHORS.length]];
  }else if(triggerKind==="backfill"){
    origins=STARKEN_ANCHORS;
  }
  for(const origin of origins){
  for(const destination of destinations){
    for(const profile of STARKEN_PROFILES){
      for(const deliveryType of ["DOMICILIO","AGENCIA"]){
        quotes.push({origin,destination,weightKg:profile.weightKg,heightCm:profile.heightCm,widthCm:profile.widthCm,lengthCm:profile.lengthCm,deliveryType,packageType:"PAQUETE",service:"NORMAL",profileLabel:profile.label});
      }
    }
  }
  }
  const results:any[]=[];
  for(let i=0;i<quotes.length;i+=30){
    const batch=quotes.slice(i,i+30);
    const r=await fetch("https://preciospmk.vercel.app/api/internal/starken-smart-quote",{
      method:"POST",
      headers:{"content-type":"application/json","x-chilexpress-worker-token":workerToken},
      body:JSON.stringify({quotes:batch}),
      signal:AbortSignal.timeout(55_000)
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(`starken_quote_proxy_${r.status}:${j?.error||"unknown"}`);
    results.push(...(Array.isArray(j?.results)?j.results:[]));
  }
  const day=new Date().toISOString().slice(0,10);
  const rates=results.filter((x:any)=>x?.ok&&Number(x?.priceClp)>0).map((x:any)=>({
    origin:canonicalDestination(String(x?.origin||x?.input?.origin||"")),
    destination:canonicalDestination(String(x?.destination||x?.input?.destination||"")),
    weight_kg:Number(x?.input?.weightKg)>0?Number(x.input.weightKg):null,
    weight_band:String(x?.input?.profileLabel||weightBand(Number(x?.input?.weightKg)||null)),
    service_type:String(x?.serviceType||"NORMAL"),
    delivery_type:String(x?.deliveryType||x?.input?.deliveryType||"DOMICILIO"),
    unit_price_clp:Number(x.priceClp),
    source_url:"https://www.starken.cl/cotizador",
    evidence:`Cotización interactiva oficial Starken ${String(x?.origin||"SANTIAGO")} → ${String(x?.destination||x?.input?.destination||"")}, ${Number(x?.input?.weightKg)||0} kg, ${String(x?.deliveryType||x?.input?.deliveryType||"")}: ${Math.round(Number(x.priceClp)).toLocaleString("es-CL")}`,
    rate_explicit:true,
    normalization_method:"official_interactive_quote",
    source_freshness:day,
    confidence:98,
    dimensions:{heightCm:Number(x?.input?.heightCm)||null,widthCm:Number(x?.input?.widthCm)||null,lengthCm:Number(x?.input?.lengthCm)||null},
    originCode:x?.originCode??null,
    destinationCode:x?.destinationCode??null,
    eta:x?.eta??null
  }));
  return {rates,notes:[`Cotizador oficial Starken: ${rates.length}/${quotes.length} escenarios con precio válido.`],coverage_summary:`Cotización directa de ${origins.length} origen(es) × ${destinations.length} destinos, ${STARKEN_PROFILES.length} perfiles de peso y entrega domicilio/agencia.`,rawResults:results.length};
}

async function searchRates(apiKey:string,modelName:string,key:ProviderKey){
  const p=PROVIDERS[key];
  const prompt=`
Hoy es ${new Date().toISOString().slice(0,10)}. Investiga exclusivamente precios públicos oficiales de ${p.name} en Chile.
DOMINIOS PERMITIDOS: ${p.domains.join(", ")}
URLS SEMILLA: ${p.seedUrls.join(" | ")}
${p.notes}

Objetivo: extraer el máximo número de TARIFAS EXPLÍCITAS de envíos nacionales desde Santiago Centro hacia estos destinos:
${DESTINATIONS.join(", ")}
Pesos/bandas objetivo: ${WEIGHTS.join(", ")} kg, y cualquier banda oficial equivalente.
Tipos de entrega: domicilio y sucursal/punto si están publicados.

REGLAS CRÍTICAS:
- No inventes ni estimes precios.
- rate_explicit=true SOLO si el precio aparece explícitamente en una fuente oficial pública.
- source_url debe ser la URL oficial exacta que respalda el precio.
- Si la tarifa está definida por zona/región, puedes proyectarla a una ciudad SOLO si la pertenencia de esa ciudad a la zona está explícita en la fuente oficial; marca normalization_method="official_zone_to_route".
- Si el sitio requiere login, credenciales empresariales o no muestra precio, no generes tarifa.
- Para cada fila guarda una evidencia breve del dato publicado.
- Chilexpress/competidores se compararán después; aquí solo extrae evidencia.

Devuelve todas las filas válidas que puedas, idealmente para todas las rutas y pesos publicados.
`;
  const schema={type:"object",additionalProperties:false,properties:{
    rates:{type:"array",maxItems:240,items:{type:"object",additionalProperties:false,properties:{
      origin:{type:"string"},destination:{type:"string"},weight_kg:{type:["number","null"]},weight_band:{type:["string","null"]},
      service_type:{type:["string","null"]},delivery_type:{type:["string","null"]},unit_price_clp:{type:["number","null"]},
      source_url:{type:"string"},evidence:{type:"string"},rate_explicit:{type:"boolean"},normalization_method:{type:["string","null"]},
      source_freshness:{type:["string","null"]},confidence:{type:"integer",minimum:0,maximum:100}
    },required:["origin","destination","weight_kg","weight_band","service_type","delivery_type","unit_price_clp","source_url","evidence","rate_explicit","normalization_method","source_freshness","confidence"]}},
    notes:{type:"array",items:{type:"string"}},coverage_summary:{type:"string"}
  },required:["rates","notes","coverage_summary"]};

  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({
    model:modelName,input:prompt,store:false,
    tools:[{type:"web_search_preview",search_context_size:"high",user_location:{type:"approximate",country:"CL",timezone:"America/Santiago"}}],
    tool_choice:{type:"web_search_preview"},max_output_tokens:10000,
    text:{format:{type:"json_schema",name:"courier_public_rates",strict:true,schema}}
  }),signal:AbortSignal.timeout(95_000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`openai_${r.status}:${j?.error?.message||""}`);
  const t=outputText(j);if(!t)throw new Error("empty_ai_output");
  return JSON.parse(t);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});
  const supplied=req.headers.get("x-chilexpress-worker-token");
  const cfgToken=await sb.from("qsr_worker_config").select("token").eq("id",1).single();
  if(!supplied||!cfgToken.data?.token||supplied!==cfgToken.data.token)return Response.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>({}));
  const key=(body?.provider||"blue") as ProviderKey;
  if(!(key in PROVIDERS))return Response.json({error:"unknown_provider"},{status:400});
  const triggerKind=body?.trigger==="schedule"?"schedule":body?.trigger==="backfill"?"backfill":"manual";
  const org=await sb.from("organizations").select("id").eq("slug","chilexpress").single();
  if(org.error)return Response.json({error:"chilexpress_org_missing"},{status:500});
  const run=await sb.from("chilexpress_scrape_runs").insert({organization_id:org.data.id,layer:"b2c",source_key:key,trigger_kind:triggerKind,status:"running"}).select("id").single();
  if(run.error)return Response.json({error:run.error.message},{status:500});
  const runId=run.data.id as string;
  try{
    let m="direct";
    let result:any;
    if(key==="starken"){
      result=await searchStarkenDirect(supplied,triggerKind);
    }else{
      const cfg=await runtime();if(!cfg.enabled||!cfg.api_key)throw new Error("ai_runtime_unavailable");
      m=await model(cfg.api_key,cfg.model);
      result=await searchRates(cfg.api_key,m,key);
    }
    const raw=Array.isArray(result?.rates)?result.rates:[];
    const valid=raw.filter((x:any)=>x?.rate_explicit===true&&Number(x?.unit_price_clp)>0&&hostOk(key,String(x?.source_url||""))&&String(x?.destination||"").trim()&&sourceEvidenceValid(key,x));
    const day=new Date().toISOString().slice(0,10);
    const rows=[];
    for(const x of valid){
      const w=Number(x.weight_kg)>0?Number(x.weight_kg):null;
      const price=Math.round(Number(x.unit_price_clp));
      const sourceUrl=clean(x.source_url);
      const basis=[PROVIDERS[key].group,day,clean(x.origin||"Santiago Centro"),canonicalDestination(x.destination),String(w??x.weight_band??""),clean(x.delivery_type??""),String(price),sourceUrl].join("|");
      rows.push({
        organization_id:org.data.id,run_id:runId,source_record_id:`${key}:${day}:${await digest(basis)}`,
        provider_name:PROVIDERS[key].name,provider_group:PROVIDERS[key].group,source_url:sourceUrl,source_kind:"public_commercial_rate",
        service_type:clean(x.service_type||"Courier")||"Courier",delivery_type:clean(x.delivery_type||"")||null,
        origin_label:clean(x.origin||"Santiago Centro")||"Santiago Centro",destination_label:canonicalDestination(x.destination),
        weight_kg:w,weight_band:clean(x.weight_band||"")||weightBand(w),shipment_price_clp:price,
        confidence:Math.max(0,Math.min(100,Number(x.confidence)||80)),evidence:clean(x.evidence).slice(0,1500),
        observed_at:new Date().toISOString(),metadata:{normalizationMethod:x.normalization_method||"explicit_public_rate",sourceFreshness:x.source_freshness||null,collector:key==="starken"?"chilexpress-starken-smart-quoter-v1":"chilexpress-b2c-worker-v1",coverageSummary:result?.coverage_summary||null,dimensions:x.dimensions||null,originCode:x.originCode||null,destinationCode:x.destinationCode||null,eta:x.eta||null}
      });
    }
    let inserted=0;
    if(rows.length){const up=await sb.from("chilexpress_b2c_rates").upsert(rows,{onConflict:"organization_id,source_record_id"});if(up.error)throw new Error(up.error.message);inserted=rows.length}
    const status=inserted>0?"ok":"partial";
    await sb.from("chilexpress_scrape_runs").update({status,finished_at:new Date().toISOString(),metrics:{provider:PROVIDERS[key].group,model:m,candidates:raw.length,accepted:inserted,coverageSummary:result?.coverage_summary||null,notes:(result?.notes??[]).slice(0,10)},errors:inserted?[]:["No explicit official public rates were accepted"]}).eq("id",runId);
    return Response.json({ok:true,runId,provider:PROVIDERS[key].group,status,candidates:raw.length,accepted:inserted,coverageSummary:result?.coverage_summary||null});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await sb.from("chilexpress_scrape_runs").update({status:"error",finished_at:new Date().toISOString(),errors:[msg]}).eq("id",runId);
    return Response.json({ok:false,runId,error:msg},{status:500});
  }
});