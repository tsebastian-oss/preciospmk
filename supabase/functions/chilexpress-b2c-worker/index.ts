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
const STARKEN_TARIFA_SIMPLE_URL="https://www.starken.cl/tarifa-simple";
const STARKEN_PARTNER_URL="https://www.starken.cl/somos-partner";
const STARKEN_ZONE_DESTINATIONS:Record<string,string[]>={
  "Misma ciudad":["Santiago Centro"],
  "Extremo Norte":["Antofagasta","Iquique","Arica"],
  "Centro / Sur":["Copiapó","La Serena","Valparaíso","Rancagua","Talca","Chillán","Concepción","Temuco","Valdivia","Puerto Montt"],
  "Extremo Austral":["Coyhaique","Punta Arenas"]
};
const STARKEN_SIZE_WEIGHTS:Record<string,number[]>={
  XS:[0.5],
  S:[1,3],
  M:[5],
  L:[10]
};

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
function matrixWeightBand(w:number|null){if(!w||w<=0)return"Sin peso";if(w<=0.5)return"0–0,5 kg";if(w<=1.5)return"0,5–1,5 kg";if(w<=3)return"1,5–3 kg";if(w<=6)return"3–6 kg";if(w<=10)return"6–10 kg";if(w<=15)return"10–15 kg";if(w<=20)return"15–20 kg";return"20+ kg"}
function matrixProfileKey(service:string,origin:string,destination:string,w:number|null){
  const parts=[service||"Courier"];
  if(origin&&destination)parts.push(origin+" → "+destination);
  if(w&&w>0)parts.push("Ref "+String(w).replace(".",",")+" kg");
  else parts.push(matrixWeightBand(w));
  return parts.join(" | ");
}

