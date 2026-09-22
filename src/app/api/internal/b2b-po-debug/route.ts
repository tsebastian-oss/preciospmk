import { NextRequest, NextResponse } from "next/server";
import { denyUnlessInternal } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGES = [
  { id: "1082957-770-AG24", qs: "3iMGkWFdkQftbXZ6/g7dFQ==" },
  { id: "892208-2-AG26", qs: "3jdtl+q+CYGGxbh5+t9vPw==" },
  { id: "UTARAPACA-2026", qs: "6Pw/FG4PGImsdV7wKfOjgA==" },
  { id: "886182-36-AG24", qs: "IB5xGbCgIWejdcOp7yy1ZQ==" },
] as const;

function decode(v:string){return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");}
function clip(html:string, needle:string, radius=2500){const p=html.toLowerCase().indexOf(needle.toLowerCase()); return p<0?null:html.slice(Math.max(0,p-radius),Math.min(html.length,p+radius));}

export async function GET(request: NextRequest){
  const denied=await denyUnlessInternal(request); if(denied) return denied;

  const results:any[]=[];
  for(const page of PAGES){
    const url=`https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?qs=${encodeURIComponent(page.qs)}`;
    try{
      const r=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0",accept:"text/html"}});
      const html=await r.text();
      const tags=[...html.matchAll(/<(?:a|input|button)[^>]*(?:adjunt|cotiza|Attch|attachment|download|archivo)[^>]*>/gi)].map(m=>decode(m[0])).slice(0,80);
      const postbacks=[...html.matchAll(/__doPostBack\(([^)]{1,500})\)/gi)].map(m=>m[0]).filter(x=>/cot|adj|file|attach|anex/i.test(x)).slice(0,40);
      const hrefs=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>decode(m[1])).filter(x=>/cot|adj|file|attach|anex|archiv|download/i.test(x)).slice(0,80);
      const inputs=[...html.matchAll(/<(?:input|button)[^>]+(?:name|id)=["']([^"']+)["'][^>]*>/gi)].map(m=>m[0]).filter(x=>/cot|adj|file|attach|anex|archiv|download/i.test(x)).slice(0,80);
      results.push({id:page.id,status:r.status,url,bytes:html.length,tags,postbacks,hrefs,inputs,cotizacionesSnippet:clip(html,"Datos cotizaciones",5000),verAdjuntoSnippet:clip(html,"Ver adjunto",3500)});
    }catch(e){results.push({id:page.id,error:e instanceof Error?e.message:"error"});}
  }
  return NextResponse.json({ok:true,results},{headers:{"cache-control":"no-store"}});
}
