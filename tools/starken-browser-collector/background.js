const COLLECTOR_TOKEN="__COLLECTOR_TOKEN__";
const INGEST_URL="https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/chilexpress-starken-browser-ingest";
const STARKEN_URL="https://www.starken.cl/cotizador";
const ALARM_NAME="starken-collector-next";
const BOOTSTRAP_ALARM="starken-collector-bootstrap";

const DESTINATIONS=[
  "Santiago Centro","Rancagua","Valparaíso","Talca","Chillán","Concepción",
  "La Serena","Copiapó","Temuco","Valdivia","Puerto Montt","Antofagasta","Iquique","Arica"
];

const PROFILES=[
  {weightKg:0.5,heightCm:10,widthCm:10,lengthCm:20,weightBand:"0–0,5 kg"},
  {weightKg:1,heightCm:10,widthCm:15,lengthCm:25,weightBand:"0,5–1 kg"},
  {weightKg:3,heightCm:15,widthCm:20,lengthCm:30,weightBand:"1–3 kg"},
  {weightKg:5,heightCm:20,widthCm:30,lengthCm:40,weightBand:"3–6 kg"},
  {weightKg:10,heightCm:25,widthCm:25,lengthCm:60,weightBand:"6–10 kg"}
];

function nextRunDate(){
  const now=new Date();
  const candidates=[];
  for(let offset=0;offset<8;offset++){
    const d=new Date(now);
    d.setDate(now.getDate()+offset);
    d.setHours(9,0,0,0);
    const day=d.getDay();
    if((day===2||day===5)&&d.getTime()>now.getTime()+60_000)candidates.push(d);
  }
  return candidates.sort((a,b)=>a-b)[0]||new Date(now.getTime()+24*60*60*1000);
}

async function scheduleNext(){
  const next=nextRunDate();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME,{when:next.getTime()});
  await chrome.storage.local.set({nextRun:next.toISOString()});
}

function waitTabComplete(tabId,timeoutMs=45000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("starken_page_timeout"));
    },timeoutMs);
    function listener(id,info){
      if(id===tabId&&info.status==="complete"){
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectFromStarkenPage(tabId){
  const [{result}]=await chrome.scripting.executeScript({
    target:{tabId},
    world:"MAIN",
    args:[DESTINATIONS,PROFILES],
    func:async(destinations,profiles)=>{
      const CITY_URL="https://gateway.starken.cl/agency/city";
      const QUOTE_URL="https://gateway.starken.cl/quote/cotizador";

      function normalize(v){
        return String(v||"")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g,"")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g," ")
          .trim();
      }
      function unwrap(payload){
        if(Array.isArray(payload))return payload;
        for(const key of ["data","response","cities","result"]){
          if(Array.isArray(payload?.[key]))return payload[key];
        }
        return [];
      }
      function cityName(city){
        for(const key of ["city","ciudad","name","nombre","label"]){
          if(typeof city?.[key]==="string"&&city[key].trim())return city[key].trim();
        }
        return "";
      }
      function cityCode(city){
        for(const key of ["code_dls","codigo_dls","codigo","id","code","value"]){
          if(city?.[key]!==undefined&&city?.[key]!==null&&String(city[key]).trim())return city[key];
        }
        return null;
      }
      function findCity(cities,requested){
        const target=normalize(requested==="Santiago Centro"?"Santiago":requested);
        return cities.find(c=>normalize(cityName(c))===target)
          ||cities.find(c=>{
            const current=normalize(cityName(c));
            return current.startsWith(target)||target.startsWith(current);
          })
          ||cities.find(c=>normalize(JSON.stringify(c)).includes(target))
          ||null;
      }
      function numeric(value){
        if(typeof value==="number"&&Number.isFinite(value)&&value>0)return value;
        if(typeof value!=="string")return null;
        const cleaned=value.replace(/[^0-9,.-]/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",",".");
        const n=Number(cleaned);
        return Number.isFinite(n)&&n>0?n:null;
      }
      function extractPrice(payload){
        const candidates=[];
        function walk(value,path,depth){
          if(depth>5||value==null)return;
          if(Array.isArray(value)){
            for(let i=0;i<Math.min(value.length,20);i++)walk(value[i],path+"["+i+"]",depth+1);
            return;
          }
          if(typeof value!=="object")return;
          for(const [key,next] of Object.entries(value)){
            const p=path?path+"."+key:key;
            if(/(valor.*flete|flete|tarifa|precio|total)/i.test(key)){
              const n=numeric(next);
              if(n)candidates.push({key:p,value:n});
            }
            if(typeof next==="object"&&next!==null)walk(next,p,depth+1);
          }
        }
        walk(payload,"",0);
        candidates.sort((a,b)=>{
          const score=x=>/valor.*flete/i.test(x)?0:/flete/i.test(x)?1:/tarifa|precio/i.test(x)?2:3;
          return score(a.key)-score(b.key)||a.value-b.value;
        });
        return candidates[0]?.value??null;
      }
      function textField(payload,re){
        let found=null;
        function walk(value,depth){
          if(found||depth>4||value==null||typeof value!=="object")return;
          if(Array.isArray(value)){for(const item of value.slice(0,20))walk(item,depth+1);return;}
          for(const [key,next] of Object.entries(value)){
            if(re.test(key)&&(typeof next==="string"||typeof next==="number")){found=String(next);return;}
            if(typeof next==="object")walk(next,depth+1);
          }
        }
        walk(payload,0);
        return found;
      }

      const cityRes=await fetch(CITY_URL,{headers:{accept:"application/json"},cache:"no-store"});
      const cityText=await cityRes.text();
      let cityPayload=null;
      try{cityPayload=JSON.parse(cityText)}catch{}
      const cities=unwrap(cityPayload);
      if(!cityRes.ok||!cities.length)throw new Error("starken_city_catalog_unavailable");

      const originCity=findCity(cities,"Santiago");
      const originCode=cityCode(originCity);
      if(!originCity||originCode==null)throw new Error("starken_origin_not_resolved");

      const quotes=[];
      for(const destination of destinations){
        const destinationCity=findCity(cities,destination);
        const destinationCode=cityCode(destinationCity);
        if(!destinationCity||destinationCode==null)continue;

        for(const profile of profiles){
          for(const deliveryType of ["DOMICILIO","AGENCIA"]){
            try{
              const response=await fetch(QUOTE_URL,{
                method:"POST",
                headers:{"content-type":"application/json;charset=UTF-8",accept:"application/json"},
                body:JSON.stringify({
                  alto:profile.heightCm,
                  ancho:profile.widthCm,
                  bulto:"PAQUETE",
                  destino:destinationCode,
                  entrega:deliveryType,
                  kilos:profile.weightKg,
                  largo:profile.lengthCm,
                  origen:originCode,
                  servicio:"NORMAL"
                })
              });
              const raw=await response.text();
              let payload=raw.slice(0,3000);
              try{payload=JSON.parse(raw)}catch{}
              const priceClp=response.ok?extractPrice(payload):null;
              if(priceClp){
                quotes.push({
                  origin:"Santiago Centro",
                  destination,
                  weightKg:profile.weightKg,
                  weightBand:profile.weightBand,
                  heightCm:profile.heightCm,
                  widthCm:profile.widthCm,
                  lengthCm:profile.lengthCm,
                  deliveryType,
                  serviceType:textField(payload,/(servicio|service)/i)||"NORMAL",
                  deliveryLabel:textField(payload,/(entrega|delivery)/i)||deliveryType,
                  eta:textField(payload,/(fecha|plazo|dias|eta)/i),
                  originCode,
                  destinationCode,
                  priceClp
                });
              }
            }catch{}
            await new Promise(r=>setTimeout(r,180));
          }
        }
      }
      return {cityCount:cities.length,quotes};
    }
  });
  return result;
}

