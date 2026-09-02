import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const QUOTER_URL = "https://emprendedores.chilexpress.cl/cotizar";
const QUOTE_BASE = "https://services.wschilexpress.com/agendadigital/api/v5/Cotizador/GetCotizadorNacional";
const DESTINATIONS = ["Santiago Centro","Rancagua","Valparaíso","Talca","Chillán","Concepción","La Serena","Copiapó","Temuco","Valdivia","Puerto Montt","Antofagasta","Iquique","Arica"];

type ServiceRow = {
  service:string;
  serviceCode:number|null;
  value:number|null;
  normalValue:number|null;
  eolValue:number|null;
  deliveryText:string|null;
  deliveryDate:string|null;
  weightCalc:number|null;
};

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
  if(depth>7||value==null)return;
  if(Array.isArray(value)){for(const item of value.slice(0,6000))collectObjects(item,out,depth+1);return;}
  if(typeof value!=="object")return;
  const obj=value as Record<string,unknown>;out.push(obj);
  for(const next of Object.values(obj))if(next&&typeof next==="object")collectObjects(next,out,depth+1);
}
function cityCode(payload:unknown,city:string){
  const objects:Record<string,unknown>[]=[];collectObjects(payload,objects);
  const target=normalize(city);
  const candidates=objects.filter(obj=>Object.values(obj).some(v=>typeof v==="string"&&normalize(v)===target));
  for(const obj of candidates){
    const entries=Object.entries(obj);
    const preferred=entries.find(([k,v])=>typeof v==="string"&&/county.*code|city.*code|coverage.*code|cod.*comuna|codigo.*comuna|cod.*cobertura/i.test(k)&&String(v).length<=12);
    if(preferred)return {code:String(preferred[1]),object:obj};
    const fallback=entries.find(([k,v])=>typeof v==="string"&&/code|cod/i.test(k)&&String(v).length<=8&&normalize(String(v))!==target);
    if(fallback)return {code:String(fallback[1]),object:obj};
  }
  return null;
}
function extractQuote(payload:any):ServiceRow[]{
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
  })).filter((x:ServiceRow)=>/BÁSICO|BASICO|ESTÁNDAR|ESTANDAR|PRIORITARIO/i.test(x.service));
}

