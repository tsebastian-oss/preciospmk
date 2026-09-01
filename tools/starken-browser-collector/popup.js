const $=id=>document.getElementById(id);
function fmt(iso){
  if(!iso)return"—";
  try{return new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(iso))}catch{return iso}
}
async function refresh(){
  const s=await chrome.runtime.sendMessage({type:"GET_STATUS"});
  const status=s?.running?"running":(s?.status||"idle");
  $("status").textContent=status==="ok"?"OK":status==="running"?"Ejecutando":status==="error"?"Error":"Listo";
  $("status").className=status==="ok"?"ok":status==="error"?"err":status==="running"?"run":"";
  $("last").textContent=fmt(s?.lastRun);
  $("accepted").textContent=s?.lastResult?.accepted??"—";
  $("next").textContent=fmt(s?.nextRun);
  $("run").disabled=Boolean(s?.running);
  $("run").textContent=s?.running?"Ejecutando…":"Ejecutar ahora";
}
$("run").addEventListener("click",async()=>{
  $("run").disabled=true;
  $("run").textContent="Ejecutando…";
  await chrome.runtime.sendMessage({type:"RUN_NOW"});
  await refresh();
});
refresh();
setInterval(refresh,2000);