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

const BLUE_PYME_URL="https://www.blue.cl/docs/enviar/tarifario-pyme.pdf";
const BLUE_ECOMMERCE_URL="https://cdn.blue.cl/clientes/1bluex/tarifa-segmento-shopify-api.pdf";
const BLUE_CONSUMER_PAGE="https://www.blue.cl/nosotros/registro-eventos";
const BLUE_ECOMMERCE_PAGE="https://www.blue.cl/empresas/soluciones-ecommerce";
const CORREOS_PUBLIC_RESOLUTION_URL="https://www.correos.cl/documents/51021813/51024715/resolucion-exentaN%C2%B0027.pdf/5c41b3c4-691b-e6c2-3317-23fbbfb9c45b?t=1745868074366";
const CORREOS_ALIADOS_URL="https://www.correos.cl/home-aliados";
const CORREOS_ALIADOS_PLAN_URL="https://www.correos.cl/aliados-planes";
const BLUE_CITY_META:Record<string,{region:string;routeClass:"same"|"center"|"extreme"}>={
  "Santiago Centro":{region:"Metropolitana de Santiago",routeClass:"same"},
  "Rancagua":{region:"O’Higgins",routeClass:"center"},
  "Valparaíso":{region:"Valparaíso",routeClass:"center"},
  "Talca":{region:"Maule",routeClass:"center"},
  "Chillán":{region:"Ñuble",routeClass:"center"},
  "Concepción":{region:"Bío-Bío",routeClass:"center"},
  "La Serena":{region:"Coquimbo",routeClass:"center"},
  "Copiapó":{region:"Atacama",routeClass:"center"},
  "Temuco":{region:"Araucanía",routeClass:"center"},
  "Valdivia":{region:"Los Ríos",routeClass:"center"},
  "Puerto Montt":{region:"Los Lagos",routeClass:"center"},
  "Antofagasta":{region:"Antofagasta",routeClass:"extreme"},
  "Iquique":{region:"Tarapacá",routeClass:"extreme"},
  "Arica":{region:"Arica y Parinacota",routeClass:"extreme"}
};
const BLUE_PYME_SIZES=[
  {size:"XS",weightKg:0.5,band:"0–0,5 kg",home:{same:3100,center:4300,extreme:5200},point:{same:2600,center:3800,extreme:4700}},
  {size:"S",weightKg:3,band:"0,5–3 kg",home:{same:4200,center:5600,extreme:9500},point:{same:3700,center:5100,extreme:9000}},
  {size:"M",weightKg:6,band:"3–6 kg",home:{same:4800,center:7300,extreme:14500},point:{same:4300,center:6800,extreme:14000}},
  {size:"L",weightKg:20,band:"6–20 kg",home:{same:5400,center:9200,extreme:17000},point:{same:4900,center:8700,extreme:16500}}
] as const;
const BLUE_ECOMMERCE_WEIGHTS=[
  {size:"XS",weightKg:0.5,band:"0–0,5 kg"},
  {size:"S",weightKg:3,band:"0,5–3 kg"},
  {size:"M",weightKg:6,band:"3–6 kg"},
  {size:"L",weightKg:16,band:"6–16 kg"},
  {size:"XL",weightKg:25,band:"16–25 kg"}
] as const;
const BLUE_ECOMMERCE_RATES:Record<string,{home:number[];point:number[]}>={
  "Arica y Parinacota":{home:[7150,8300,12400,17000,25000],point:[6350,7500,11600,16200,24200]},
  "Tarapacá":{home:[6550,7400,10700,15500,23000],point:[5750,6600,9900,14700,22200]},
  "Antofagasta":{home:[6300,7000,9900,14000,21000],point:[5500,6200,9100,13200,20200]},
  "Atacama":{home:[4850,5900,7700,9900,13800],point:[4050,5100,6900,9100,13000]},
  "Coquimbo":{home:[4600,5300,7000,9600,12800],point:[3800,4500,6200,8800,12000]},
  "Valparaíso":{home:[3900,4500,6000,7700,9700],point:[3100,3700,5200,6900,8900]},
  "Metropolitana de Santiago":{home:[3100,3650,4700,5700,7600],point:[2300,2850,3900,4900,6800]},
  "O’Higgins":{home:[4000,4800,6400,8300,11300],point:[3200,4000,5600,7500,10500]},
  "Maule":{home:[4200,5200,6700,8900,12100],point:[3400,4400,5900,8100,11300]},
  "Ñuble":{home:[4600,5400,7200,9200,12600],point:[3800,4600,6400,8400,11800]},
  "Bío-Bío":{home:[4700,5700,7300,9500,12800],point:[3900,4900,6500,8700,12000]},
  "Araucanía":{home:[4950,5900,7700,9900,13800],point:[4150,5100,6900,9100,13000]},
  "Los Ríos":{home:[5300,6100,8300,10000,14200],point:[4500,5300,7500,9200,13400]},
  "Los Lagos":{home:[5300,6100,8300,10000,14200],point:[4500,5300,7500,9200,13400]}
};
const CORREOS_EXPRESS_AM=[
  {zone:"INTRA",weightKg:0.5,weightBand:"0–0,5 kg",priceClp:4500},
  {zone:"INTRA",weightKg:3,weightBand:"1,51–3 kg",priceClp:6000},
  {zone:"INTRA",weightKg:6,weightBand:"3,1–6 kg",priceClp:7200},
  {zone:"CERCA",weightKg:0.5,weightBand:"0–0,5 kg",priceClp:6000},
  {zone:"CERCA",weightKg:3,weightBand:"1,51–3 kg",priceClp:7500},
  {zone:"CERCA",weightKg:6,weightBand:"3,1–6 kg",priceClp:11000},
  {zone:"LEJOS",weightKg:0.5,weightBand:"0–0,5 kg",priceClp:18800},
  {zone:"LEJOS",weightKg:3,weightBand:"1,51–3 kg",priceClp:28500},
  {zone:"LEJOS",weightKg:6,weightBand:"3,1–6 kg",priceClp:42000}
] as const;
const CORREOS_ALIADOS_TIERS=[
  {name:"Bronce",discountPct:10,volume:"Nuevo emprendedor"},
  {name:"Crecimiento",discountPct:15,volume:"20–49 envíos/mes"},
  {name:"Consolidado",discountPct:20,volume:"50–99 envíos/mes"},
  {name:"Gran volumen",discountPct:25,volume:"100+ envíos/mes"}
] as const;

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
  if(key==="correos")return /correos\.cl\/(?:documents\/|home-aliados|aliados-planes)/i.test(url)&&/2026/.test(fresh);
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