async function ingest(quotes,trigger){
  const response=await fetch(INGEST_URL,{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-starken-collector-token":COLLECTOR_TOKEN
    },
    body:JSON.stringify({quotes,trigger})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||("ingest_http_"+response.status));
  return data;
}

async function runCollector(trigger="manual"){
  const state=await chrome.storage.local.get(["running"]);
  if(state.running)return {ok:false,error:"already_running"};
  await chrome.storage.local.set({
    running:true,
    status:"running",
    lastError:null,
    startedAt:new Date().toISOString()
  });

  let tabId=null;
  try{
    const tab=await chrome.tabs.create({url:STARKEN_URL,active:false});
    tabId=tab.id;
    if(!tabId)throw new Error("tab_create_failed");
    await waitTabComplete(tabId);
    await new Promise(r=>setTimeout(r,1600));

    const collected=await collectFromStarkenPage(tabId);
    const quotes=Array.isArray(collected?.quotes)?collected.quotes:[];
    const saved=await ingest(quotes,trigger);

    const result={
      ok:true,
      requested:DESTINATIONS.length*PROFILES.length*2,
      collected:quotes.length,
      accepted:Number(saved?.accepted)||0,
      runId:saved?.runId||null,
      finishedAt:new Date().toISOString()
    };
    await chrome.storage.local.set({
      running:false,
      status:"ok",
      lastRun:result.finishedAt,
      lastResult:result,
      lastError:null
    });
    return result;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await chrome.storage.local.set({
      running:false,
      status:"error",
      lastRun:new Date().toISOString(),
      lastError:message
    });
    return {ok:false,error:message};
  }finally{
    if(tabId){
      try{await chrome.tabs.remove(tabId)}catch{}
    }
    await scheduleNext();
  }
}

chrome.runtime.onInstalled.addListener(async()=>{
  await scheduleNext();
  chrome.alarms.create(BOOTSTRAP_ALARM,{delayInMinutes:0.15});
});

chrome.runtime.onStartup.addListener(scheduleNext);

chrome.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name===ALARM_NAME){
    await runCollector("schedule");
    return;
  }
  if(alarm.name===BOOTSTRAP_ALARM){
    await runCollector("manual");
  }
});

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type==="RUN_NOW"){
    runCollector("manual").then(sendResponse);
    return true;
  }
  if(message?.type==="GET_STATUS"){
    chrome.storage.local.get(null).then(sendResponse);
    return true;
  }
});
