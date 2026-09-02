import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const QUOTER_URL = "https://emprendedores.chilexpress.cl/cotizar";
const DEFAULT_DESTINATIONS = [
  "Santiago Centro","Rancagua","Valparaíso","Talca","Chillán","Concepción","La Serena",
  "Copiapó","Temuco","Valdivia","Puerto Montt","Antofagasta","Iquique","Arica",
];

function normalize(value:string){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
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
  let diff=0; for(let i=0;i<actual.length;i++) diff|=actual.charCodeAt(i)^TOKEN_SHA256.charCodeAt(i);
  return diff===0;
}
function chileBrowserEndpoint(value:string){
  const url=new URL(value);
  const username=decodeURIComponent(url.username);
  if(username&&!/-country-[a-z]{2}(?:-|$)/i.test(username)) url.username=username+"-country-cl";
  return url.toString();
}
function parsePrice(raw:string){
  const n=Number(String(raw||"").replace(/[^0-9]/g,""));
  return Number.isFinite(n)&&n>500?n:null;
}
function parseServices(body:string){
  const text=body.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
  const out:Record<string,number>={};
  for(const [label,key] of [["BASICO","Básico"],["ESTANDAR","Estándar"],["PRIORITARIO","Prioritario"]] as const){
    const match=text.match(new RegExp(label+"[\\s\\S]{0,220}?\\$\\s*([0-9.]{3,})","i"));
    const price=match?parsePrice(match[1]):null;
    if(price) out[key]=price;
  }
  return out;
}

export async function POST(request:NextRequest){
  if(!(await authorized(request))) return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>({}));
  const browserWs=process.env.BRIGHTDATA_BROWSER_WS?.trim()||String(body?.connectorEndpoint||"").trim();
  if(!browserWs) return NextResponse.json({error:"browser_not_configured"},{status:503});
  const destinations=Array.isArray(body?.destinations)&&body.destinations.length?body.destinations.map(String):DEFAULT_DESTINATIONS;
  const {chromium}=await import("playwright-core");
  const browser=await chromium.connectOverCDP(chileBrowserEndpoint(browserWs),{timeout:15000});

  try{
    const context=browser.contexts()[0]||await browser.newContext({locale:"es-CL",timezoneId:"America/Santiago"});
    const page=context.pages()[0]||await context.newPage();
    await page.goto(QUOTER_URL,{waitUntil:"domcontentloaded",timeout:18000});
    await page.waitForTimeout(1200);

    async function selectCity(kind:"origin"|"destination",value:string){
      const locator=kind==="origin"
        ? page.locator('input[placeholder="Origen"]:visible').first()
        : page.locator('input[placeholder="Destino"]:visible').first();
      if(!(await locator.count())) throw new Error(kind+"_input_missing");
      await locator.click({force:true});
      await locator.fill(value);
      await page.waitForTimeout(500);
      const options=page.locator("mat-option:visible, [role=option]:visible");
      const count=await options.count();
      const target=normalize(value);
      let chosen=-1;
      for(let i=0;i<count;i++){
        const t=normalize(await options.nth(i).innerText().catch(()=>""));
        if(t===target){chosen=i;break;}
      }
      if(chosen<0){
        for(let i=0;i<count;i++){
          const t=normalize(await options.nth(i).innerText().catch(()=>""));
          if(t.startsWith(target)||target.startsWith(t)){chosen=i;break;}
        }
      }
      if(chosen<0) throw new Error(kind+"_option_missing:"+value);
      await options.nth(chosen).click({force:true,timeout:4000});
      await page.waitForTimeout(150);
      const selected=normalize(await locator.inputValue().catch(()=>""));
      if(!(selected===target||selected.startsWith(target)||target.startsWith(selected))) throw new Error(kind+"_selection_mismatch:"+selected);
    }

    async function clickText(text:string){
      const items=page.getByText(text,{exact:true});
      for(let i=0;i<await items.count();i++){
        const item=items.nth(i);
        if(await item.isVisible().catch(()=>false)){await item.click({force:true}).catch(()=>undefined);return true;}
      }
      return false;
    }

    async function ensureParcel(){
      await clickText("Encomienda");
      await clickText("Nacional");
      const article=page.locator('select[formcontrolname="typeProtectedShipping"]:visible').first();
      if(await article.count()) await article.selectOption("5").catch(()=>undefined);
      const amount=page.locator("#amount:visible").first();
      if(await amount.count()) await amount.fill("20000",{timeout:3000}).catch(()=>undefined);
      await clickText("Medidas personalizadas");
      const fields=[
        [page.locator("#caja-alto:visible").first(),"10"],
        [page.locator("#caja-ancho:visible").first(),"10"],
        [page.locator("#caja-largo:visible").first(),"20"],
        [page.locator('input[formcontrolname="weight"]:visible').first(),"0.5"],
      ] as const;
      for(const [field,value] of fields){
        if(await field.count()) await field.fill(value,{timeout:3000}).catch(()=>undefined);
      }
      await page.keyboard.press("Tab").catch(()=>undefined);
    }

    await selectCity("origin","Santiago Centro");
    await ensureParcel();

    const results:any[]=[];
    for(const destination of destinations){
      try{
        await selectCity("destination",destination);
        await ensureParcel();

        let prices:Record<string,number>={};
        let preview="";
        for(let attempt=0;attempt<4;attempt++){
          await page.waitForTimeout(attempt===0?900:550);
          const bodyText=await page.locator("body").innerText().catch(()=>"");
          preview=bodyText.replace(/\s+/g," ").slice(-1800);
          prices=parseServices(bodyText);
          if(prices["Básico"]&&prices["Estándar"]&&prices["Prioritario"]) break;
          const weight=page.locator('input[formcontrolname="weight"]:visible').first();
          if(await weight.count()){
            await weight.fill("0.5").catch(()=>undefined);
            await weight.press("Tab").catch(()=>undefined);
          }
        }
        results.push({destination,ok:Object.keys(prices).length>=2,prices,bodyPreview:preview});
      }catch(error){
        results.push({destination,ok:false,prices:{},error:error instanceof Error?error.message:String(error)});
      }
    }

    return NextResponse.json({
      ok:true,
      origin:"Santiago Centro",
      weightKg:0.5,
      dimensions:{heightCm:10,widthCm:10,lengthCm:20},
      declaredValueClp:20000,
      observedAt:new Date().toISOString(),
      sourceUrl:QUOTER_URL,
      results,
    },{headers:{"cache-control":"private, no-store"}});
  }finally{
    await browser.close();
  }
}
