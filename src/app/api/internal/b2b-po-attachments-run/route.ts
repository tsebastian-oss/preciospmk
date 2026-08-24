import { NextResponse } from "next/server";
export const dynamic="force-dynamic"; export const revalidate=0; export const maxDuration=60;
const P=[
 {po:"UTARAPACA-2026",qs:"Bt2OVs/y+GyXo1Fgl+ukSg=="},
 {po:"1082957-770-AG24",qs:"feCRjqW7pwWm1AgSMC5v3g=="},
 {po:"886182-36-AG24",qs:"Z2ycgkvkGKgbe0ASpltswQ=="},
 {po:"892208-2-AG26",qs:"V8ckU2Rz+r4kej8lNdnZoQ=="}
] as const;
function dec(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ")}
function clean(s:string){return dec(s.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
export async function GET(){const results:any[]=[];for(const x of P){const url=`https://www.mercadopublico.cl/Portal/Modules/Site/AdvancedSearch/ViewAttachmentPurchaseOrder.aspx?qs=${encodeURIComponent(x.qs)}`;try{const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}});const h=await r.text();const links=[...h.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:dec(m[1]),text:clean(m[2])})).filter(v=>v.href&&!/^javascript:void/i.test(v.href)).slice(0,100);const inputs=[...h.matchAll(/<(?:input|button)[^>]*(?:name|id)=["']([^"']+)["'][^>]*>/gi)].map(m=>dec(m[0])).filter(t=>/file|attach|adjunt|download|archiv|grd|dwnl|lnk/i.test(t)).slice(0,100);const rows=[...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>clean(m[1])).filter(t=>/pdf|xls|xlsx|doc|tarif|cotiz|anexo|archivo/i.test(t)).slice(0,100);results.push({po:x.po,status:r.status,url,bytes:h.length,links,inputs,rows,htmlSample:h.slice(0,15000)});}catch(e){results.push({po:x.po,error:e instanceof Error?e.message:"error"})}}return NextResponse.json({ok:true,results},{headers:{"cache-control":"no-store"}})}