async function searchCorreosPublished(){
  const day=new Date().toISOString().slice(0,10);
  const rates:any[]=[];
  for(const base of CORREOS_EXPRESS_AM){
    rates.push({
      provider_name:"Empresa de Correos de Chile",
      provider_group:"CorreosChile B2C / Público",
      origin:"Zona tarifaria CorreosChile",
      destination:`Zona ${base.zone}`,
      weight_kg:base.weightKg,
      weight_band:base.weightBand,
      service_type:"Paquete Domicilio Express AM",
      delivery_type:"DOMICILIO",
      unit_price_clp:base.priceClp,
      source_url:CORREOS_PUBLIC_RESOLUTION_URL,
      evidence:`Resolución Exenta N°27 CorreosChile: zona ${base.zone}, ${base.weightBand}, tarifa $ ${base.priceClp.toLocaleString("es-CL")} exenta de IVA.`,
      rate_explicit:true,
      normalization_method:"official_resolution_tariff_zone_exact",
      source_freshness:day,
      confidence:100,
      metadata:{segment:"B2C / Público",tariffZone:base.zone,weightRateBand:base.weightBand,ivaIncluded:false,taxTreatment:"Exenta de IVA",resolutionDate:"2025-04-25",comparabilityNote:"Zona tarifaria oficial; no se transforma a ciudad/ruta sin evidencia oficial."}
    });
    for(const tier of CORREOS_ALIADOS_TIERS){
      const price=Math.round(base.priceClp*(1-tier.discountPct/100));
      rates.push({
        provider_name:"Empresa de Correos de Chile",
        provider_group:`CorreosChile Aliados ${tier.name} ${tier.discountPct}%`,
        origin:"Zona tarifaria CorreosChile",
        destination:`Zona ${base.zone}`,
        weight_kg:base.weightKg,
        weight_band:base.weightBand,
        service_type:"Paquete Domicilio Express AM",
        delivery_type:"DOMICILIO",
        unit_price_clp:price,
        source_url:CORREOS_ALIADOS_URL,
        evidence:`CorreosChile Aliados ${tier.name}: ${tier.discountPct}% sobre tarifa oficial zona ${base.zone}, ${base.weightBand}; precio derivado $ ${price.toLocaleString("es-CL")}.`,
        rate_explicit:true,
        normalization_method:"official_resolution_base+published_aliados_discount",
        source_freshness:day,
        confidence:95,
        metadata:{segment:"Pyme / Emprendedores",tariffZone:base.zone,weightRateBand:base.weightBand,basePriceClp:base.priceClp,discountPct:tier.discountPct,monthlyShipments:tier.volume,aliadosPlanUrl:CORREOS_ALIADOS_PLAN_URL,ivaIncluded:false,taxTreatment:"Exenta de IVA",comparabilityNote:"Precio derivado aplicando descuento Aliados publicado sobre tarifa base oficial."}
      });
    }
  }
  return {
    rates,
    notes:[
      "CorreosChile B2C: Resolución Exenta N°27, Paquete Domicilio Express AM por zonas INTRA/CERCA/LEJOS.",
      "CorreosChile Aliados: 10% nuevo emprendedor, 15% 20–49 envíos, 20% 50–99, 25% 100+."
    ],
    coverage_summary:`CorreosChile: ${rates.length} referencias B2C y Aliados por zona/peso.`,
    backend:"correos_official_resolution_and_aliados",
    connectorConfigured:true
  };
}

