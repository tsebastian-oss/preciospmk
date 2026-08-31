import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery } from "@/lib/clickhouse";
import { victorinoxMarketIntelligence } from "@/lib/victorinox-market";

export const dynamic="force-dynamic";
export const revalidate=0;

function cell(value:unknown){const text=value==null?"":String(value);return '"'+text.replace(/"/g,'""')+'"';}
function csv(headers:string[],rows:unknown[][]){return "\uFEFFsep=,\r\n"+[headers,...rows].map(row=>row.map(cell).join(",")).join("\r\n");}

export async function GET(request:NextRequest){
 const auth=await enterpriseAccess(request,"brand-panel");
 if(auth.response)return auth.response;
 if(!auth.access||!brandScopeAllows(auth.access,"victorinox"))return NextResponse.json({error:"Victorinox no está habilitado."},{status:403});
 if(!clickHouseConfigured())return NextResponse.json({error:"ClickHouse no disponible."},{status:503});
 const mode=request.nextUrl.searchParams.get("mode")||"current";
 const today=new Date().toISOString().slice(0,10);
 try{
  if(mode==="history"){
   const rows=await clickHouseQuery<{date:string;brand:string;category:string;median_price:number|string;products:number|string}>(`
     SELECT toString(d.price_date) date, lowerUTF8(ifNull(p.brand,'')) brand,
       multiIf(
         lowerUTF8(ifNull(p.brand,'')) IN ('tissot','seiko','citizen') OR positionCaseInsensitiveUTF8(concat(ifNull(p.name,''),' ',ifNull(p.category,'')),'reloj')>0,'Relojes',
         lowerUTF8(ifNull(p.brand,'')) IN ('samsonite','american tourister','saxoline') OR positionCaseInsensitiveUTF8(concat(ifNull(p.name,''),' ',ifNull(p.category,'')),'maleta')>0,'Equipo de viaje',
         lowerUTF8(ifNull(p.brand,''))='leatherman' OR positionCaseInsensitiveUTF8(concat(ifNull(p.name,''),' ',ifNull(p.category,'')),'navaj')>0,'Navajas y multiherramientas',
         'Cuchillos') category,
       round(quantileTDigest(.5)(toFloat64(d.effective_price)),0) median_price,
       uniqExact(d.product_id) products
     FROM daily_pricing_live d
     INNER JOIN products p ON p.id=d.product_id
     WHERE lowerUTF8(ifNull(p.brand,'')) IN ('victorinox','tissot','seiko','citizen','samsonite','american tourister','saxoline','leatherman','arcos','global','zwilling','tramontina','wusthof')
       AND d.effective_price>0
       AND d.price_date>=today()-INTERVAL 180 DAY
     GROUP BY d.price_date,brand,category
     ORDER BY d.price_date,category,brand
   `,{},12_000);
   const body=csv(["Fecha","Marca","Categoría","Mediana","SKU"],rows.map(r=>[r.date,r.brand,r.category,r.median_price,r.products]));
   return new NextResponse(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="victorinox-historico-${today}.csv"`,"cache-control":"private, no-store"}});
  }

  const market=await victorinoxMarketIntelligence(auth.access);
  if(mode==="matrix"){
   const groups=new Map<string,typeof market.listings>();
   for(const row of market.listings){const key=`${row.retailer}::${row.category}::${row.brand}`;groups.set(key,[...(groups.get(key)??[]),row]);}
   const rows=[...groups.entries()].map(([key,items])=>{const[retailer,category,brand]=key.split("::");const prices=items.map(x=>x.currentPrice).filter(x=>x>0);return[retailer,category,brand,items.length,prices.length?Math.round(prices.reduce((a,b)=>a+b,0)/prices.length):null];});
   const body=csv(["Retailer","Categoría","Marca","SKU","Precio promedio"],rows);
   return new NextResponse(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="victorinox-matriz-${today}.csv"`,"cache-control":"private, no-store"}});
  }

  const body=csv(["Marca","Retailer","Producto","Categoría","Precio actual","Precio regular","Promoción %","Stock","Observado","URL"],market.listings.map(r=>[r.brand,r.retailer,r.name,r.category,r.currentPrice,r.regularPrice,r.promotionPct,r.inStock?"Disponible":"Sin stock",r.observedAt,r.url]));
  return new NextResponse(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="victorinox-base-vigente-${today}.csv"`,"cache-control":"private, no-store"}});
 }catch(error){console.error("victorinox-export",error);return NextResponse.json({error:"No fue posible generar la descarga."},{status:503});}
}
