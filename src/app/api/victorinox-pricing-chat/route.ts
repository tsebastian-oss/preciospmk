import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import { victorinoxMarketIntelligence } from "@/lib/victorinox-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.VICTORINOX_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Msg={role:"user"|"assistant";content:string};

function clean(value:unknown):Msg[]{if(!Array.isArray(value))return[];return value.filter((x:any)=>x&&(x.role==="user"||x.role==="assistant")&&typeof x.content==="string").map((x:any)=>({role:x.role,content:x.content.trim().slice(0,5000)})).filter(x=>x.content).slice(-14);}
function outputText(r:any){return (r?.output??[]).filter((x:any)=>x?.type==="message").flatMap((x:any)=>x?.content??[]).filter((x:any)=>x?.type==="output_text"&&typeof x.text==="string").map((x:any)=>x.text.trim()).filter(Boolean).join("\n\n").trim();}
function instructions(context:unknown){return `Eres MGP Pricing Copilot, analista senior de pricing para Victorinox Chile.

OBJETIVO
Responder con precisión sobre posicionamiento competitivo, precios, promociones, retailers, categorías y arquitectura de portafolio de Victorinox.

REGLAS
- Usa exclusivamente los datos entregados en CONTEXTO o por el usuario.
- No inventes costos, márgenes, ventas, elasticidades ni disponibilidad.
- Victorinox compite con sets distintos según categoría:
  * Relojes: Tissot, Seiko, Citizen.
  * Equipo de viaje: Samsonite, American Tourister, Saxoline.
  * Navajas y multiherramientas: Leatherman.
  * Cuchillos: Arcos, Global, Zwilling, Tramontina, Wusthof.
- No mezcles categorías distintas para inferir posicionamiento.
- Si comparas marcas, prioriza mediana y explica retailer/categoría.
- Price Index: benchmark = 100. Sobre 100 = Victorinox más caro; bajo 100 = más barato.
- Separa precio de lista y promoción cuando existan.
- Si falta evidencia para una conclusión, dilo claramente.

FORMATO
- Español ejecutivo.
- Empieza con una conclusión breve.
- Usa **negritas** en cifras clave.
- Usa tablas Markdown para comparaciones de 3 o más alternativas.
- Máximo 4-6 bullets salvo que el usuario pida detalle.
- CLP como "$129.900".
- Sin JSON, HTML ni bloques de código.

CONTEXTO
${JSON.stringify(context)}`;}

export async function POST(request:NextRequest){
 const auth=await enterpriseAccess(request,"brand-panel");
 if(auth.response)return auth.response;
 if(!auth.access||!brandScopeAllows(auth.access,"victorinox"))return NextResponse.json({error:"Victorinox no está habilitado."},{status:403});
 if(OPENAI_API_KEY.length<20)return NextResponse.json({error:"AI Copilot no está configurado."},{status:503});
 try{
  const body=await request.json();const messages=clean(body?.messages);const last=[...messages].reverse().find(x=>x.role==="user");
  if(!last)return NextResponse.json({error:"Escribe una consulta."},{status:400});
  const market=await victorinoxMarketIntelligence(auth.access);
  const context={
   generatedAt:market.generatedAt,lastObservedAt:market.lastObservedAt,kpis:market.kpis,
   position:market.position,summary:market.summary,
   relevantListings:market.listings.filter(row=>{
    const q=last.content.toLocaleLowerCase("es-CL");
    return q.split(/\s+/).filter(x=>x.length>=4).some(term=>(row.name+" "+row.brand+" "+row.category+" "+row.retailer).toLocaleLowerCase("es-CL").includes(term));
   }).slice(0,80),
   insights:market.insights,
  };
  const models=[...new Set([OPENAI_MODEL,"gpt-5.6","gpt-5.1","gpt-5","gpt-4.1"].filter(Boolean))];
  for(const model of models){
   try{
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),50_000);
    const response=await fetch(OPENAI_URL,{method:"POST",headers:{authorization:`Bearer ${OPENAI_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({model,instructions:instructions(context),input:messages,store:false,max_output_tokens:2200}),signal:controller.signal,cache:"no-store"});clearTimeout(timeout);
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if([400,403,404].includes(response.status))continue;break;}
    const answer=outputText(data);if(!answer)continue;
    return NextResponse.json({answer,model:data?.model||model,dataObservedAt:market.lastObservedAt},{headers:{"cache-control":"private, no-store"}});
   }catch{continue;}
  }
  return NextResponse.json({error:"No fue posible consultar el Copilot."},{status:503});
 }catch{return NextResponse.json({error:"No fue posible consultar el Copilot."},{status:503});}
}
