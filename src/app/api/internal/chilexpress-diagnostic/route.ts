import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const URL = "https://emprendedores.chilexpress.cl/cotizar";

async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function authorized(request:NextRequest){
  const supplied=request.headers.get("x-chilexpress-worker-token")||"";
  if(!supplied)return false;
  const actual=await sha256(supplied);
  if(actual.length!==TOKEN_SHA256.length)return false;
  let diff=0;
  for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^TOKEN_SHA256.charCodeAt(i);
  return diff===0;
}
function chileBrowserEndpoint(value:string){
  const url=new URL(value);
  const username=decodeURIComponent(url.username);
  if(username&&!/-country-[a-z]{2}(?:-|$)/i.test(username))url.username=username+"-country-cl";
  return url.toString();
}

export async function POST(request:NextRequest){
  if(!(await authorized(request)))return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await request.json().catch(()=>({}));
  const browserWs=process.env.BRIGHTDATA_BROWSER_WS?.trim()||String(body?.connectorEndpoint||"").trim();
  if(!browserWs)return NextResponse.json({error:"browser_not_configured"},{status:503});
  const {chromium}=await import("playwright-core");
  const browser=await chromium.connectOverCDP(chileBrowserEndpoint(browserWs),{timeout:15000});
  try{
    const context=browser.contexts()[0]||await browser.newContext({locale:"es-CL",timezoneId:"America/Santiago"});
    const page=context.pages()[0]||await context.newPage();
    const urls:string[]=[];
    page.on("response",(response:any)=>{
      const u=response.url();
      if(/chilexpress|cotiz|tarif|servic|api/i.test(u))urls.push(u);
    });
    await page.goto(URL,{waitUntil:"domcontentloaded",timeout:18000});
    await page.waitForTimeout(2500);
    const inputs=await page.locator("input").evaluateAll(nodes=>nodes.slice(0,30).map((el:any)=>({
      type:el.type,placeholder:el.placeholder,name:el.name,id:el.id,value:el.value,
      parent:String(el.parentElement?.parentElement?.innerText||el.parentElement?.innerText||"").replace(/\s+/g," ").slice(0,220)
    })));
    const selects=await page.locator("select").evaluateAll(nodes=>nodes.slice(0,20).map((el:any)=>({
      name:el.name,id:el.id,value:el.value,
      parent:String(el.parentElement?.parentElement?.innerText||el.parentElement?.innerText||"").replace(/\s+/g," ").slice(0,220),
      options:[...el.options].slice(0,40).map((o:any)=>({text:o.text,value:o.value}))
    })));
    const buttons=await page.locator("button").evaluateAll(nodes=>nodes.slice(0,40).map((el:any)=>String(el.innerText||el.textContent||"").trim()).filter(Boolean));
    const bodyText=await page.locator("body").innerText().catch(()=>"");
    return NextResponse.json({
      ok:true,url:page.url(),title:await page.title(),inputs,selects,buttons,
      responseUrls:[...new Set(urls)].slice(0,80),
      bodyPreview:bodyText.replace(/\s+/g," ").slice(0,5000)
    },{headers:{"cache-control":"private, no-store"}});
  }finally{
    await browser.close();
  }
}