export async function POST(request:NextRequest){
  if(!(await authorized(request)))return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>({}));
  const browserWs=process.env.BRIGHTDATA_BROWSER_WS?.trim()||String(body?.connectorEndpoint||"").trim();
  if(!browserWs)return NextResponse.json({error:"browser_not_configured"},{status:503});
  const requested:string[]=Array.isArray(body?.destinations)&&body.destinations.length
    ? body.destinations.map((v:unknown)=>String(v)).filter((v:string)=>DESTINATIONS.includes(v))
    : DESTINATIONS;
  const anchor=String(body?.anchor||"Rancagua");

  const {chromium}=await import("playwright-core");
  let browser:any=null;
  try{
    browser=await chromium.connectOverCDP(chileBrowserEndpoint(browserWs),{timeout:15000});
  }catch(error){
    return NextResponse.json({error:"browser_connect_failed",detail:error instanceof Error?error.message:String(error)},{status:502});
  }

  let coverage:unknown=null;
  let quoteRequest:{url:string;headers:Record<string,string>}|null=null;
  let anchorBody="";
  try{
    console.log("[cx-bulk] connected");
    const context=browser.contexts()[0]||await browser.newContext({locale:"es-CL",timezoneId:"America/Santiago"});
    const page=context.pages()[0]||await context.newPage();

    page.on("response",async(response:any)=>{
      try{
        const url=String(response.url()||"");
        const req=response.request();
        if(/coverage-areas\?type=0&regionCode=99/i.test(url)){
          const ct=String(response.headers()?.["content-type"]||"");
          if(ct.includes("json")){
            const payload=await response.json().catch(()=>null);
            if(payload)coverage=payload;
          }
        }
        if(/GetCotizadorNacional/i.test(url)){
          quoteRequest={url,headers:await req.allHeaders().catch(()=>({}))};
        }
      }catch{}
    });

    await page.goto(QUOTER_URL,{waitUntil:"commit",timeout:10000}).catch(()=>null);
    console.log("[cx-bulk] committed");
    await page.locator('input[placeholder="Origen"]:visible').first().waitFor({state:"visible",timeout:12000});
    console.log("[cx-bulk] form-ready");
    await page.waitForTimeout(350);

    async function exactCity(kind:"origin"|"destination",value:string){
      const input=kind==="origin"
        ? page.locator('input[placeholder="Origen"]:visible').first()
        : page.locator('input[placeholder="Destino"]:visible').first();
      if(!(await input.count()))throw new Error(kind+"_input_missing");
      await input.click({force:true});
      await input.fill(value);
      await page.waitForTimeout(450);
      const options=page.locator("mat-option:visible, [role=option]:visible");
      const count=await options.count();
      const target=normalize(value);
      let index=-1;
      for(let i=0;i<count;i++){
        const t=normalize(await options.nth(i).innerText().catch(()=>""));
        if(t===target){index=i;break;}
      }
      if(index<0){
        for(let i=0;i<count;i++){
          const t=normalize(await options.nth(i).innerText().catch(()=>""));
          if(t.startsWith(target)||target.startsWith(t)){index=i;break;}
        }
      }
      if(index<0)throw new Error(kind+"_option_missing:"+value);
      await options.nth(index).click({force:true,timeout:5000});
      await page.waitForTimeout(100);
      const selected=normalize(await input.inputValue().catch(()=>""));
      if(!(selected===target||selected.startsWith(target)||target.startsWith(selected))){
        throw new Error(kind+"_selection_mismatch:"+selected+"!="+target);
      }
    }

    async function clickExact(text:string){
      const items=page.getByText(text,{exact:true});
      for(let i=0;i<await items.count();i++){
        const item=items.nth(i);
        if(await item.isVisible().catch(()=>false)){
          await item.click({force:true,timeout:4000}).catch(()=>undefined);
          return;
        }
      }
    }
    async function forceValue(locator:any,value:string){
      if(!(await locator.count().catch(()=>0)))return;
      await locator.evaluate((el:HTMLInputElement,next:string)=>{
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
        setter?.call(el,next);
        el.dispatchEvent(new Event("input",{bubbles:true}));
        el.dispatchEvent(new Event("change",{bubbles:true}));
        el.blur();
      },value).catch(()=>undefined);
    }

    await exactCity("origin","Santiago Centro");
    console.log("[cx-bulk] origin-selected");
    await exactCity("destination",anchor);
    console.log("[cx-bulk] destination-selected",anchor);
    await clickExact("Encomienda");
    await clickExact("Nacional");

    const article=page.locator('select[formcontrolname="typeProtectedShipping"]:visible').first();
    if(await article.count())await article.selectOption("5").catch(()=>undefined);
    const declared=page.locator("#amount:visible").first();
    if(await declared.count())await declared.fill("20000").catch(()=>undefined);
    await clickExact("Medidas personalizadas");

    const height=page.locator("#caja-alto:visible").first();
    const width=page.locator("#caja-ancho:visible").first();
    const length=page.locator("#caja-largo:visible").first();
    const weight=page.locator('input[formcontrolname="weight"]:visible').first();

    for(const [field,value] of [[height,"10"],[width,"10"],[length,"20"],[weight,"0.5"]] as const){
      if(await field.count())await field.fill(value).catch(()=>undefined);
    }

    for(let attempt=0;attempt<3&&!quoteRequest;attempt++){
      await forceValue(height,"10");
      await forceValue(width,"10");
      await forceValue(length,"20");
      await forceValue(weight,"0.5");
      await forceValue(declared,"20000");
      await page.keyboard.press("Tab").catch(()=>undefined);
      await page.waitForTimeout(attempt===0?1200:650);
    }

    console.log("[cx-bulk] quote-request",!!quoteRequest,"coverage",!!coverage);
    anchorBody=(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ").slice(-1800);
    if(!coverage){
      for(let i=0;i<12&&!coverage;i++)await page.waitForTimeout(250);
    }
  }finally{
    await Promise.race([
      browser.close().catch(()=>undefined),
      new Promise(resolve=>setTimeout(resolve,1200)),
    ]);
    console.log("[cx-bulk] browser-close-finished");
  }

  const capturedQuote=quoteRequest as {url:string;headers:Record<string,string>}|null;
  if(!capturedQuote)return NextResponse.json({error:"anchor_quote_not_captured",anchor,bodyPreview:anchorBody},{status:502});
  if(!coverage)return NextResponse.json({error:"coverage_not_captured",anchor},{status:502});

  const anchorUrl=new URL(capturedQuote.url);
  const originCode=anchorUrl.searchParams.get("CIUDAD_ORIGEN");
  if(!originCode)return NextResponse.json({error:"origin_code_missing_from_anchor"},{status:502});

  const headers:Record<string,string>={};
  for(const key of ["ocp-apim-subscription-key","x-api-key","authorization","accept","origin","referer","user-agent"]){
    const value=capturedQuote.headers[key];if(value)headers[key]=value;
  }

  console.log("[cx-bulk] direct-stage",originCode,requested.length);
  const mapped=requested.map(destination=>({destination,match:cityCode(coverage,destination)}));
  const results:any[]=[];
  const quotable=mapped.filter(item=>item.match?.code);
  for(let i=0;i<quotable.length;i+=5){
    const batch=quotable.slice(i,i+5);
    const rows=await Promise.all(batch.map(async item=>{
      const url=new URL(QUOTE_BASE);
      url.searchParams.set("CIUDAD_ORIGEN",originCode);
      url.searchParams.set("CIUDAD_DESTINO",item.match!.code);
      url.searchParams.set("CANAL_ORIGEN",anchorUrl.searchParams.get("CANAL_ORIGEN")||"18");
      url.searchParams.set("COD_PRODUCTO",anchorUrl.searchParams.get("COD_PRODUCTO")||"3");
      url.searchParams.set("PESO","0.5");
      url.searchParams.set("ALTO","10");
      url.searchParams.set("ANCHO","10");
      url.searchParams.set("LARGO","20");
      url.searchParams.set("VALOR_DECLARADO","20000");
      url.searchParams.set("iNDTARIFAGENERICA","0");
      url.searchParams.set("COD_TCC_CLIENTE",anchorUrl.searchParams.get("COD_TCC_CLIENTE")||"18911542");
      try{
        const response=await fetch(url.toString(),{headers,signal:AbortSignal.timeout(6000)});
        const payload=await response.json().catch(()=>null);
        return {destination:item.destination,destinationCode:item.match!.code,ok:response.ok&&!!payload,status:response.status,services:payload?extractQuote(payload):[]};
      }catch(error){
        return {destination:item.destination,destinationCode:item.match!.code,ok:false,status:null,services:[],error:error instanceof Error?error.message:String(error)};
      }
    }));
    results.push(...rows);
    console.log("[cx-bulk] direct-batch",i,rows.map((row:any)=>({d:row.destination,ok:row.ok,n:row.services?.length||0})));
  }
  for(const item of mapped.filter(x=>!x.match?.code))results.push({destination:item.destination,destinationCode:null,ok:false,status:null,services:[],error:"destination_code_missing"});

  return NextResponse.json({
    ok:true,
    sourceUrl:QUOTER_URL,
    observedAt:new Date().toISOString(),
    origin:"Santiago Centro",
    originCode,
    anchor,
    weightKg:0.5,
    dimensions:{heightCm:10,widthCm:10,lengthCm:20},
    declaredValueClp:20000,
    results,
    diagnostics:{
      mappedDestinations:quotable.length,
      requestedDestinations:requested.length,
      headerNames:Object.keys(headers),
      anchorRequest:anchorUrl.toString().replace(/COD_TCC_CLIENTE=[^&]+/i,"COD_TCC_CLIENTE=***"),
      anchorBodyPreview:anchorBody,
    }
  },{headers:{"cache-control":"private, no-store"}});
}
