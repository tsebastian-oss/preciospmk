import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const QUOTER_URL = "https://emprendedores.chilexpress.cl/cotizar";
const COVERAGE_URL = "https://services.wschilexpress.com/georeference/v2.1/api/v2.0/coverage-areas?type=0&regionCode=99";
const QUOTE_BASE = "https://services.wschilexpress.com/agendadigital/api/v5/Cotizador/GetCotizadorNacional";
const DESTINATIONS = ["Santiago Centro","Rancagua","Valparaíso","Talca","Chillán","Concepción","La Serena","Copiapó","Temuco","Valdivia","Puerto Montt","Antofagasta","Iquique","Arica"];

function normalize(value:string){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
}
async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function authorized(request:NextRequest){
  const supplied=request.headers.get("x-chilexpress-worker-token")||"";
  if(!supplied)return false;
  const actual=await sha256(supplied);
  if(actual.length!==TOKEN_SHA256.length)return false;
  let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^TOKEN_SHA256.charCodeAt(i);
  return diff===0;
}
function chileBrowserEndpoint(value:string){
  const url=new URL(value);
  const username=decodeURIComponent(url.username);
  if(username&&!/-country-[a-z]{2}(?:-|$)/i.test(username))url.username=username+"-country-cl";
  return url.toString();
}
function collectObjects(value:unknown,out:Record<string,unknown>[],depth=0){
  if(depth>6||value==null)return;
  if(Array.isArray(value)){for(const item of value.slice(0,5000))collectObjects(item,out,depth+1);return;}
  if(typeof value!=="object")return;
  const obj=value as Record<string,unknown>;out.push(obj);
  for(const next of Object.values(obj))if(next&&typeof next==="object")collectObjects(next,out,depth+1);
}
function cityCode(payload:unknown,city:string){
  const objects:Record<string,unknown>[]=[];collectObjects(payload,objects);
  const target=normalize(city);
  for(const obj of objects){
    const entries=Object.entries(obj);
    if(!entries.some(([,v])=>typeof v==="string"&&normalize(v)===target))continue;
    const preferred=entries.find(([k,v])=>typeof v==="string"&&/county.*code|city.*code|coverage.*code|cod.*comuna|codigo.*comuna/i.test(k)&&String(v).length<=12);
    if(preferred)return {code:String(preferred[1]),object:obj};
    const fallback=entries.find(([k,v])=>typeof v==="string"&&/code|cod/i.test(k)&&String(v).length<=8&&normalize(String(v))!==target);
    if(fallback)return {code:String(fallback[1]),object:obj};
  }
  return null;
}
function extractQuote(payload:any){
  const list=Array.isArray(payload?.ListCotiNacional)?payload.ListCotiNacional:[];
  return list.map((row:any)=>({
    service:String(row?.NOM_SERVICIO||""),
    serviceCode:Number(row?.COD_SERVICIO)||null,
    value:Number(row?.VALOR)||null,
    normalValue:Number(row?.VALOR_NORMAL)||null,
    eolValue:Number(row?.VALOR_EOL)||null,
    deliveryText:String(row?.GLS_ENTREGA||"")||null,
    deliveryDate:String(row?.FEC_ENTREGA||"")||null,
    weightCalc:Number(row?.PESO_CALCULO)||null,
    originSurcharge:Number(row?.TASA_ORIGEN)||null,
    destinationSurcharge:Number(row?.TASA_DESTINO)||null,
  })).filter((x:any)=>/BÁSICO|BASICO|ESTÁNDAR|ESTANDAR|PRIORITARIO/i.test(x.service));
}

