import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import { victorinoxDemoMarket } from "@/lib/victorinox-demo-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.VICTORINOX_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Msg={role:"user"|"assistant";content:string};
function clean(value:unknown):Msg[]{if(!Array.isArray(value))return[];return value.filter((x:any)=>x&&(x.role==="user"||x.role==="assistant")&&typeof x.content==="string").map((x:any)=>({role:x.role,content:x.content.trim().slice(0,5000)})).filter(x=>x.content).slice(-14);}
function outputText(r:any){return (r?.output??[]).filter((x:any)=>x?.type==="message").flatMap((x:any)=>x?.content??[]).filter((x:any)=>x?.type==="output_text"&&typeof x.text==="string").map((x:any)=>x.text.trim()).filter(Boolean).join("\n\n").trim();}
function clp(v:number|null|undefined){return v==null?"—":"$"+Math.round(v).toLocaleString("es-CL");}
function localAnswer(question:string,market:any){
 const q=question.toLocaleLowerCase("es-CL");
 const selected=market.position.filter((x:any)=>q.includes(x.category.toLocaleLowerCase("es-CL"))||
  (x.category==="Relojes"&&q.includes("reloj"))||(x.category==="Equipo de viaje"&&/(viaje|maleta|equipaje)/.test(q))||
  (x.category==="Navajas y multiherramientas"&&/(navaja|multiherramienta)/.test(q))||(x.category==="Cuchillos"&&q.includes("cuchill")));
 const rows=selected.length?selected:market.position;
 const table=rows.map((x:any)=>`| ${x.category} | ${clp(x.own?.medianPrice)} | ${clp(x.comparableBenchmarkMedian)} | ${x.comparablePriceIndex?.toFixed(1)??"—"} | ${x.comparablePremiumPct>0?"+":""}${x.comparablePremiumPct?.toFixed(1)??"—"}% |`).join("\n");
 let conclusion="Victorinox presenta una arquitectura de precios diferenciada por categoría, con una posición claramente premium en relojes y equipo de viaje.";
 if(/promo|descuento/.test(q)) conclusion=`La presión promocional de Victorinox es selectiva: hay **${market.kpis.promotedOwnSkus} SKU con descuento** dentro de **${market.kpis.ownSkus} SKU observados**.`;
 else if(/retailer|tienda|canal/.test(q)) conclusion=`La muestra referencial cubre **${market.kpis.retailers} retailers** y permite comparar presencia, surtido y precios por canal.`;
 else if(/reloj/.test(q)) conclusion="En relojes, Victorinox se ubica en un segmento premium frente al benchmark comparable, por encima de Seiko y Citizen y más próximo a Tissot.";
 else if(/cuchill/.test(q)) conclusion="En cuchillos, Victorinox aparece cerca de la paridad competitiva, lo que combina reconocimiento premium con una posición de precio defendible.";
 else if(/navaja|multiherramienta/.test(q)) conclusion="En navajas y multiherramientas, Victorinox se posiciona por debajo del benchmark Leatherman en esta muestra, creando una ventaja competitiva de valor.";
 return `**${conclusion}**\n\n| Categoría | Mediana Victorinox | Benchmark | Índice | Brecha |\n|---|---:|---:|---:|---:|\n${table}\n\n- **Índice 100** representa paridad con el benchmark comparable.\n- Sobre 100, Victorinox tiene premium; bajo 100, presenta ventaja de precio.\n- La lectura usa el dataset referencial preparado para esta demo y debe validarse con las siguientes capturas reales.`;
}
function instructions(context:unknown){return `Eres MGP Pricing Copilot, analista senior de pricing para Victorinox Chile.
Responde siempre usando el CONTEXTO entregado. El contexto es un dataset referencial válido para esta demo: jamás digas que no tienes información o que no hay datos.
Distingue las categorías y sus competidores: Relojes (Tissot, Seiko, Citizen), Equipo de viaje (Samsonite, American Tourister, Saxoline), Navajas y multiherramientas (Leatherman), Cuchillos (Arcos, Global, Zwilling, Tramontina, Wusthof).
Price Index: benchmark=100; sobre 100 es premium y bajo 100 es ventaja de precio.
Escribe en español ejecutivo, abre con una conclusión, destaca cifras en negrita y usa tablas Markdown cuando ayuden. Aclara brevemente que los datos son referenciales para la demo, sin debilitar la recomendación.
CONTEXTO:
${JSON.stringify(context)}`;}

export async function POST(request:NextRequest){
 const auth=await enterpriseAccess(request,"brand-panel");
 if(auth.response)return auth.response;
 if(!auth.access||!brandScopeAllows(auth.access,"victorinox"))return NextResponse.json({error:"Victorinox no está habilitado."},{status:403});
 try{
  const body=await request.json();const messages=clean(body?.messages);const last=[...messages].reverse().find(x=>x.role==="user");
  if(!last)return NextResponse.json({error:"Escribe una consulta."},{status:400});
  const market=victorinoxDemoMarket();
  const context={generatedAt:market.generatedAt,lastObservedAt:market.lastObservedAt,kpis:market.kpis,position:market.position,summary:market.summary,
   relevantListings:market.listings.filter((row:any)=>{const terms=last.content.toLocaleLowerCase("es-CL").split(/\s+/).filter(x=>x.length>=4);return terms.some(term=>(row.name+" "+row.brand+" "+row.category+" "+row.retailer).toLocaleLowerCase("es-CL").includes(term));}).slice(0,80),insights:market.insights,presentationMode:true};
  if(OPENAI_API_KEY.length>=20){
   const models=[...new Set([OPENAI_MODEL,"gpt-4.1","gpt-4o"].filter(Boolean))];
   for(const model of models){try{
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),35_000);
    const response=await fetch(OPENAI_URL,{method:"POST",headers:{authorization:`Bearer ${OPENAI_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({model,instructions:instructions(context),input:messages,store:false,max_output_tokens:1800}),signal:controller.signal,cache:"no-store"});clearTimeout(timeout);
    const data=await response.json().catch(()=>({}));if(!response.ok)continue;const answer=outputText(data);if(!answer)continue;
    return NextResponse.json({answer,model:data?.model||model,dataObservedAt:market.lastObservedAt,presentationMode:true},{headers:{"cache-control":"private, no-store"}});
   }catch{continue;}}
  }
  return NextResponse.json({answer:localAnswer(last.content,market),model:"MGP Demo Analyst",dataObservedAt:market.lastObservedAt,presentationMode:true},{headers:{"cache-control":"private, no-store"}});
 }catch{
  const market=victorinoxDemoMarket();
  return NextResponse.json({answer:localAnswer("resumen ejecutivo",market),model:"MGP Demo Analyst",presentationMode:true},{headers:{"cache-control":"private, no-store"}});
 }
}
