import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function cors(){return{
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"content-type,x-starken-collector-token",
  "access-control-allow-methods":"POST,OPTIONS",
  "content-type":"application/json",
  "cache-control":"no-store"
}}
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors()})}
async function sha256(value:string){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function digest(value:string){return(await sha256(value)).slice(0,24)}
function clean(v:any){return String(v??"").replace(/[\u0000-\u001f\u007f]/g,"").trim()}
function band(w:number){if(w<=0.5)return"0–0,5 kg";if(w<=1)return"0,5–1 kg";if(w<=3)return"1–3 kg";if(w<=6)return"3–6 kg";if(w<=10)return"6–10 kg";if(w<=20)return"10–20 kg";return"20+ kg"}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors()});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);

  const token=req.headers.get("x-starken-collector-token")||"";
  if(!token)return reply({error:"unauthorized"},401);
  const tokenHash=await sha256(token);
  const credential=await sb.from("chilexpress_collector_tokens")
    .select("id,organization_id,enabled,metadata")
    .eq("token_hash",tokenHash).maybeSingle();
  if(credential.error||!credential.data?.enabled||credential.data?.metadata?.scope!=="starken_b2c_ingest")return reply({error:"unauthorized"},401);

  const body=await req.json().catch(()=>({}));
  const raw=Array.isArray(body?.quotes)?body.quotes:[];
  const trigger=body?.trigger==="schedule"?"schedule":"manual";
  const run=await sb.from("chilexpress_scrape_runs").insert({
    organization_id:credential.data.organization_id,layer:"b2c",source_key:"starken",
    trigger_kind:trigger,status:"running",metrics:{collector:"chrome_residential_v1",requested:raw.length}
  }).select("id").single();
  if(run.error)return reply({error:run.error.message},500);

  try{
    const rows:any[]=[];const observed=new Date().toISOString();const day=observed.slice(0,10);
    for(const q of raw.slice(0,500)){
      const price=Math.round(Number(q?.priceClp)),weight=Number(q?.weightKg),origin=clean(q?.origin),destination=clean(q?.destination),delivery=clean(q?.deliveryType||"DOMICILIO");
      if(!(price>0&&weight>0&&origin&&destination))continue;
      const dims={heightCm:Number(q?.heightCm)||null,widthCm:Number(q?.widthCm)||null,lengthCm:Number(q?.lengthCm)||null};
      const basis=["Starken",day,origin,destination,weight,delivery,price,dims.heightCm,dims.widthCm,dims.lengthCm].join("|");
      rows.push({
        organization_id:credential.data.organization_id,run_id:run.data.id,source_record_id:"starken:"+day+":"+await digest(basis),
        provider_name:"Starken",provider_group:"Starken",source_url:"https://www.starken.cl/cotizador",source_kind:"public_commercial_rate",
        service_type:clean(q?.serviceType||"NORMAL")||"NORMAL",delivery_type:delivery,origin_label:origin,destination_label:destination,
        weight_kg:weight,weight_band:clean(q?.weightBand||"")||band(weight),shipment_price_clp:price,confidence:99,
        evidence:`Cotización oficial Starken ejecutada desde navegador residencial: ${origin} → ${destination}, ${weight} kg, ${delivery}: $${price.toLocaleString("es-CL")}`,
        observed_at:observed,metadata:{normalizationMethod:"official_interactive_quote_local_browser",collector:"starken-chrome-residential-v1",dimensions:dims,originCode:q?.originCode??null,destinationCode:q?.destinationCode??null,rawDelivery:q?.deliveryLabel??null,eta:q?.eta??null}
      });
    }
    if(rows.length){const up=await sb.from("chilexpress_b2c_rates").upsert(rows,{onConflict:"organization_id,source_record_id"});if(up.error)throw new Error(up.error.message)}
    await sb.from("chilexpress_scrape_runs").update({
      status:rows.length?"ok":"partial",finished_at:new Date().toISOString(),
      metrics:{collector:"chrome_residential_v1",requested:raw.length,accepted:rows.length},
      errors:rows.length?[]:["No valid Starken quotes received from browser collector"]
    }).eq("id",run.data.id);
    await sb.from("chilexpress_collector_tokens").update({last_seen_at:new Date().toISOString()}).eq("id",credential.data.id);
    return reply({ok:true,runId:run.data.id,requested:raw.length,accepted:rows.length});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await sb.from("chilexpress_scrape_runs").update({status:"error",finished_at:new Date().toISOString(),errors:[msg]}).eq("id",run.data.id);
    return reply({ok:false,runId:run.data.id,error:msg},500);
  }
});