async function searchBluePublished(){
  const day=new Date().toISOString().slice(0,10);
  const rates:any[]=[];

  for(const destination of DESTINATIONS){
    const meta=BLUE_CITY_META[destination];
    if(!meta)continue;
    for(const size of BLUE_PYME_SIZES){
      for(const delivery of ["home","point"] as const){
        const price=size[delivery][meta.routeClass];
        const deliveryType=delivery==="home"?"DOMICILIO":"PUNTO BLUE";
        rates.push({
          provider_name:"Blue Express",
          provider_group:"Blue Express B2C / Público",
          origin:"Santiago Centro",
          destination,
          weight_kg:size.weightKg,
          weight_band:size.band,
          service_type:delivery==="home"?"Domicilio estándar / express":"Punto Blue Express / Copec",
          delivery_type:deliveryType,
          unit_price_clp:price,
          source_url:BLUE_PYME_URL,
          evidence:`Tarifario Pyme oficial Blue Express: ${destination}, talla ${size.size}, ${deliveryType}: $ ${price.toLocaleString("es-CL")} IVA incluido.`,
          rate_explicit:true,
          normalization_method:"official_pyme_zone_matrix_band_upper_bound",
          source_freshness:day,
          confidence:97,
          metadata:{segment:"B2C / Público",monthlyShipments:"Sin mínimo",routeClass:meta.routeClass,region:meta.region,size:size.size,consumerPage:BLUE_CONSUMER_PAGE,ivaIncluded:true}
        });
      }
    }

    const ecommerce=BLUE_ECOMMERCE_RATES[meta.region];
    if(!ecommerce)continue;
    for(let i=0;i<BLUE_ECOMMERCE_WEIGHTS.length;i++){
      const weight=BLUE_ECOMMERCE_WEIGHTS[i];
      for(const delivery of ["home","point"] as const){
        const price=ecommerce[delivery][i];
        const deliveryType=delivery==="home"?"DOMICILIO":"PUNTO BLUE";
        rates.push({
          provider_name:"Blue Express",
          provider_group:"Blue Express Ecommerce 1–500",
          origin:"Santiago Centro",
          destination,
          weight_kg:weight.weightKg,
          weight_band:weight.band,
          service_type:delivery==="home"?"Domicilio estándar / express":"Punto Blue Express / Copec",
          delivery_type:deliveryType,
          unit_price_clp:price,
          source_url:BLUE_ECOMMERCE_URL,
          evidence:`Tarifa Ecommerce Masivos oficial Blue Express: ${meta.region}, talla ${weight.size}, ${deliveryType}: $ ${price.toLocaleString("es-CL")} IVA incluido.`,
          rate_explicit:true,
          normalization_method:"official_ecommerce_region_matrix_band_upper_bound",
          source_freshness:day,
          confidence:98,
          metadata:{segment:"Ecommerce 1–500 envíos/mes",monthlyShipments:"1–500",region:meta.region,size:weight.size,ecommercePage:BLUE_ECOMMERCE_PAGE,ivaIncluded:true}
        });
      }
    }
  }

  return {
    rates,
    notes:[
      "Blue Express B2C / Público: tarifario público por talla, zona y entrega domicilio/Punto Blue.",
      "Blue Express Ecommerce 1–500: matriz oficial Ecommerce Masivos por región, talla y entrega.",
      "Segmento >500 envíos/mes excluido porque Blue Express publica precio especial por volumen, no una tarifa numérica abierta."
    ],
    coverage_summary:`Blue Express: ${rates.length} referencias oficiales para B2C/Pyme y Ecommerce 1–500.`,
    backend:"blue_official_published_matrices",
    connectorConfigured:true
  };
}

