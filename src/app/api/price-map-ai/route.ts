import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.SUPABASE_PUBLISHABLE_KEY??"sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
function headers(token:string,extra:Record<string,string>={}){return{apikey:SUPABASE_KEY,authorization:`Bearer ${token}`,"content-type":"application/json",...extra};}
async function json(response:Response){const text=await response.text();try{return text?JSON.parse(text):null}catch{return null}}
function title(q:string){const x=q.replace(/\s+/g," ").trim();return x.length<=58?x:`${x.slice(0,55).trimEnd()}…`;}

async function createConversation(token:string,org:string,q:string){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?select=id,title`,{method:"POST",headers:headers(token,{Prefer:"return=representation"}),body:JSON.stringify({organization_id:org,title:title(q),conversation_type:"price_map"}),cache:"no-store",signal:AbortSignal.timeout(8000)});
  const d=await json(r);if(!r.ok||!Array.isArray(d)||!d[0]?.id)throw new Error(d?.message||"No fue posible crear la conversación.");return{id:String(d[0].id),title:String(d[0].title)};
}
async function save(token:string,org:string,id:string,m:{role:"user"|"assistant";content:string;brand?:string|null;ai?:boolean;payload?:unknown}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages`,{method:"POST",headers:headers(token),body:JSON.stringify({conversation_id:id,organization_id:org,role:m.role,content:m.content,brand:m.brand??null,ai:m.ai??null,payload:m.payload??{}}),cache:"no-store",signal:AbortSignal.timeout(8000)});if(!r.ok){const d=await json(r);throw new Error(d?.message||"No fue posible guardar el mensaje.");}
}
async function touch(token:string,org:string,id:string,brand?:string|null){await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}&conversation_type=eq.price_map`,{method:"PATCH",headers:headers(token),body:JSON.stringify({updated_at:new Date().toISOString(),last_brand:brand??null}),cache:"no-store",signal:AbortSignal.timeout(8000)});}

export async function POST(request:NextRequest){
  const access=await enterpriseAccess(request,"optimizer");if(access.response)return access.response;
  const token=request.cookies.get("mgp_access_token")?.value;if(!token)return NextResponse.json({error:"No autorizado"},{status:401});
  try{
    const body=await request.json();const messages=Array.isArray(body?.messages)?body.messages:[];
    const last=[...messages].reverse().find((m:any)=>m?.role==="user"&&typeof m?.content==="string")?.content?.trim();if(!last)return NextResponse.json({error:"Falta la pregunta."},{status:400});
    const org=access.access!.organizationId;let conversationId=typeof body?.conversationId==="string"?body.conversationId:"";let conversationTitle:string|undefined;
    if(!conversationId){const c=await createConversation(token,org,last);conversationId=c.id;conversationTitle=c.title;}
    await save(token,org,conversationId,{role:"user",content:last});
    const r=await fetch(`${SUPABASE_URL}/functions/v1/ai-price-map`,{method:"POST",headers:headers(token),body:JSON.stringify({organizationId:org,messages,filters:body?.filters??{}}),cache:"no-store",signal:AbortSignal.timeout(30000)});
    const d=await json(r)??{};
    if(r.ok&&d?.answer){await save(token,org,conversationId,{role:"assistant",content:String(d.answer),brand:d.map?.targetBrand??null,ai:d.ai,payload:{analysis:d.analysis??null,map:d.map??null,model:d.model??null}});await touch(token,org,conversationId,d.map?.targetBrand??null);}
    return NextResponse.json({...d,conversationId,conversationTitle},{status:r.status});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"No fue posible generar el mapa."},{status:500});}
}
