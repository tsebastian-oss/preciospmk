import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";
export const dynamic="force-dynamic"; export const revalidate=0; export const maxDuration=60;
const P=[
 {po:"DGMN_CORREOS_2026",qs:"5H0iAsYDU3Zwm+cEFaxaBw=="},
 {po:"SERVEL_CORREOS_2026",qs:"GyIjPxWfp99UXtgDGR5gnQ=="},
 {po:"UCHILE_CHILEXPRESS_2026",qs:"IzHV4W7bPuyf5yq4y0RIGA=="}
] as const;
function dec(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ")}
function clean(s:string){return dec(s.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
export async function GET(request: NextRequest){const denied=await denyUnlessInternal(request);if(denied)return denied;const results:any[]=[];for(const x of P){const url=`https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=${encodeURIComponent(x.qs)}`;try{const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}});const h=await r.text();const links=[...h.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:dec(m[1]),text:clean(m[2])})).filter(v=>v.href&&!/^javascript:void/i.test(v.href)).slice(0,100);const inputs=[...h.matchAll(/<(?:input|button)[^>]*(?:name|id)=["']([^"']+)["'][^>]*>/gi)].map(m=>dec(m[0])).filter(t=>/file|attach|adjunt|download|archiv|grd|dwnl|lnk/i.test(t)).slice(0,100);const rows=[...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>clean(m[1])).filter(t=>/pdf|xls|xlsx|doc|tarif|cotiz|anexo|archivo/i.test(t)).slice(0,100);results.push({po:x.po,status:r.status,url,bytes:h.length,links,inputs,rows,htmlSample:h.slice(0,15000)});}catch(e){results.push({po:x.po,error:e instanceof Error?e.message:"error"})}}return NextResponse.json({ok:true,results},{headers:{"cache-control":"no-store"}})}
