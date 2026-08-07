import { readFileSync, writeFileSync } from "node:fs";
const path="src/app/AIPriceMap.tsx";
let text=readFileSync(path,"utf8");
const bad='opacity={p.isTarget?.95:.78}';
const good='opacity={p.isTarget ? .95 : .78}';
if(text.includes(bad)){text=text.replace(bad,good);writeFileSync(path,text);console.log("AI Price Map JSX corregido");}
else if(text.includes(good))console.log("AI Price Map JSX ya corregido");
else throw new Error("No se encontró la expresión de opacidad esperada");
