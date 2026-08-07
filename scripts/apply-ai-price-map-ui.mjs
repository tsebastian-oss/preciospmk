import { readFileSync, writeFileSync } from "node:fs";

const path="src/app/UnifiedPlatformApp.tsx";
let text=readFileSync(path,"utf8");
let changed=false;

function replaceOnce(label,oldValue,newValue){
  if(text.includes(newValue))return;
  if(!text.includes(oldValue))throw new Error(`No se encontró el bloque esperado: ${label}`);
  text=text.replace(oldValue,newValue);changed=true;
}

replaceOnce(
  "AIPriceMap import",
  'import BrandIntelligenceChat from "./BrandIntelligenceChat";',
  'import BrandIntelligenceChat from "./BrandIntelligenceChat";\nimport AIPriceMap from "./AIPriceMap";',
);

if(text.includes(' | "optimizer"')){text=text.replace(' | "optimizer"',' | "price-map"');changed=true;}

replaceOnce(
  "AI Price Map menu",
  '{ view: "optimizer", label: "AI Price Optimizer", icon: "↗" },',
  '{ view: "price-map", label: "AI Price Map", icon: "◎" },',
);

replaceOnce(
  "AI Price Map copy",
  '  optimizer: { title: "AI Price Optimizer", description: "Simula precios para equilibrar volumen, ingresos y margen." },',
  '  "price-map": { title: "AI Price Map", description: "Conversa con la IA y construye mapas competitivos de precio, cobertura, stock y surtido." },',
);

const optimizerState='  const [optimizer, setOptimizer] = useState({ price: 0, cost: 0, units: 100, elasticity: -1.2, margin: 20 });\n';
if(text.includes(optimizerState)){text=text.replace(optimizerState,'');changed=true;}

const optimizerEffect=`  useEffect(() => {
    if (!selectedMatch || optimizer.price !== 0) return;
    const reference = numeric(selectedMatch.average_price);
    setOptimizer((current) => ({ ...current, price: reference, cost: reference * .65 }));
  }, [selectedMatch?.match_key, optimizer.price]);

`;
if(text.includes(optimizerEffect)){text=text.replace(optimizerEffect,'');changed=true;}

if(!text.includes('if (view === "price-map") return <AIPriceMap filters={filters}/>;')){
  const start=text.indexOf('    if (view === "optimizer") {');
  if(start<0)throw new Error('No se encontró el renderer de AI Price Optimizer');
  const next=text.indexOf('\n    if (view === "',start+10);
  const fallback=text.indexOf('\n    return <section',start+10);
  const end=next>start?next:fallback;
  if(end<0)throw new Error('No se encontró el final del renderer de AI Price Optimizer');
  text=text.slice(0,start)+'    if (view === "price-map") return <AIPriceMap filters={filters}/>;\n'+text.slice(end);
  changed=true;
}

if(text.includes('AI Price Optimizer')||text.includes('view === "optimizer"')||text.includes('setOptimizer(')||text.includes('optimizer.price')){
  throw new Error('Quedaron referencias activas al AI Price Optimizer legacy');
}

if(changed)writeFileSync(path,text);
console.log(changed?'AI Price Map aplicado':'AI Price Map ya aplicado');
