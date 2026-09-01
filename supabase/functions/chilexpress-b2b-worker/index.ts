import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const TARGETS:any = {
  "servel-oferta": { qs:"GyIjPxWfp99UXtgDGR5gnQ==", ctl:"rptAttachment$ctl05$imgShow", name:"Anexo_N3_Oferta_Economica.pdf", provider:"Empresa de Correos de Chile", providerGroup:"CorreosChile", processId:"5155-40-LE25", buyer:"Servicio Electoral" },
  "uchile-correos": { qs:"IzHV4W7bPuyf5yq4y0RIGA==", ctl:"rptAttachment$ctl11$imgShow", name:"COT_60.503.000-9.pdf", provider:"Empresa de Correos de Chile", providerGroup:"CorreosChile", processId:"UCHILE_COURIER", buyer:"Universidad de Chile" },
  "uchile-chilexpress": { qs:"IzHV4W7bPuyf5yq4y0RIGA==", ctl:"rptAttachment$ctl12$imgShow", name:"COT_96.756.430-3.pdf", provider:"Chilexpress", providerGroup:"Chilexpress", processId:"UCHILE_COURIER", buyer:"Universidad de Chile" },
  "dgmn-courier": { qs:"5H0iAsYDU3Zwm+cEFaxaBw==", ctl:"rptAttachment$ctl02$imgShow", name:"4108 4 courier.pdf", provider:"Empresa de Correos de Chile", providerGroup:"CorreosChile", processId:"DGMN_COURIER", buyer:"Dirección General de Movilización Nacional" }
};