async function searchStarkenTarifaSimple(workerToken:string){
  const browserConfig=await sb.rpc("get_chilexpress_starken_browser_secret_service");
  const connectorEndpoint=typeof browserConfig.data==="string"?browserConfig.data.trim():"";
  if(!connectorEndpoint){
    return {rates:[],notes:["Browser API residencial no configurada."],coverage_summary:"Tarifa Simple Starken sin ejecutar.",rawResults:0,backend:"connector_not_configured",connectorConfigured:false};
  }
  let payload:any={};
  let lastStatus=0;
  let lastError="unknown";
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch("https://preciospmk.vercel.app/api/internal/starken-tarifa-simple",{
        method:"POST",
        headers:{"content-type":"application/json","x-chilexpress-worker-token":workerToken},
        body:JSON.stringify({connectorEndpoint,attempt}),
        signal:AbortSignal.timeout(70_000)
      });
      lastStatus=response.status;
      payload=await response.json().catch(()=>({}));
      lastError=String(payload?.error||"unknown");
      const base=Array.isArray(payload?.baseRates)?payload.baseRates:[];
      if(response.ok&&base.length>=16)break;
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1500*attempt));
    }catch(error){
      lastError=error instanceof Error?error.message:String(error);
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1500*attempt));
    }
  }
  const baseRates=Array.isArray(payload?.baseRates)?payload.baseRates:[];
  if(baseRates.length<16)throw new Error(`starken_tarifa_simple_${lastStatus||500}:${lastError}:rates=${baseRates.length}`);
  const verifiedTiers=(Array.isArray(payload?.partnerTiers)?payload.partnerTiers:[])
    .filter((tier:any)=>{
      const live=tier?.verifiedInPage===true;
      const snapshot=tier?.verifiedSnapshot===true&&String(tier?.verifiedAt||"")==="2026-09-01"&&Date.now()<=Date.parse("2026-10-01T23:59:59Z");
      return (live||snapshot)&&Number(tier?.discountPct)>0&&Number(tier?.discountPct)<100;
    });
  const tiers=[
    {name:"Tarifa Simple",providerGroup:"Starken Tarifa Simple",discountPct:0,minMonthlyShipments:0,verifiedInPage:true},
    ...verifiedTiers.map((tier:any)=>({
      name:String(tier.name||"Partner"),
      providerGroup:`Starken Partner ${String(tier.name||"")}`,
      discountPct:Number(tier.discountPct),
      minMonthlyShipments:Number(tier.minMonthlyShipments)||0,
      verifiedInPage:tier?.verifiedInPage===true,
      verifiedSnapshot:tier?.verifiedSnapshot===true,
      verifiedAt:String(tier?.verifiedAt||"")
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
            metadata:{zone,size,basePriceClp:basePrice,pricingTier:tier.name,discountPct:tier.discountPct,minMonthlyShipments:tier.minMonthlyShipments,partnerSourceUrl:STARKEN_PARTNER_URL,partnerVerifiedLive:tier.verifiedInPage===true,partnerVerifiedSnapshot:tier.verifiedSnapshot===true,partnerVerifiedAt:tier.verifiedAt||null}
          });
        }
      }
    }
  }
  return {
    rates,
    notes:[
      `Tarifa Simple Starken: ${baseRates.length} celdas base capturadas; ${rates.length} referencias ruta/peso/segmento generadas.`,
      `Somos Partner habilitado: ${verifiedTiers.length}/3 categorías; validación live o snapshot oficial vigente.`
    ],
    coverage_summary:`Tarifa Simple oficial por 4 zonas y 4 tamaños, retiro sucursal/domicilio; escalera Somos Partner solo cuando el descuento fue verificado en la página oficial.`,
    rawResults:baseRates.length,
    backend:"starken_tarifa_simple_browser_chile",
    connectorConfigured:true
  };
}