async function searchStarkenTarifaSimple(workerToken:string){
  const browserConfig=await sb.rpc("get_chilexpress_starken_browser_secret_service");
  const connectorEndpoint=typeof browserConfig.data==="string"?browserConfig.data.trim():"";
  if(!connectorEndpoint){
    return {rates:[],notes:["Browser API residencial no configurada."],coverage_summary:"Tarifa Simple Starken sin ejecutar.",rawResults:0,backend:"connector_not_configured",connectorConfigured:false};
  }
  const response=await fetch("https://preciospmk.vercel.app/api/internal/starken-tarifa-simple",{
    method:"POST",
    headers:{"content-type":"application/json","x-chilexpress-worker-token":workerToken},
    body:JSON.stringify({connectorEndpoint}),
    signal:AbortSignal.timeout(165_000)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`starken_tarifa_simple_${response.status}:${payload?.error||"unknown"}`);

  const baseRates=Array.isArray(payload?.baseRates)?payload.baseRates:[];
  const verifiedTiers=(Array.isArray(payload?.partnerTiers)?payload.partnerTiers:[])
    .filter((tier:any)=>tier?.verifiedInPage===true&&Number(tier?.discountPct)>0&&Number(tier?.discountPct)<100);
  const tiers=[
    {name:"Tarifa Simple",providerGroup:"Starken Tarifa Simple",discountPct:0,minMonthlyShipments:0,verifiedInPage:true},
    ...verifiedTiers.map((tier:any)=>({
      name:String(tier.name||"Partner"),
      providerGroup:`Starken Partner ${String(tier.name||"")}`,
      discountPct:Number(tier.discountPct),
      minMonthlyShipments:Number(tier.minMonthlyShipments)||0,
      verifiedInPage:true
    }))
  ];
  const day=new Date().toISOString().slice(0,10);
  const rates:any[]=[];
  for(const base of baseRates){
    const zone=String(base?.zone||"");
    const size=String(base?.size||"").toUpperCase();
    const delivery=String(base?.deliveryType||"").toUpperCase();
    const basePrice=Math.round(Number(base?.priceClp)||0);
    const destinations=STARKEN_ZONE_DESTINATIONS[zone]||[];
    const weights=STARKEN_SIZE_WEIGHTS[size]||[];
    if(!basePrice||!destinations.length||!weights.length||!["DOMICILIO","AGENCIA"].includes(delivery))continue;
    for(const destination of destinations){
      for(const weight of weights){
        for(const tier of tiers){
          const price=Math.round(basePrice*(1-tier.discountPct/100));
          const service=delivery==="DOMICILIO"?"Domicilio estándar / express":"Sucursal / punto";
          const discountNote=tier.discountPct>0
            ? ` Somos Partner ${tier.name}: ${tier.discountPct}% publicado para +${tier.minMonthlyShipments} envíos/mes; precio derivado $ ${price.toLocaleString("es-CL")}.`
            : "";
          rates.push({
            provider_name:"Starken",
            provider_group:tier.providerGroup,
            origin:"Santiago Centro",
            destination,
            weight_kg:weight,
            weight_band:weightBand(weight),
            service_type:service,
            delivery_type:delivery,
            unit_price_clp:price,
            source_url:STARKEN_TARIFA_SIMPLE_URL,
            evidence:`Tarifa Simple oficial Starken: ${zone}, tamaño ${size}, ${delivery}, base $ ${basePrice.toLocaleString("es-CL")}.${discountNote}`,
            rate_explicit:true,
            normalization_method:tier.discountPct>0?"official_tarifa_simple_zone+published_somos_partner_discount":"official_tarifa_simple_zone_to_route",
            source_freshness:day,
            confidence:tier.discountPct>0?97:99,
            metadata:{zone,size,basePriceClp:basePrice,pricingTier:tier.name,discountPct:tier.discountPct,minMonthlyShipments:tier.minMonthlyShipments,partnerSourceUrl:STARKEN_PARTNER_URL,partnerVerified:tier.verifiedInPage}
          });
        }
      }
    }
  }
  return {
    rates,
    notes:[
      `Tarifa Simple Starken: ${baseRates.length} celdas base capturadas; ${rates.length} referencias ruta/peso/segmento generadas.`,
      `Somos Partner verificado en página: ${verifiedTiers.length}/3 categorías.`
    ],
    coverage_summary:`Tarifa Simple oficial por 4 zonas y 4 tamaños, retiro sucursal/domicilio; escalera Somos Partner solo cuando el descuento fue verificado en la página oficial.`,
    rawResults:baseRates.length,
    backend:"starken_tarifa_simple_browser_chile",
    connectorConfigured:true
  };
}

async function mirrorStarkenToMatrix(rows:any[]){
  const comparable=rows.filter((row:any)=>String(row?.provider_group||"").startsWith("Starken")).map((row:any)=>{
    const w=Number(row.weight_kg)>0?Number(row.weight_kg):null;
    const service=String(row.service_type||"Courier");
    const origin=String(row.origin_label||"Santiago Centro");
    const destination=String(row.destination_label||"");
    const price=Number(row.shipment_price_clp)||0;
    return {
      source_record_id:"cxmirror:"+String(row.source_record_id),
      source:"starken_tarifa_simple",
      source_kind:"published_commercial_rate",
      source_url:String(row.source_url||STARKEN_TARIFA_SIMPLE_URL),
      category:"courier",
      provider_name:String(row.provider_name||"Starken"),
      provider_group:String(row.provider_group||"Starken"),
      buyer_name:null,
      service_type:service,
      origin_label:origin,
      destination_label:destination,
      weight_kg:w,
      distance_km:null,
      shipment_price_clp:price,
      price_per_kg_clp:w&&w>0?price/w:null,
      price_per_km_clp:null,
      price_per_kg_km_clp:null,
      weight_band:matrixWeightBand(w),
      distance_band:"Sin distancia",
      profile_key:matrixProfileKey(service,origin,destination,w),
      comparability_level:w&&w>0?"weight":"none",
      confidence:Number(row.confidence)||95,
      normalization_method:String(row?.metadata?.normalizationMethod||"official_tarifa_simple_zone_to_route"),
      process_date:String(row.observed_at||new Date().toISOString()).slice(0,10),
      metadata:{...(row.metadata||{}),mirroredFrom:"chilexpress_b2c_rates",sourceLayer:"published commercial rate"},
      updated_at:new Date().toISOString()
    };
  }).filter((row:any)=>row.shipment_price_clp>0&&row.destination_label&&row.comparability_level!=="none");
  if(!comparable.length)return 0;
  const up=await sb.from("b2b_rate_comparables").upsert(comparable,{onConflict:"source_record_id"});
  if(up.error)throw new Error("starken_matrix_mirror:"+up.error.message);
  return comparable.length;
}

async function searchStarkenDirect(workerToken:string,triggerKind:string,maxQuotes=0){
  const browserConfig=await sb.rpc("get_chilexpress_starken_browser_secret_service");
  const connectorEndpoint=typeof browserConfig.data==="string"?browserConfig.data.trim():"";
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
  const preferred=quotes.filter((q:any)=>q.destination==="Antofagasta"&&q.weightKg===0.5&&q.deliveryType==="DOMICILIO");
  const remaining=quotes.filter((q:any)=>!(q.destination==="Antofagasta"&&q.weightKg===0.5&&q.deliveryType==="DOMICILIO"));
  const ordered=[...preferred,...remaining];
  const queue=maxQuotes>0?ordered.slice(0,Math.max(1,Math.min(20,maxQuotes))):quotes;
  const batchSize=maxQuotes>0?Math.min(3,queue.length):30;
  const results:any[]=[];
  const diagnostics:string[]=[];
  let backend="unknown";
  for(let i=0;i<queue.length;i+=batchSize){
    const batch=queue.slice(i,i+batchSize);
    const r=await fetch("https://preciospmk.vercel.app/api/internal/starken-smart-quote",{
      method:"POST",
      headers:{"content-type":"application/json","x-chilexpress-worker-token":workerToken},
      body:JSON.stringify({quotes:batch,connectorEndpoint}),
      signal:AbortSignal.timeout(150_000)
    });
    const j=await r.json().catch(()=>({}));
    if(r.status===503&&j?.error==="starken_connector_not_configured"){
      return {
        rates:[],
        notes:["Conector Starken listo; falta activar una credencial oficial de Starken o Browser API residencial."],
        coverage_summary:"Conector técnico desplegado. Recolección pausada hasta configurar STARKEN_INTEGRATION_TOKEN o BRIGHTDATA_BROWSER_WS.",
        rawResults:0,
        backend:"connector_not_configured",
        connectorConfigured:false
      };
    }
    if(!r.ok)throw new Error(`starken_quote_proxy_${r.status}:${j?.error||"unknown"}`);
    backend=String(j?.backend||backend);
    const batchResults=Array.isArray(j?.results)?j.results:[];
    diagnostics.push(...batchResults.filter((x:any)=>!x?.ok).map((x:any)=>String(x?.error||"quote_failed")).slice(0,5));
    results.push(...batchResults);
  }
  const day=new Date().toISOString().slice(0,10);
  const sourceUrl=backend==="starken_official_api"?"https://developers.starken.cl/cotizaTusEnvios":"https://www.starken.cl/cotizador";
  const rates=results.filter((x:any)=>x?.ok&&Number(x?.priceClp)>0).map((x:any)=>({
    origin:canonicalDestination(String(x?.origin||x?.input?.origin||"")),
    destination:canonicalDestination(String(x?.destination||x?.input?.destination||"")),
    weight_kg:Number(x?.input?.weightKg)>0?Number(x.input.weightKg):null,
    weight_band:String(x?.input?.profileLabel||weightBand(Number(x?.input?.weightKg)||null)),
    service_type:String(x?.serviceType||"NORMAL"),
    delivery_type:String(x?.deliveryType||x?.input?.deliveryType||"DOMICILIO"),
    unit_price_clp:Number(x.priceClp),
    source_url:sourceUrl,
    evidence:`Cotización oficial Starken ${String(x?.origin||"SANTIAGO")} → ${String(x?.destination||x?.input?.destination||"")}, ${Number(x?.input?.weightKg)||0} kg, ${String(x?.deliveryType||x?.input?.deliveryType||"")}: ${Math.round(Number(x.priceClp)).toLocaleString("es-CL")}`,
    rate_explicit:true,
    normalization_method:backend==="starken_official_api"?"official_plugin_api_quote":"official_interactive_quote_residential_browser",
    source_freshness:day,
    confidence:backend==="starken_official_api"?99:98,
    dimensions:{heightCm:Number(x?.input?.heightCm)||null,widthCm:Number(x?.input?.widthCm)||null,lengthCm:Number(x?.input?.lengthCm)||null},
    originCode:x?.originCode??null,
    destinationCode:x?.destinationCode??null,
    eta:x?.eta??null
  }));
  return {rates,notes:[`Cotizador oficial Starken (${backend}): ${rates.length}/${queue.length} escenarios con precio válido.`,...diagnostics.map((d:string)=>`Diagnóstico: ${d}`)],coverage_summary:`Cotización directa de ${origins.length} origen(es) × ${destinations.length} destinos, ${STARKEN_PROFILES.length} perfiles de peso y entrega domicilio/agencia. Ejecutados ${queue.length} escenarios en esta corrida.`,rawResults:results.length,backend,connectorConfigured:true};
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
      result=await searchStarkenTarifaSimple(supplied);
      m=String(result?.backend||"direct");
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
      const effectiveProviderName=clean(x.provider_name||PROVIDERS[key].name)||PROVIDERS[key].name;
      const effectiveProviderGroup=clean(x.provider_group||PROVIDERS[key].group)||PROVIDERS[key].group;
      const basis=[effectiveProviderGroup,day,clean(x.origin||"Santiago Centro"),canonicalDestination(x.destination),String(w??x.weight_band??""),clean(x.delivery_type??""),String(price),sourceUrl].join("|");
      rows.push({
        organization_id:org.data.id,run_id:runId,source_record_id:`${key}:${day}:${await digest(basis)}`,
        provider_name:effectiveProviderName,provider_group:effectiveProviderGroup,source_url:sourceUrl,source_kind:"public_commercial_rate",
        service_type:clean(x.service_type||"Courier")||"Courier",delivery_type:clean(x.delivery_type||"")||null,
        origin_label:clean(x.origin||"Santiago Centro")||"Santiago Centro",destination_label:canonicalDestination(x.destination),
        weight_kg:w,weight_band:clean(x.weight_band||"")||weightBand(w),shipment_price_clp:price,
        confidence:Math.max(0,Math.min(100,Number(x.confidence)||80)),evidence:clean(x.evidence).slice(0,1500),
        observed_at:new Date().toISOString(),metadata:{normalizationMethod:x.normalization_method||"explicit_public_rate",sourceFreshness:x.source_freshness||null,collector:key==="starken"?"chilexpress-starken-tarifa-simple-v1":"chilexpress-b2c-worker-v1",backend:key==="starken"?result?.backend||null:null,coverageSummary:result?.coverage_summary||null,dimensions:x.dimensions||null,originCode:x.originCode||null,destinationCode:x.destinationCode||null,eta:x.eta||null,...(x.metadata||{})}
      });
    }
    let inserted=0;
    let matrixMirrored=0;
    if(rows.length){
      const up=await sb.from("chilexpress_b2c_rates").upsert(rows,{onConflict:"organization_id,source_record_id"});
      if(up.error)throw new Error(up.error.message);
      inserted=rows.length;
      if(key==="starken")matrixMirrored=await mirrorStarkenToMatrix(rows);
    }
    const status=inserted>0?"ok":"partial";
    const noDataError=key==="starken"&&result?.connectorConfigured===false
      ?"Starken connector deployed but external credential is not configured"
      :"No explicit official public rates were accepted";
    await sb.from("chilexpress_scrape_runs").update({status,finished_at:new Date().toISOString(),metrics:{provider:PROVIDERS[key].group,model:m,backend:key==="starken"?result?.backend||null:null,connectorConfigured:key==="starken"?result?.connectorConfigured??null:null,candidates:raw.length,accepted:inserted,matrixMirrored,coverageSummary:result?.coverage_summary||null,notes:(result?.notes??[]).slice(0,10)},errors:inserted?[]:[noDataError]}).eq("id",runId);
    return Response.json({ok:true,runId,provider:PROVIDERS[key].group,status,candidates:raw.length,accepted:inserted,coverageSummary:result?.coverage_summary||null});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await sb.from("chilexpress_scrape_runs").update({status:"error",finished_at:new Date().toISOString(),errors:[msg]}).eq("id",runId);
    return Response.json({ok:false,runId,error:msg},{status:500});
  }
});