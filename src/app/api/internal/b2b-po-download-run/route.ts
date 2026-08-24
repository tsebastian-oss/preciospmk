import { NextResponse } from "next/server";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PAGES = [
  { id:"1082957-770-AG24", qs:"3iMGkWFdkQftbXZ6/g7dFQ==", controls:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"96.756.430-3",provider:"Chilexpress"},{ctl:"gvCotizacion$ctl03$lnkAdjunto",rut:"60.503.000-9",provider:"CorreosChile"}] },
  { id:"886182-36-AG24", qs:"IB5xGbCgIWejdcOp7yy1ZQ==", controls:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"96.756.430-3",provider:"Chilexpress"}] },
  { id:"892208-2-AG26", qs:"3jdtl+q+CYGGxbh5+t9vPw==", controls:[{ctl:"gvCotizacion$ctl02$lnkAdjunto",rut:"18.828.546-5",provider:"unknown"}] },
] as const;

function decode(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");}
function cookieHeader(headers:Headers){const anyH=headers as Headers&{getSetCookie?:()=>string[]}; const raw=anyH.getSetCookie?.()??(headers.get("set-cookie")?[headers.get("set-cookie") as string]:[]); const out:string[]=[]; for(const s of raw)for(const m of s.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g))out.push(m[1]); return [...new Set(out)].join("; ");}
function hiddenInputs(html:string){const p=new URLSearchParams(); for(const m of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)){const tag=m[0],name=tag.match(/name=["']([^"']+)["']/i)?.[1]; if(name)p.set(name,decode(tag.match(/value=["']([^"']*)["']/i)?.[1]??""));} return p;}
function fileName(headers:Headers){const cd=headers.get("content-disposition")||""; return decode(cd.match(/filename\*?=(?:UTF-8''|["']?)([^"';\r\n]+)/i)?.[1]??"");}
function htmlLinks(text:string){return [...text.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(m=>decode(m[1])).filter(x=>/attach|adjunt|file|download|cotiz|archiv|\.pdf|\.xls|\.xlsx|\.doc/i.test(x)).slice(0,80);}

async function pageHtml(qs:string){const url=`https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?qs=${encodeURIComponent(qs)}`; const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}}); if(!r.ok)throw new Error(`GET ${r.status}`); return {url,html:await r.text(),cookie:cookieHeader(r.headers)};}

async function downloadQuote(url:string,html:string,cookie:string,eventTarget:string){
  const p=hiddenInputs(html); p.set("__EVENTTARGET",eventTarget); p.set("__EVENTARGUMENT","");
  const r=await fetch(url,{method:"POST",cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0",accept:"*/*","content-type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:p.toString()});
  const b=Buffer.from(await r.arrayBuffer()); const ct=r.headers.get("content-type")||""; const name=fileName(r.headers); const magic=b.subarray(0,16).toString("hex");
  const out:any={status:r.status,finalUrl:r.url,contentType:ct,contentDisposition:r.headers.get("content-disposition"),fileName:name,bytes:b.length,magic};
  if(b.subarray(0,5).toString()==="%PDF-"){try{const parsed=await pdfParse(b); out.kind="pdf"; out.pages=parsed.numpages??null; out.text=(parsed.text||"").replace(/\u0000/g,"").slice(0,30000);}catch(e){out.kind="pdf_parse_error";out.error=e instanceof Error?e.message:"pdf parse";}}
  else if(/text|html|json|xml/i.test(ct)||b.subarray(0,1).toString()==="<"){const text=b.toString("utf8");out.kind="text";out.text=text.slice(0,30000);out.links=htmlLinks(text);}
  else {out.kind="binary"; out.base64Sample=b.subarray(0,256).toString("base64");}
  return out;
}

export async function GET(){const results:any[]=[]; for(const page of PAGES){try{const src=await pageHtml(page.qs); for(const c of page.controls){try{const d=await downloadQuote(src.url,src.html,src.cookie,c.ctl);results.push({po:page.id,rut:c.rut,provider:c.provider,...d});}catch(e){results.push({po:page.id,rut:c.rut,provider:c.provider,error:e instanceof Error?e.message:"download error"});}}}catch(e){results.push({po:page.id,error:e instanceof Error?e.message:"page error"});}} return NextResponse.json({ok:true,results},{headers:{"cache-control":"no-store"}});}
