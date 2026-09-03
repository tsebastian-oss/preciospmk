import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";
export const dynamic="force-dynamic"; export const revalidate=0; export const maxDuration=60;
const P=[
 {po:"1082957-770-AG24",qs:"3iMGkWFdkQftbXZ6/g7dFQ==",items:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"96.756.430-3",provider:"Chilexpress"},{ctl:"gvCotizacion$ctl03$lnkAdjunto",rut:"60.503.000-9",provider:"CorreosChile"}]},
 {po:"886182-36-AG24",qs:"IB5xGbCgIWejdcOp7yy1ZQ==",items:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"96.756.430-3",provider:"Chilexpress"}]},
 {po:"892208-2-AG26",qs:"3jdtl+q+CYGGxbh5+t9vPw==",items:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"18.828.546-5",provider:"unknown"}]}
] as const;
function dec(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ")}
function hidden(h:string){const p=new URLSearchParams();for(const m of h.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)){const t=m[0],n=t.match(/name=["']([^"']+)["']/i)?.[1];if(n)p.set(n,dec(t.match(/value=["']([^"']*)["']/i)?.[1]??""))}return p}
function cookies(h:Headers){const a=h as Headers&{getSetCookie?:()=>string[]};const raw=a.getSetCookie?.()??(h.get("set-cookie")?[h.get("set-cookie") as string]:[]);const o:string[]=[];for(const s of raw)for(const m of s.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g))o.push(m[1]);return [...new Set(o)].join("; ")}
async function source(qs:string){const url=`https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?qs=${encodeURIComponent(qs)}`;const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0"}});return{url,html:await r.text(),cookie:cookies(r.headers)}}
async function file(url:string,html:string,cookie:string,ctl:string){const p=hidden(html);p.set("__EVENTTARGET",ctl);p.set("__EVENTARGUMENT","");const r=await fetch(url,{method:"POST",cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0","content-type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:p.toString()});const b=Buffer.from(await r.arrayBuffer());return{status:r.status,bytes:b.length,contentDisposition:r.headers.get("content-disposition"),base64:b.length<=100000?b.toString("base64"):null}}
export async function GET(request: NextRequest){const denied=await denyUnlessInternal(request);if(denied)return denied;const results:any[]=[];for(const x of P){const s=await source(x.qs);for(const i of x.items){try{results.push({po:x.po,rut:i.rut,provider:i.provider,...await file(s.url,s.html,s.cookie,i.ctl)})}catch(e){results.push({po:x.po,rut:i.rut,provider:i.provider,error:e instanceof Error?e.message:"error"})}}}return NextResponse.json({ok:true,results},{headers:{"cache-control":"no-store"}})}
