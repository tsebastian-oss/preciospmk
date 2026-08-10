import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.SUPABASE_PUBLISHABLE_KEY??"sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
function headers(token:string,extra:Record<string,string>={}){return{apikey:SUPABASE_KEY,authorization:`Bearer ${token}`,"content-type":"application/json",...extra};}
async function json(response:Response){const text=await response.text();try{return text?JSON.parse(text):null}catch{return null}}
function title(q:string){const x=q.replace(/\s+/g," ").trim();return x.length<=58?x:`${x.slice(0,55).trimEnd()}…`;}
function isDataTimeout(value:unknown){const x=(value instanceof Error?value.message:String(value??"")).toLowerCase();return x.includes("57014")||x.includes("statement timeout")||x.includes("canceling statement")||x.includes("query_canceled")||x.includes("query canceled")||x.includes("timed out")||x.includes("timeout");}
function safeFailure(value:unknown,fallback:string){if(isDataTimeout(value))return"El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.";const message=value instanceof Error?value.message:String(value??"");if(/postgres|supabase|sqlstate|pgrst|57014|canceling statement/i.test(message))return fallback;return message||fallback;}

async function createConversation(token:string,org:string,q:string){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?select=id,title`,{method:"POST",headers:headers(token,{Prefer:"return=representation"}),body:JSON.stringify({organization_id:org,title:title(q),conversation_type:"price_map"}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  const d=await json(r);if(!r.ok||!Array.isArray(d)||!d[0]?.id)throw new Error(safeFailure(d?.message,"No fue posible crear la conversación."));return{id:String(d[0].id),title:String(d[0].title)};
}
async function save(token:string,org:string,id:string,m:{role:"user"|"assistant";content:string;brand?:string|null;ai?:boolean;payload?:unknown}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages`,{method:"POST",headers:headers(token),body:JSON.stringify({conversation_id:id,organization_id:org,role:m.role,content:m.content,brand:m.brand??null,ai:m.ai??null,payload:m.payload??{}}),cache:"no-store",signal:AbortSignal.timeout(15000)});if(!r.ok){const d=await json(r);throw new Error(safeFailure(d?.message,"No fue posible guardar el mensaje."));}
}
async function touch(token:string,org:string,id:string,brand?:string|null){await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}&conversation_type=eq.price_map`,{method:"PATCH",headers:headers(token),body:JSON.stringify({updated_at:new Date().toISOString(),last_brand:brand??null}),cache:"no-store",signal:AbortSignal.timeout(15000)});}

export async function POST(request:NextRequest){
  const access=await enterpriseAccess(request,"optimizer");if(access.response)return access.response;
  const token=request.cookies.get("mgp_access_token")?.value;if(!token)return NextResponse.json({error:"No autorizado"},{status:401});
  try{
    const body=await request.json();const messages=Array.isArray(body?.messages)?body.messages:[];
    const last=[...messages].reverse().find((m:any)=>m?.role==="user"&&typeof m?.content==="string")?.content?.trim();if(!last)return NextResponse.json({error:"Falta la pregunta."},{status:400});
    const org=access.access!.organizationId;let conversationId=typeof body?.conversationId==="string"?body.conversationId:"";let conversationTitle:string|undefined;
    if(!conversationId){const c=await createConversation(token,org,last);conversationId=c.id;conversationTitle=c.title;}
    await save(token,org,conversationId,{role:"user",content:last});
    const r=await fetch(`${SUPABASE_URL}/functions/v1/ai-price-map`,{method:"POST",headers:headers(token),body:JSON.stringify({organizationId:org,messages,filters:body?.filters??{}}),cache:"no-store",signal:AbortSignal.timeout(90000)});
    const d=await json(r)??{};
    if(!r.ok&&isDataTimeout(d?.error)){return NextResponse.json({error:"El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.",code:"DATA_TIMEOUT",transient:true,conversationId,conversationTitle},{status:503});}
    if(!r.ok&&d?.error){d.error=safeFailure(d.error,"No fue posible construir el mapa en este momento.");}
    if(r.ok&&d?.answer){await save(token,org,conversationId,{role:"assistant",content:String(d.answer),brand:d.map?.targetBrand??null,ai:d.ai,payload:{analysis:d.analysis??null,map:d.map??null,model:d.model??null}});await touch(token,org,conversationId,d.map?.targetBrand??null);}
    return NextResponse.json({...d,conversationId,conversationTitle},{status:r.status});
  }catch(e){const transient=isDataTimeout(e);return NextResponse.json(transient?{error:"El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.",code:"DATA_TIMEOUT",transient:true}:{error:safeFailure(e,"No fue posible generar el mapa.")},{status:transient?503:500});}
}