async function mirrorCorreosToMatrix(rows:any[]){
  const comparable=rows.filter((row:any)=>String(row?.provider_group||"").startsWith("CorreosChile")).map((row:any)=>{
    const w=Number(row.weight_kg)>0?Number(row.weight_kg):null;
    const service=String(row.service_type||"Courier");
    const origin=String(row.origin_label||"Zona tarifaria CorreosChile");
    const destination=String(row.destination_label||"");
    const price=Number(row.shipment_price_clp)||0;
    const providerGroup=String(row.provider_group||"CorreosChile");
    const source=providerGroup==="CorreosChile B2C / Público"?"correos_persona_express_am":"correos_aliados";
    const sourceUrl=providerGroup==="CorreosChile B2C / Público"?CORREOS_PUBLIC_RESOLUTION_URL:CORREOS_ALIADOS_URL;
    return {
      source_record_id:"cxmirror:"+String(row.source_record_id),
      source,
      source_kind:"published_commercial_rate",
      source_url:sourceUrl,
      category:"courier",
      provider_name:String(row.provider_name||"Empresa de Correos de Chile"),
      provider_group:providerGroup,
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
      weight_band:String(row.weight_band||matrixWeightBand(w)),
      distance_band:"Sin distancia",
      profile_key:matrixProfileKey(service,origin,destination,w),
      comparability_level:w&&w>0?"weight":"none",
      confidence:Number(row.confidence)||95,
      normalization_method:String(row?.metadata?.normalizationMethod||"official_resolution_tariff_zone_exact"),
      process_date:String(row.observed_at||new Date().toISOString()).slice(0,10),
      metadata:{...(row.metadata||{}),mirroredFrom:"chilexpress_b2c_rates",sourceLayer:"published commercial rate"},
      updated_at:new Date().toISOString()
    };
  }).filter((row:any)=>row.shipment_price_clp>0&&row.destination_label&&row.comparability_level!=="none");
  if(!comparable.length)return 0;
  const up=await sb.from("b2b_rate_comparables").upsert(comparable,{onConflict:"source_record_id"});
  if(up.error)throw new Error("correos_matrix_mirror:"+up.error.message);
  return comparable.length;
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

async function searchChilexpressDirect(workerToken:string, requestedDestinations?:string[]){
  const browserConfig=await sb.rpc("get_chilexpress_starken_browser_secret_service");
  const connectorEndpoint=typeof browserConfig.data==="string"?browserConfig.data.trim():"";
  const day=new Date().toISOString().slice(0,10);
  const targetDestinations=(Array.isArray(requestedDestinations)&&requestedDestinations.length
    ? requestedDestinations.map(canonicalDestination).filter((destination:string)=>DESTINATIONS.includes(destination))
    : DESTINATIONS);
  const profiles=targetDestinations.map(destination=>({
    destination,
    quote:{
      origin:"Santiago Centro",
      destination,
      weightKg:0.5,
      heightCm:10,
      widthCm:10,
      lengthCm:20,
      declaredValue:20000
    }
  }));
  const rates:any[]=[];
  const diagnostics:string[]=[];
  for(let i=0;i<profiles.length;i+=2){
    const batch=profiles.slice(i,i+2);
    const settled=await Promise.all(batch.map(async item=>{
      let lastError="quote_failed";
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await fetch("https://preciospmk.vercel.app/api/internal/chilexpress-smart-quote",{
            method:"POST",
            headers:{"content-type":"application/json","x-chilexpress-worker-token":workerToken},
            body:JSON.stringify({quote:item.quote,connectorEndpoint}),
            signal:AbortSignal.timeout(60_000)
          });
          const payload=await response.json().catch(()=>({}));
          if(response.ok&&Array.isArray(payload?.alternatives)&&payload.alternatives.length){
            return {destination:item.destination,ok:true,payload};
          }
          lastError=String(payload?.error||("http_"+response.status));
        }catch(error){
          lastError=error instanceof Error?error.message:String(error);
        }
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1200));
      }
      return {destination:item.destination,ok:false,error:lastError};
    }));
    for(const item of settled){
      if(!item.ok){
        diagnostics.push(`${item.destination}: ${item.error}`);
        continue;
      }
      const alternatives=Array.isArray(item.payload?.alternatives)?item.payload.alternatives:[];
      for(const alt of alternatives){
        const service=clean(alt?.service||"");
        const price=Math.round(Number(alt?.priceClp)||0);
        if(!service||price<=0)continue;
        rates.push({
          provider_name:"Chilexpress",
          provider_group:"Chilexpress",
          origin:"Santiago Centro",
          destination:item.destination,
          weight_kg:0.5,
          weight_band:"0–0,5 kg",
          service_type:service,
          delivery_type:"DOMICILIO",
          unit_price_clp:price,
          source_url:"https://emprendedores.chilexpress.cl/cotizar",
          evidence:`Cotizador oficial Chilexpress: Santiago Centro → ${item.destination}, 0,5 kg, servicio ${service}: $ ${price.toLocaleString("es-CL")}.`,
          rate_explicit:true,
          normalization_method:"official_interactive_quote_residential_browser",
          source_freshness:day,
          confidence:98,
          metadata:{
            segment:"B2C / Público",
            serviceLevel:service,
            etaText:clean(alt?.etaText||"")||null,
            dimensions:{heightCm:10,widthCm:10,lengthCm:20},
            declaredValueClp:20000,
            backend:String(item.payload?.backend||"brightdata_browser_ui_chilexpress")
          }
        });
      }
    }
  }
  return {
    rates,
    notes:[
      `Chilexpress: ${rates.length} tarifas capturadas desde el cotizador por servicio Básico/Estándar/Prioritario.`,
      ...diagnostics.slice(0,8).map(d=>`Diagnóstico: ${d}`)
    ],
    coverage_summary:`Chilexpress: ${new Set(rates.map((r:any)=>r.destination)).size}/${DESTINATIONS.length} destinos con alternativas de servicio capturadas.`,
    backend:"chilexpress_brightdata_multiservice",
    connectorConfigured:true
  };
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
    }else if(key==="blue"){
      result=await searchBluePublished();
      m=String(result?.backend||"direct");
    }else if(key==="correos"){
      result=await searchCorreosPublished();
      m=String(result?.backend||"direct");
    }else if(key==="chilexpress"){
      const requestedDestinations=Array.isArray(body?.destinations)?body.destinations.map((value:any)=>String(value)).slice(0,6):undefined;
      result=await searchChilexpressDirect(supplied,requestedDestinations);
      m=String(result?.backend||"chilexpress_brightdata_multiservice");
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
      const basis=[effectiveProviderGroup,day,clean(x.origin||"Santiago Centro"),canonicalDestination(x.destination),String(w??x.weight_band??""),clean(x.service_type??""),clean(x.delivery_type??""),String(price),sourceUrl].join("|");
      rows.push({
        organization_id:org.data.id,run_id:runId,source_record_id:`${key}:${day}:${await digest(basis)}`,
        provider_name:effectiveProviderName,provider_group:effectiveProviderGroup,source_url:sourceUrl,source_kind:"public_commercial_rate",
        service_type:clean(x.service_type||"Courier")||"Courier",delivery_type:clean(x.delivery_type||"")||null,
        origin_label:clean(x.origin||"Santiago Centro")||"Santiago Centro",destination_label:canonicalDestination(x.destination),
        weight_kg:w,weight_band:clean(x.weight_band||"")||weightBand(w),shipment_price_clp:price,
        confidence:Math.max(0,Math.min(100,Number(x.confidence)||80)),evidence:clean(x.evidence).slice(0,1500),
        observed_at:new Date().toISOString(),metadata:{normalizationMethod:x.normalization_method||"explicit_public_rate",sourceFreshness:x.source_freshness||null,collector:key==="starken"?"chilexpress-starken-tarifa-simple-v1":key==="chilexpress"?"chilexpress-b2c-multiservice-v2":"chilexpress-b2c-worker-v1",backend:(key==="starken"||key==="chilexpress")?result?.backend||null:null,coverageSummary:result?.coverage_summary||null,dimensions:x.dimensions||null,originCode:x.originCode||null,destinationCode:x.destinationCode||null,eta:x.eta||null,...(x.metadata||{})}
      });
    }
    let inserted=0;
    let matrixMirrored=0;
    if(rows.length){
      const up=await sb.from("chilexpress_b2c_rates").upsert(rows,{onConflict:"organization_id,source_record_id"});
      if(up.error)throw new Error(up.error.message);
      inserted=rows.length;
      if(key==="starken")matrixMirrored=await mirrorStarkenToMatrix(rows);
      if(key==="correos")matrixMirrored=await mirrorCorreosToMatrix(rows);
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