export async function POST(request:NextRequest){
  if(!(await authorized(request)))return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>({}));
  const browserWs=process.env.BRIGHTDATA_BROWSER_WS?.trim()||String(body?.connectorEndpoint||"").trim();
  if(!browserWs)return NextResponse.json({error:"browser_not_configured"},{status:503});
  const requested:string[]=Array.isArray(body?.destinations)&&body.destinations.length?body.destinations.map((value:unknown)=>String(value)):DESTINATIONS;

  const {chromium}=await import("playwright-core");
  const browser=await chromium.connectOverCDP(chileBrowserEndpoint(browserWs),{timeout:12000});
  let serviceHeaders:Record<string,string>={};
  try{
    const context=browser.contexts()[0]||await browser.newContext({locale:"es-CL",timezoneId:"America/Santiago"});
    const page=context.pages()[0]||await context.newPage();
    page.on("request",async(req:any)=>{
      if(Object.keys(serviceHeaders).length)return;
      if(!/services\.wschilexpress\.com/i.test(req.url()))return;
      serviceHeaders=await req.allHeaders().catch(()=>({}));
    });
    await page.goto(QUOTER_URL,{waitUntil:"domcontentloaded",timeout:18000}).catch(()=>null);
    for(let i=0;i<32&&!Object.keys(serviceHeaders).length;i++)await page.waitForTimeout(250);
    if(!Object.keys(serviceHeaders).length){
      await page.reload({waitUntil:"commit",timeout:8000}).catch(()=>null);
      for(let i=0;i<16&&!Object.keys(serviceHeaders).length;i++)await page.waitForTimeout(250);
    }
  }finally{
    await browser.close();
  }

  if(!Object.keys(serviceHeaders).length)return NextResponse.json({error:"service_headers_not_captured"},{status:502});
  const headers:Record<string,string>={};
  for(const key of ["ocp-apim-subscription-key","x-api-key","authorization","accept","origin","referer","user-agent"]){
    const value=serviceHeaders[key];if(value)headers[key]=value;
  }

  const coverageResponse=await fetch(COVERAGE_URL,{headers,signal:AbortSignal.timeout(8000)});
  const coverage=await coverageResponse.json().catch(()=>null);
  if(!coverageResponse.ok||!coverage)return NextResponse.json({error:"coverage_failed",status:coverageResponse.status},{status:502});

  const originMatch=cityCode(coverage,"Santiago Centro");
  if(!originMatch)return NextResponse.json({error:"origin_code_missing",coveragePreview:JSON.stringify(coverage).slice(0,2500)},{status:502});

  const mapped=requested.map(destination=>({destination,match:cityCode(coverage,destination)}));
  const quotable=mapped.filter(x=>x.match?.code);
  const results=await Promise.all(quotable.map(async item=>{
    const url=new URL(QUOTE_BASE);
    url.searchParams.set("CIUDAD_ORIGEN",originMatch.code);
    url.searchParams.set("CIUDAD_DESTINO",item.match!.code);
    url.searchParams.set("CANAL_ORIGEN","18");
    url.searchParams.set("COD_PRODUCTO","3");
    url.searchParams.set("PESO","0.5");
    url.searchParams.set("ALTO","10");
    url.searchParams.set("ANCHO","10");
    url.searchParams.set("LARGO","20");
    url.searchParams.set("VALOR_DECLARADO","20000");
    url.searchParams.set("iNDTARIFAGENERICA","0");
    url.searchParams.set("COD_TCC_CLIENTE","18911542");
    try{
      const response=await fetch(url.toString(),{headers,signal:AbortSignal.timeout(8000)});
      const payload=await response.json().catch(()=>null);
      return {
        destination:item.destination,
        destinationCode:item.match!.code,
        ok:response.ok&&!!payload,
        services:payload?extractQuote(payload):[],
        status:response.status,
      };
    }catch(error){
      return {destination:item.destination,destinationCode:item.match!.code,ok:false,services:[],error:error instanceof Error?error.message:String(error)};
    }
  }));

  for(const item of mapped.filter(x=>!x.match?.code))results.push({destination:item.destination,destinationCode:null,ok:false,services:[],error:"destination_code_missing"} as any);

  return NextResponse.json({
    ok:true,
    observedAt:new Date().toISOString(),
    sourceUrl:QUOTER_URL,
    origin:"Santiago Centro",
    originCode:originMatch.code,
    weightKg:0.5,
    dimensions:{heightCm:10,widthCm:10,lengthCm:20},
    declaredValueClp:20000,
    results,
    diagnostics:{
      coverageStatus:coverageResponse.status,
      mappedDestinations:quotable.length,
      requestedDestinations:requested.length,
      headerNames:Object.keys(headers),
      originObject:originMatch.object,
      sampleDestinationObject:mapped.find(x=>x.match?.object)?.match?.object||null,
    }
  },{headers:{"cache-control":"private, no-store"}});
}
