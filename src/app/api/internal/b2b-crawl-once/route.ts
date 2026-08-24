import { NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MP = "https://www.mercadopublico.cl";
const DETAIL = `${MP}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=`;
const AWARD_BASE = `${MP}/Procurement/Modules/RFB/StepsProcessAward/`;

const SEEDS = [
  { id: "1611-5-LE26", processDate: "2026-05-20", origin: "Santiago Centro", buyer: "SERNAC" },
  { id: "1867-2-LE26", processDate: "2026-02-02", origin: "Santiago Centro", buyer: "Dirección General de Movilización Nacional" },
  { id: "1094080-2-LE26", processDate: "2026-03-09", origin: "Santiago Centro", buyer: "DIVBIE - Almacén Militar del Ejército" },
] as const;

const CITY_DISTANCE: Record<string, { label: string; km: number }> = {
  antofagasta:{label:"Antofagasta",km:1089.8}, arica:{label:"Arica",km:1665}, chillan:{label:"Chillán",km:374.6},
  concepcion:{label:"Concepción",km:432.6}, copiapo:{label:"Copiapó",km:677.1}, iquique:{label:"Iquique",km:1470.7},
  "la serena":{label:"La Serena",km:398.2}, "puerto montt":{label:"Puerto Montt",km:913.9}, rancagua:{label:"Rancagua",km:80.5},
  "santiago centro":{label:"Santiago Centro",km:0}, santiago:{label:"Santiago Centro",km:0}, talca:{label:"Talca",km:237.8},
  temuco:{label:"Temuco",km:612.7}, valdivia:{label:"Valdivia",km:744.1}, valparaiso:{label:"Valparaíso",km:98.4},
};

type Seed = typeof SEEDS[number];
type Attachment = { control:string; name:string; type:string; sizeKb:number|null };
type Candidate = { providerGroup:string; providerName:string; destination:string; weightKg:number; price:number; confidence:number; evidence:string };

function norm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();}
function decode(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");}
function strip(v:string){return decode(v.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();}
function slug(v:string){return norm(v).replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");}
function parseMoney(v:string){const d=v.replace(/\s|\$/g,"").replace(/[^0-9]/g,""); if(!d)return null; const n=Number(d); return Number.isFinite(n)&&n>=500&&n<=500000?n:null;}
function provider(v:string){const n=norm(v); if(n.includes("chilexpress"))return{group:"Chilexpress",name:"Chilexpress S.A."}; if(n.includes("correos de chile")||n.includes("empresa de correos"))return{group:"CorreosChile",name:"Empresa de Correos de Chile"}; if(n.includes("starken"))return{group:"Starken",name:"Starken SpA"}; if(n.includes("blue express")||n.includes("bluexpress"))return{group:"Blue Express",name:"Blue Express"}; return null;}
function weight(v:string){const n=norm(v).replace(/,/g,"."); const kg=n.match(/(?:hasta|de|peso|ref\.?|referencia)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*kg\b/); if(kg){const x=Number(kg[1]); if(x>0&&x<=50)return x;} const g=n.match(/(?:hasta|de|peso)?\s*(\d{2,5})\s*(?:g|gr|gramos)\b/); if(g){const x=Number(g[1])/1000; if(x>0&&x<=50)return x;} return null;}
function city(v:string){const n=norm(v); return Object.entries(CITY_DISTANCE).find(([k])=>n.includes(k))?.[1]??null;}
function prices(v:string){return [...v.matchAll(/\$\s*[0-9][0-9.\s]{2,12}|\b[1-9][0-9]{2,5}(?:\.[0-9]{3})+\b/g)].map(m=>parseMoney(m[0])).filter((x):x is number=>x!==null);}
function hidden(html:string){const p=new URLSearchParams(); for(const m of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)){const tag=m[0], name=tag.match(/name=["']([^"']+)["']/i)?.[1]; if(name)p.set(name,decode(tag.match(/value=["']([^"']*)["']/i)?.[1]??""));} return p;}
function cookies(headers:Headers){const anyH=headers as Headers&{getSetCookie?:()=>string[]}; const raw=anyH.getSetCookie?.()??(headers.get("set-cookie")?[headers.get("set-cookie") as string]:[]); const out:string[]=[]; for(const s of raw)for(const m of s.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g))out.push(m[1]); return [...new Set(out)].join("; ");}
function attachments(html:string){const out:Attachment[]=[]; const re=/<tr[^>]*>[\s\S]*?id=["']DWNL_grdId_(ctl\d+)_File["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?id=["']DWNL_grdId_\1_Type["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?id=["']DWNL_grdId_\1_FileLength["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?name=["']DWNL\$grdId\$\1\$search["']/gi; for(const m of html.matchAll(re)){const t=strip(m[4]); const sm=t.match(/([0-9.]+)\s*(KB|MB)/i); out.push({control:`DWNL$grdId$${m[1]}$search`,name:strip(m[2]),type:strip(m[3]),sizeKb:sm?Number(sm[1])*(sm[2].toUpperCase()==="MB"?1024:1):null});} return out;}
function relevant(a:Attachment){const n=norm(`${a.name} ${a.type}`); if(/conflict|declaracion jurada|ausencia/.test(n))return false; return /acta|evaluacion|econom|oferta|tarif|cuadro|adjudic|resolucion/.test(n);}
async function resolveAward(id:string){const r=await fetch(`${DETAIL}${encodeURIComponent(id)}`,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}}); if(!r.ok)throw new Error(`ficha ${id}: ${r.status}`); const h=await r.text(); const qs=h.match(/(?:StepsProcessAward\/)?PreviewAwardAct\.aspx\?qs=([^"'&<\s]+)/i)?.[1]; if(!qs)throw new Error(`acta no encontrada ${id}`); return `${AWARD_BASE}PreviewAwardAct.aspx?qs=${qs}`;}
async function openAward(url:string){const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}}); if(!r.ok)throw new Error(`acta ${r.status}`); return{html:await r.text(),cookie:cookies(r.headers)};}
async function download(url:string,html:string,cookie:string,a:Attachment){const p=hidden(html); p.set(`${a.control}.x`,"1"); p.set(`${a.control}.y`,"1"); const r=await fetch(url,{method:"POST",cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0",accept:"application/pdf,application/octet-stream,*/*","content-type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:p.toString()}); if(!r.ok)throw new Error(`${a.name}: ${r.status}`); const b=Buffer.from(await r.arrayBuffer()); if(b.length>12*1024*1024)throw new Error(`${a.name}: >12MB`); if(!b.subarray(0,5).toString().startsWith("%PDF"))throw new Error(`${a.name}: no PDF`); return b;}
function extract(text:string){const lines=text.split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean); const out:Candidate[]=[]; let p:ReturnType<typeof provider>=null, w:number|null=null; for(let i=0;i<lines.length;i++){const ctx=lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(" | "); p=provider(ctx)??p; w=weight(ctx)??w; const c=city(lines[i])??city(ctx); const ps=prices(lines[i]); if(!p||!w||!c||!ps.length)continue; if(!/tarifa|precio|valor|monto unitario|oferta economica|costo/.test(norm(ctx)))continue; for(const price of ps)out.push({providerGroup:p.group,providerName:p.name,destination:c.label,weightKg:w,price,confidence:88,evidence:ctx.slice(0,700)});} const uniq=new Map<string,Candidate>(); for(const x of out){const k=`${x.providerGroup}|${x.destination}|${x.weightKg}|${x.price}`; if(!uniq.has(k))uniq.set(k,x);} return [...uniq.values()].slice(0,100);}
function rateRows(cands:Candidate[],seed:Seed,url:string,a:Attachment){return cands.map(x=>{const c=CITY_DISTANCE[norm(x.destination)]; return {source_record_id:`mp-b2b-${slug(seed.id)}-${slug(a.name)}-${slug(x.providerGroup)}-${slug(x.destination)}-${String(x.weightKg).replace(".","_")}-${x.price}`,source:"mercado_publico_annex",source_kind:"mercado_publico_b2b_rate",source_url:url,category:"courier",provider_name:x.providerName,provider_group:x.providerGroup,buyer_name:seed.buyer,service_type:"Courier / tarifa B2B observada",origin_label:seed.origin,destination_label:x.destination,weight_kg:x.weightKg,distance_km:c?.km??null,shipment_price_clp:x.price,confidence:x.confidence,normalization_method:"mercado_publico_annex_explicit_rate",process_date:seed.processDate,metadata:{processId:seed.id,attachment:a.name,evidence:x.evidence,sourceLayer:"public-sector B2B observed",distanceMethod:"city_centroid_geodesic"}};});}

export async function GET(){
  const deadline=Date.now()+50000; const rates:any[]=[]; const extractions:any[]=[]; const warnings:string[]=[]; let pdfsRead=0,attachmentsDetected=0;
  for(const seed of SEEDS){if(Date.now()>=deadline)break; try{const awardUrl=await resolveAward(seed.id); const page=await openAward(awardUrl); const list=attachments(page.html).filter(relevant).slice(0,5); attachmentsDetected+=list.length; for(const a of list){if(Date.now()>=deadline)break; try{const pdf=await download(awardUrl,page.html,page.cookie,a); pdfsRead++; const parsed=await pdfParse(pdf); const text=(parsed.text||"").replace(/\u0000/g,"").trim(); if(text.length<80){extractions.push({processId:seed.id,attachment:a.name,status:"scanned",pages:parsed.numpages??null}); continue;} const c=extract(text); const rr=rateRows(c,seed,awardUrl,a); rates.push(...rr); extractions.push({processId:seed.id,attachment:a.name,status:c.length?"parsed":"no_price",pages:parsed.numpages??null,candidates:c.slice(0,20)});}catch(e){warnings.push(`${seed.id}/${a.name}: ${e instanceof Error?e.message:"error"}`);}}}catch(e){warnings.push(`${seed.id}: ${e instanceof Error?e.message:"error"}`);}}
  const dedup=new Map<string,any>(); for(const r of rates)dedup.set(r.source_record_id,r);
  return NextResponse.json({ok:true,attachmentsDetected,pdfsRead,acceptedComparableRates:dedup.size,rates:[...dedup.values()],extractions,warnings},{headers:{"cache-control":"no-store"}});
}
