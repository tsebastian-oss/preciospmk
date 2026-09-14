type DemoListing={id:string;retailer:string;brand:string;name:string;category:string;currentPrice:number;regularPrice:number|null;promotionPct:number|null;inStock:boolean;observedAt:string;url:string};
const CATEGORIES=["Relojes","Equipo de viaje","Navajas y multiherramientas","Cuchillos"];
const RETAILERS=["Victorinox Store","Falabella","Paris","Mercado Libre","Kitchen Center"];
const CONFIG=[
 {category:"Relojes",own:429990,brands:[["Tissot",489990],["Seiko",319990],["Citizen",279990]]},
 {category:"Equipo de viaje",own:249990,brands:[["Samsonite",219990],["American Tourister",149990],["Saxoline",109990]]},
 {category:"Navajas y multiherramientas",own:64990,brands:[["Leatherman",89990]]},
 {category:"Cuchillos",own:59990,brands:[["Zwilling",69990],["Wusthof",79990],["Global",89990],["Arcos",39990],["Tramontina",29990]]},
] as const;
function median(values:number[]){const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function avg(values:number[]){return Math.round(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length))}
function round1(value:number){return Math.round(value*10)/10}
export function victorinoxDemoMarket(){
 const now=new Date().toISOString(),listings:DemoListing[]=[];
 for(const cfg of CONFIG){
  const brands:[string,number][]=[["Victorinox",cfg.own],...(cfg.brands as readonly (readonly [string,number])[]).map(x=>[x[0],x[1]])];
  brands.forEach(([brand,base],bi)=>RETAILERS.slice(0,brand==="Victorinox"?5:3+(bi%2)).forEach((retailer,ri)=>{
   const count=brand==="Victorinox"?4:3;
   for(let i=0;i<count;i++){const regular=Math.round(base*(.86+i*.085+ri*.018)/1000)*1000;const promo=(i+ri+bi)%4===0;const price=promo?Math.round(regular*.9/1000)*1000:regular;
    listings.push({id:`demo-${cfg.category}-${brand}-${ri}-${i}`,retailer,brand,name:`${brand} ${cfg.category} ${String(i+1).padStart(2,"0")}`,category:cfg.category,currentPrice:price,regularPrice:promo?regular:null,promotionPct:promo?round1((regular-price)/regular*100):null,inStock:true,observedAt:now,url:"#"});
   }
  }));
 }
 const summary=[] as any[];
 for(const category of CATEGORIES)for(const brand of [...new Set(listings.filter(x=>x.category===category).map(x=>x.brand))]){const rows=listings.filter(x=>x.category===category&&x.brand===brand),prices=rows.map(x=>x.currentPrice);
  summary.push({category,brand,skuCount:rows.length,retailers:new Set(rows.map(x=>x.retailer)).size,averagePrice:avg(prices),medianPrice:Math.round(median(prices)),minPrice:Math.min(...prices),maxPrice:Math.max(...prices),promoPct:round1(rows.filter(x=>x.promotionPct).length/rows.length*100)});
 }
 const position=CATEGORIES.map(category=>{const rows=summary.filter(x=>x.category===category),own=rows.find(x=>x.brand==="Victorinox"),competitors=rows.filter(x=>x.brand!=="Victorinox"),benchmark=Math.round(median(competitors.map(x=>x.medianPrice))),index=round1(own.medianPrice/benchmark*100);
  return{category,own,benchmarkMedian:benchmark,priceIndex:index,premiumPct:round1(index-100),comparableBenchmarkMedian:benchmark,comparablePriceIndex:index,comparablePremiumPct:round1(index-100),comparableSample:listings.filter(x=>x.category===category&&x.brand!=="Victorinox").length,comparableBand:{low:Math.round(own.minPrice),high:Math.round(own.maxPrice)},competitors};
 });
 const brands=[...new Set(listings.map(x=>x.brand))],own=listings.filter(x=>x.brand==="Victorinox");
 return{source:"demo-fallback",demo:true,generatedAt:now,lastObservedAt:now,categories:CATEGORIES,retailers:RETAILERS,brands,kpis:{marketSkus:listings.length,ownSkus:own.length,competitorBrands:brands.length-1,retailers:RETAILERS.length,promotedOwnSkus:own.filter(x=>x.promotionPct).length},position,summary,listings,insights:["Victorinox sostiene un posicionamiento premium consistente en las cuatro categorías monitoreadas.","Relojes y equipo de viaje concentran la mayor oportunidad de optimización de surtido por retailer.","Navajas mantiene alta diferenciación de marca frente a un benchmark competitivo acotado.","La presión promocional es selectiva y preserva la arquitectura premium de precios."]};
}
export function victorinoxDemoHistory(days:number){
 const market=victorinoxDemoMarket(),points=12,today=new Date();
 return{source:"demo-fallback",demo:true,brand:"Victorinox",days,categories:market.position.map((row:any,ci:number)=>({category:row.category,points:Array.from({length:points},(_,i)=>{const dt=new Date(today);dt.setUTCDate(dt.getUTCDate()-Math.round((points-1-i)*days/(points-1)));const wave=Math.sin(i*.8+ci)*.018,own=Math.round((row.own.medianPrice*(1+(i-points+1)*.002+wave))/1000)*1000,benchmark=Math.round((row.comparableBenchmarkMedian*(1+(i-points+1)*.001-wave*.35))/1000)*1000,index=round1(own/benchmark*100);return{date:dt.toISOString().slice(0,10),ownMedian:own,benchmarkMedian:benchmark,priceIndex:index,premiumPct:round1(index-100),ownProducts:row.own.skuCount,competitorProducts:row.comparableSample,competitorBrands:row.competitors.length}})})),method:"demo_daily_median_vs_competitor_median"};
}
