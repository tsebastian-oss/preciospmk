import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.SUPABASE_PUBLISHABLE_KEY??"sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
function headers(token:string){return{apikey:SUPABASE_KEY,authorization:`Bearer ${token}`,"content-type":"application/json"};}
async function readJson(r:Response){const t=await r.text();try{return t?JSON.parse(t):null}catch{return null}}

export async function GET(request:NextRequest){
  const access=await enterpriseAccess(request,"optimizer");if(access.response)return access.response;
  const token=request.cookies.get("mgp_access_token")?.value;if(!token)return NextResponse.json({error:"No autorizado"},{status:401});
  const org=access.access!.organizationId;const id=request.nextUrl.searchParams.get("id");
  try{
    if(id){const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages?conversation_id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}&select=id,role,content,brand,ai,payload,created_at&order=created_at.asc,id.asc`,{headers:headers(token),cache:"no-store",signal:AbortSignal.timeout(8000)});const d=await readJson(r);if(!r.ok)return NextResponse.json({error:d?.message||"No fue posible cargar la conversación."},{status:r.status});return NextResponse.json({messages:Array.isArray(d)?d:[]});}
    const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?organization_id=eq.${encodeURIComponent(org)}&conversation_type=eq.price_map&select=id,title,last_brand,created_at,updated_at&order=updated_at.desc&limit=50`,{headers:headers(token),cache:"no-store",signal:AbortSignal.timeout(8000)});const d=await readJson(r);if(!r.ok)return NextResponse.json({error:d?.message||"No fue posible cargar el historial."},{status:r.status});return NextResponse.json({conversations:Array.isArray(d)?d:[]});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"No fue posible cargar el historial."},{status:500});}
}

export async function DELETE(request:NextRequest){
  const access=await enterpriseAccess(request,"optimizer");if(access.response)return access.response;
  const token=request.cookies.get("mgp_access_token")?.value;if(!token)return NextResponse.json({error:"No autorizado"},{status:401});
  const org=access.access!.organizationId;const id=request.nextUrl.searchParams.get("id");if(!id)return NextResponse.json({error:"Falta la conversación."},{status:400});
  try{const r=await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(org)}&conversation_type=eq.price_map`,{method:"DELETE",headers:headers(token),cache:"no-store",signal:AbortSignal.timeout(8000)});const d=await readJson(r);if(!r.ok)return NextResponse.json({error:d?.message||"No fue posible eliminar la conversación."},{status:r.status});return NextResponse.json({ok:true});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"No fue posible eliminar la conversación."},{status:500});}
}