function clean(v:any){ return String(v ?? "").replace(/\u0000/g,"").trim(); }
function htmlDecode(v:string){ return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," "); }
function hiddenInputs(html:string){
  const p=new URLSearchParams();
  for(const m of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)){
    const tag=m[0], name=tag.match(/name=["']([^"']+)["']/i)?.[1];
    if(name) p.set(name, htmlDecode(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? ""));
  }
  return p;
}
function cookieHeader(headers:Headers){
  const h=headers as Headers & { getSetCookie?:()=>string[] };
  const raw=h.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const out:string[]=[];
  for(const s of raw) for(const m of s.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g)) out.push(m[1]);
  return [...new Set(out)].join("; ");
}
function outputText(j:any){
  if(typeof j?.output_text==="string") return j.output_text.trim();
  return (j?.output ?? []).flatMap((x:any)=>x?.content ?? []).filter((x:any)=>x?.type==="output_text" && typeof x.text==="string").map((x:any)=>x.text).join("\n").trim();
}
async function runtime(){
  const {data,error}=await sb.rpc("get_ai_runtime_config_service");
  if(error || !data) throw new Error(error?.message || "ai_runtime_missing");
  return data as {enabled?:boolean;api_key?:string|null;model?:string|null};
}
async function chooseModel(apiKey:string, preferred?:string|null){
  if(preferred && preferred!=="auto") return preferred;
  try{
    const r=await fetch("https://api.openai.com/v1/models",{headers:{authorization:"Bearer "+apiKey},signal:AbortSignal.timeout(8000)});
    const j=await r.json(); const ids=new Set<string>((j?.data ?? []).map((x:any)=>String(x.id)));
    for(const id of ["gpt-5.6","gpt-5.5","gpt-5.1","gpt-5","gpt-4.1"]) if(ids.has(id)) return id;
  }catch{}
  return "gpt-4.1";
}
async function digest(s:string){
  const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,24);
}
function band(w:number|null){
  if(!w||w<=0)return "Sin peso"; if(w<=0.5)return "0–0,5 kg"; if(w<=1)return "0,5–1 kg";
  if(w<=3)return "1–3 kg"; if(w<=5)return "3–5 kg"; if(w<=10)return "5–10 kg"; if(w<=20)return "10–20 kg"; return "20+ kg";
}
async function download(target:any){
  const url="https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs="+encodeURIComponent(target.qs);
  const initial=await fetch(url,{headers:{"user-agent":"Mozilla/5.0",accept:"text/html"},redirect:"follow",signal:AbortSignal.timeout(15000)});
  if(!initial.ok) throw new Error("attachment_page_"+initial.status);
  const html=await initial.text(), params=hiddenInputs(html);
  params.set(target.ctl+".x","1"); params.set(target.ctl+".y","1");
  const cookie=cookieHeader(initial.headers);
  const r=await fetch(url,{method:"POST",headers:{"user-agent":"Mozilla/5.0",accept:"*/*","content-type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:params.toString(),redirect:"follow",signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw new Error("attachment_download_"+r.status);
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length<100 || new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-") throw new Error("attachment_not_pdf");
  return {url,bytes};
}
function toBase64(bytes:Uint8Array){
  let out=""; const n=0x8000;
  for(let i=0;i<bytes.length;i+=n) out+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+n)));
  return btoa(out);
}
async function extractPdf(apiKey:string, modelName:string, target:any, bytes:Uint8Array){
  const schema:any={type:"object",additionalProperties:false,properties:{
    document_summary:{type:"string"},
    rates:{type:"array",maxItems:180,items:{type:"object",additionalProperties:false,properties:{
      provider:{type:"string"},origin:{type:["string","null"]},destination:{type:["string","null"]},region_or_zone:{type:["string","null"]},
      weight_kg:{type:["number","null"]},weight_band:{type:["string","null"]},service_type:{type:["string","null"]},delivery_type:{type:["string","null"]},
      unit_price_clp:{type:["number","null"]},price_basis:{type:"string",enum:["shipment","kg","band","global","other"]},
      comparable:{type:"boolean"},confidence:{type:"integer",minimum:0,maximum:100},evidence:{type:"string"}
    },required:["provider","origin","destination","region_or_zone","weight_kg","weight_band","service_type","delivery_type","unit_price_clp","price_basis","comparable","confidence","evidence"]}},
    global_amounts:{type:"array",items:{type:"object",additionalProperties:false,properties:{amount_clp:{type:"number"},evidence:{type:"string"}},required:["amount_clp","evidence"]}},
    notes:{type:"array",items:{type:"string"}}
  },required:["document_summary","rates","global_amounts","notes"]};
  const prompt="Documento público de Mercado Público/ChileCompra. Proveedor esperado: "+target.provider+". Comprador: "+target.buyer+
  ". Extrae SOLO pricing courier/logístico B2B explícito. comparable=true solo si hay precio unitario/banda con contexto suficiente de peso y ruta/zona/servicio. "+
  "No conviertas montos globales, presupuestos, garantías, puntajes ni montos totales de contrato en tarifas. No inventes destino, peso, servicio ni precio. "+
  "Si es escaneado usa visión. Devuelve una fila por tarifa explícita y evidencia breve.";
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:"Bearer "+apiKey,"content-type":"application/json"},body:JSON.stringify({
    model:modelName,store:false,input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_file",filename:target.name,file_data:"data:application/pdf;base64,"+toBase64(bytes)}]}],
    max_output_tokens:10000,text:{format:{type:"json_schema",name:"courier_b2b_document",strict:true,schema}}
  }),signal:AbortSignal.timeout(95000)});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error("openai_"+r.status+":"+String(j?.error?.message||""));
  const t=outputText(j); if(!t) throw new Error("empty_ai_output"); return JSON.parse(t);
}
function validMP(url:string){
  try{const h=new URL(url).hostname.toLowerCase();return h.endsWith("mercadopublico.cl")||h.endsWith("chilecompra.cl");}catch{return false;}
}
function dateVal(v:any){ return typeof v==="string" && /^20\d\d-\d\d-\d\d/.test(v) ? v.slice(0,10) : null; }
async function discover(apiKey:string, modelName:string){
  const schema:any={type:"object",additionalProperties:false,properties:{
    processes:{type:"array",maxItems:40,items:{type:"object",additionalProperties:false,properties:{
      process_id:{type:["string","null"]},title:{type:"string"},buyer_name:{type:["string","null"]},process_state:{type:["string","null"]},
      process_type:{type:["string","null"]},publication_date:{type:["string","null"]},closing_date:{type:["string","null"]},award_date:{type:["string","null"]},
      source_url:{type:"string"},relevance:{type:"integer",minimum:0,maximum:100},providers_visible:{type:"array",items:{type:"string"}},evidence:{type:"string"}
    },required:["process_id","title","buyer_name","process_state","process_type","publication_date","closing_date","award_date","source_url","relevance","providers_visible","evidence"]}},
    notes:{type:"array",items:{type:"string"}}
  },required:["processes","notes"]};
  const prompt="Busca procesos públicos de Mercado Público/ChileCompra en Chile publicados o adjudicados durante 2025-2026 relacionados con courier, encomiendas, correspondencia, paquetería, valijas, mensajería, distribución de documentos o despacho. "+
  "Prioriza procesos donde aparezcan Chilexpress, Blue Express, Starken o Empresa de Correos de Chile. Solo URLs de mercadopublico.cl o chilecompra.cl. No inventes IDs ni fechas. Relevance 80+ si el objeto es directamente courier/paquetería.";
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:"Bearer "+apiKey,"content-type":"application/json"},body:JSON.stringify({
    model:modelName,input:prompt,store:false,tools:[{type:"web_search_preview",search_context_size:"high",user_location:{type:"approximate",country:"CL",timezone:"America/Santiago"}}],tool_choice:{type:"web_search_preview"},max_output_tokens:8000,
    text:{format:{type:"json_schema",name:"mercado_publico_courier_processes",strict:true,schema}}
  }),signal:AbortSignal.timeout(95000)});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error("openai_"+r.status+":"+String(j?.error?.message||""));
  const t=outputText(j); if(!t) throw new Error("empty_ai_output"); return JSON.parse(t);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return Response.json({error:"method_not_allowed"},{status:405});
  const supplied=req.headers.get("x-chilexpress-worker-token");
  const token=await sb.from("qsr_worker_config").select("token").eq("id",1).single();
  if(!supplied||!token.data?.token||supplied!==token.data.token) return Response.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>({}));
  const mode=body?.mode==="target" ? "target" : "discover";
  const triggerKind=body?.trigger==="schedule" ? "schedule" : body?.trigger==="backfill" ? "backfill" : "manual";
  const org=await sb.from("organizations").select("id").eq("slug","chilexpress").single();
  if(org.error) return Response.json({error:"chilexpress_org_missing"},{status:500});
  const sourceKey=mode==="target" ? String(body?.target||"unknown") : "mercado-publico-discovery";
  const run=await sb.from("chilexpress_scrape_runs").insert({organization_id:org.data.id,layer:"b2b",source_key:sourceKey,trigger_kind:triggerKind,status:"running"}).select("id").single();
  if(run.error) return Response.json({error:run.error.message},{status:500});
  const runId=run.data.id as string;
  try{
    const cfg=await runtime(); if(!cfg.enabled||!cfg.api_key) throw new Error("ai_runtime_unavailable");
    const m=await chooseModel(cfg.api_key,cfg.model);
    if(mode==="discover"){
      const result=await discover(cfg.api_key,m), raw=Array.isArray(result?.processes)?result.processes:[], rows:any[]=[];
      for(const x of raw.filter((z:any)=>Number(z?.relevance)>=40 && validMP(String(z?.source_url||"")))){
        const url=clean(x.source_url), processId=clean(x.process_id)||null, key=processId || await digest(url);
        rows.push({organization_id:org.data.id,run_id:runId,source_record_id:"mp:"+key,process_id:processId,title:clean(x.title).slice(0,1000),buyer_name:clean(x.buyer_name)||null,
          process_state:clean(x.process_state)||null,process_type:clean(x.process_type)||null,publication_date:dateVal(x.publication_date),closing_date:dateVal(x.closing_date),award_date:dateVal(x.award_date),
          source_url:url,relevance:Math.max(0,Math.min(100,Number(x.relevance)||50)),observed_at:new Date().toISOString(),metadata:{providersVisible:x.providers_visible??[],evidence:clean(x.evidence).slice(0,1200),collector:"chilexpress-b2b-worker-v1"}});
      }
      if(rows.length){const up=await sb.from("chilexpress_b2b_processes").upsert(rows,{onConflict:"organization_id,source_record_id"});if(up.error)throw new Error(up.error.message);}
      await sb.from("chilexpress_scrape_runs").update({status:rows.length?"ok":"partial",finished_at:new Date().toISOString(),metrics:{model:m,found:raw.length,accepted:rows.length,notes:(result?.notes??[]).slice(0,10)},errors:rows.length?[]:["No relevant public processes accepted"]}).eq("id",runId);
      return Response.json({ok:true,runId,mode,found:raw.length,accepted:rows.length});
    }

    const targetKey=String(body?.target||""); const target=TARGETS[targetKey]; if(!target) throw new Error("unknown_target");
    const dl=await download(target), parsed=await extractPdf(cfg.api_key,m,target,dl.bytes), day=new Date().toISOString().slice(0,10);
    const docSource="mpdoc:"+targetKey+":"+day;
    const docUp=await sb.from("chilexpress_b2b_documents").upsert({organization_id:org.data.id,run_id:runId,source_record_id:docSource,process_id:target.processId,source_url:dl.url,attachment_name:target.name,attachment_type:"pdf",provider_group:target.providerGroup,
      status:"parsed",parser:"openai_pdf",document_summary:clean(parsed?.document_summary).slice(0,6000),extracted_rates:Array.isArray(parsed?.rates)?parsed.rates:[],evidence:(parsed?.notes??[]).slice(0,20).join(" | ").slice(0,5000),
      observed_at:new Date().toISOString(),metadata:{collector:"chilexpress-b2b-worker-v1",bytes:dl.bytes.length,buyer:target.buyer}}, {onConflict:"organization_id,source_record_id"}).select("id").single();
    if(docUp.error) throw new Error(docUp.error.message);
    const rawRates=Array.isArray(parsed?.rates)?parsed.rates:[], accepted=rawRates.filter((x:any)=>x?.comparable===true && Number(x?.unit_price_clp)>0 && x?.price_basis!=="global" && Number(x?.confidence)>=60), rateRows:any[]=[];
    for(const x of accepted){
      const w=Number(x.weight_kg)>0?Number(x.weight_kg):null, price=Math.round(Number(x.unit_price_clp)), dest=clean(x.destination||x.region_or_zone)||null;
      const basis=[targetKey,day,clean(x.provider||target.provider),clean(x.origin),dest||"",String(w??x.weight_band??""),String(price),clean(x.evidence)].join("|");
      rateRows.push({organization_id:org.data.id,run_id:runId,document_id:docUp.data.id,source_record_id:"mprate:"+targetKey+":"+day+":"+await digest(basis),process_id:target.processId,
        provider_name:clean(x.provider||target.provider),provider_group:target.providerGroup,buyer_name:target.buyer,source_url:dl.url,source_kind:"mercado_publico_offer_rate",service_type:clean(x.service_type)||"Courier",
        delivery_type:clean(x.delivery_type)||null,origin_label:clean(x.origin)||null,destination_label:dest,weight_kg:w,weight_band:clean(x.weight_band)||band(w),shipment_price_clp:price,price_basis:clean(x.price_basis)||"shipment",
        confidence:Math.max(0,Math.min(100,Number(x.confidence)||80)),evidence:clean(x.evidence).slice(0,1500),observed_at:new Date().toISOString(),metadata:{regionOrZone:x.region_or_zone||null,collector:"chilexpress-b2b-worker-v1"}});
    }
    if(rateRows.length){const up=await sb.from("chilexpress_b2b_rates").upsert(rateRows,{onConflict:"organization_id,source_record_id"});if(up.error)throw new Error(up.error.message);}
    const status=rateRows.length?"ok":"partial"; if(!rateRows.length) await sb.from("chilexpress_b2b_documents").update({status:"no_price"}).eq("id",docUp.data.id);
    await sb.from("chilexpress_scrape_runs").update({status,finished_at:new Date().toISOString(),metrics:{model:m,target:targetKey,bytes:dl.bytes.length,candidateRates:rawRates.length,acceptedRates:rateRows.length,globalAmounts:(parsed?.global_amounts??[]).length},errors:rateRows.length?[]:["Document parsed but no high-confidence comparable unit rates were accepted"]}).eq("id",runId);
    return Response.json({ok:true,runId,mode,target:targetKey,status,candidates:rawRates.length,accepted:rateRows.length,documentId:docUp.data.id});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await sb.from("chilexpress_scrape_runs").update({status:"error",finished_at:new Date().toISOString(),errors:[msg]}).eq("id",runId);
    return Response.json({ok:false,runId,error:msg},{status:500});
  }
});