import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { victorinoxMarketFromRows, type RawRow } from "@/lib/victorinox-market";
import { mergeVictorinoxOfficialMarket } from "@/lib/victorinox-real-market";

export const dynamic="force-dynamic"; export const revalidate=0;
const KEY=process.env.OPENAI_API_KEY??"", MODEL=(process.env.VICTORINOX_OPENAI_MODEL??process.env.OPENAI_MODEL??"gpt-4.1").trim(), URL="https://api.openai.com/v1/responses";
type Msg={role:"user"|"assistant";content:string};
function clean(v:unknown):Msg[]{return Array.isArray(v)?v.filter((x:any)=>x&&(x.role==="user"||x.role==="assistant")&&typeof x.content==="string").map((x:any)=>({role:x.role,content:x.content.trim().slice(0,5000)})).filter((x:any)=>x.content).slice(-14):[];}
function output(r:any){return (r?.output??[]).filter((x:any)=>x?.type==="message").flatMap((x:any)=>x?.content??[]).filter((x:any)=>x?.type==="output_text").map((x:any)=>x.text?.trim()).filter(Boolean).join("\n\n");}
function clp(v:number|null|undefined){return v==null?"—":"$"+Math.round(v).toLocaleString("es-CL");}
function local(question:string,m:any){
 const q=question.toLocaleLowerCase("es-CL"),selected=m.position.filter((x:any)=>q.includes(x.category.toLocaleLowerCase("es-CL"))||(x.category==="Relojes"&&q.includes("reloj"))||(x.category==="Equipo de viaje"&&/(viaje|maleta|equipaje)/.test(q))||(x.category==="Navajas y multiherramientas"&&/(navaja|multiherramienta)/.test(q))||(x.category==="Cuchillos"&&q.includes("cuchill")));
 const rows=selected.length?selected:m.position,table=rows.map((x:any)=>`| ${x.category} | ${clp(x.own?.medianPrice)} | ${clp(x.comparableBenchmarkMedian)} | ${x.comparablePriceIndex?.toFixed(1)??"—"} |`).join("\n");
 return `**Lectura basada en precios reales observados.**\n\n| Categoría | Mediana Victorinox | Benchmark comparable | Índice |\n|---|---:|---:|---:|\n${table}\n\n- La fuente propia es victorinoxstore.cl; la competencia proviene del monitoreo de retailers.\n- Índice 100 representa paridad.\n- Cobertura oficial: **${m.kpis.ownSkus} productos**, observados al **${m.lastObservedAt??"—"}**.`;
}
function instructions(c:unknown){return `Eres MGP Pricing Copilot para Victorinox Chile. Responde solamente con el CONTEXTO real observado. Nunca inventes precios ni digas que no hay información si el contexto contiene filas. Distingue precio vigente, precio regular, muestra y fecha. Price Index: benchmark=100. Escribe en español ejecutivo, abre con una conclusión, destaca cifras y usa tablas Markdown. Si una categoría carece de muestra suficiente, dilo explícitamente. CONTEXTO REAL:\n${JSON.stringify(c)}`;}
export async function POST(request:NextRequest){
 const auth=await enterpriseAccess(request,"brand-panel"); if(auth.response)return auth.response;
 if(!auth.access||!brandScopeAllows(auth.access,"victorinox"))return NextResponse.json({error:"Victorinox no está habilitado."},{status:403});
 try{
  const body=await request.json(),messages=clean(body?.messages),last=[...messages].reverse().find(x=>x.role==="user"),localOnly=body?.localOnly===true;
  if(!last)return NextResponse.json({error:"Escribe una consulta."},{status:400});
  const light=await enterpriseRpc<Record<string,unknown>>(request,"brands_vertical_light_payload",{p_slug:"victorinox"});
  if(light.response||!light.data)return light.response??NextResponse.json({error:"Sin catálogo oficial disponible."},{status:503});
  const competition=await enterpriseRpc<RawRow[]>(request,"victorinox_competition_market_payload",{p_limit_per_brand:250});
  if(competition.response||!Array.isArray(competition.data))return competition.response??NextResponse.json({error:"Sin competencia real disponible."},{status:503});
  const market=mergeVictorinoxOfficialMarket(victorinoxMarketFromRows(competition.data),light.data);
  const terms=last.content.toLocaleLowerCase("es-CL").split(/\s+/).filter(x=>x.length>=4);
  const context={generatedAt:market.generatedAt,lastObservedAt:market.lastObservedAt,kpis:market.kpis,position:market.position,summary:market.summary,dataQuality:market.dataQuality,
   relevantListings:market.listings.filter((r:any)=>terms.some(t=>(r.name+" "+r.brand+" "+r.category+" "+r.retailer).toLocaleLowerCase("es-CL").includes(t))).slice(0,100),insights:market.insights};
  if(!localOnly&&KEY.length>=20)for(const model of [...new Set([MODEL,"gpt-4.1","gpt-4o"])]){
   try{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);const response=await fetch(URL,{method:"POST",headers:{authorization:`Bearer ${KEY}`,"content-type":"application/json"},body:JSON.stringify({model,instructions:instructions(context),input:messages,store:false,max_output_tokens:1800}),signal:controller.signal,cache:"no-store"});clearTimeout(timeout);const data=await response.json().catch(()=>({}));if(!response.ok)continue;const answer=output(data);if(answer)return NextResponse.json({answer,model:data?.model||model,dataObservedAt:market.lastObservedAt,presentationMode:false},{headers:{"cache-control":"private, no-store"}});}catch{}
  }
  return NextResponse.json({answer:local(last.content,market),model:localOnly?"MGP Real Data Analyst · QA":"MGP Real Data Analyst",dataObservedAt:market.lastObservedAt,presentationMode:false},{headers:{"cache-control":"private, no-store"}});
 }catch(error){console.error("victorinox chat",error);return NextResponse.json({error:"No fue posible consultar los datos reales."},{status:503});}
}
