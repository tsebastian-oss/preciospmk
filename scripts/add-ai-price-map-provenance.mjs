import fs from "node:fs";

const appPath = "src/app/AIPriceMap.tsx";
const cssPath = "src/app/AIPriceMap.module.css";
let app = fs.readFileSync(appPath, "utf8");

const helperAnchor = 'const historyDate=(v:string)=>{const d=new Date(v),t=new Date();return d.toDateString()===t.toDateString()?new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit"}).format(d):new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short"}).format(d)};';
const helper = `${helperAnchor}\nconst observedDate=(v?:string|null)=>v?new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";`;
if (!app.includes('const observedDate=')) {
  if (!app.includes(helperAnchor)) throw new Error("AI Price Map date helper anchor not found");
  app = app.replace(helperAnchor, helper);
}

if (!app.includes('priceBasis?:{label?:string')) {
  const typeAnchor = 'type PriceMap={targetBrand:string;';
  const typeReplacement = 'type PriceMap={targetBrand:string;category?:string;measureType?:string;sizeBucket?:number|null;priceBasis?:{label?:string;statistic?:string;referenceUnit?:string;referenceValue?:number|null;packageNormalized?:boolean;sizeNormalized?:boolean};quality?:{level?:string;score?:number;targetSkus?:number;targetRetailers?:number;dispersionPct?:number|null};targetRetailers?:Array<{retailer:string;skus:number;referencePrice:number;q1Price?:number;q3Price?:number;lastObservedAt?:string|null}>;';
  if (!app.includes(typeAnchor)) throw new Error("AI Price Map type anchor not found");
  app = app.replace(typeAnchor, typeReplacement);
}

const oldKpi = '<div><span>Precio equivalente</span><strong>{money(k.averagePrice)}</strong><small>marca objetivo</small></div>';
const newKpi = '<div><span>Precio de referencia</span><strong>{money(k.averagePrice)}</strong><small>{map.priceBasis?.label||"Mediana comparable"}</small></div>';
if (app.includes(oldKpi)) app = app.replace(oldKpi, newKpi);

const qualityAnchor = '    <BubbleMap map={map}/>';
const qualityBlock = '    {map.quality&&<div className={`${styles.qualityBar} ${map.quality.level==="high"?styles.qualityHigh:map.quality.level==="medium"?styles.qualityMedium:styles.qualityLow}`}><div><b>Calidad del análisis: {map.quality.score??"—"}/100</b><span>{map.quality.level==="high"?"Base homogénea y defendible":map.quality.level==="medium"?"Base útil con cautela":"Base heterogénea: no concluyente"}</span></div><div><strong>{map.quality.targetSkus??"—"}</strong><small>SKU objetivo</small></div><div><strong>{map.quality.targetRetailers??"—"}</strong><small>cadenas</small></div>{map.quality.dispersionPct!=null&&<div><strong>{pct(map.quality.dispersionPct)}</strong><small>dispersión</small></div>}</div>}\n    <BubbleMap map={map}/>';
if (!app.includes('Calidad del análisis:')) {
  if (!app.includes(qualityAnchor)) throw new Error("AI Price Map chart anchor not found");
  app = app.replace(qualityAnchor, qualityBlock);
}

const oldTable = '<div className={styles.tableBlock}><div className={styles.tableTitle}><strong>Detalle competitivo</strong><span>Precio equivalente normaliza packs cuando es posible</span></div><div className={styles.tableScroll}><table><thead><tr><th>Marca</th><th>Precio prom.</th><th>Índice</th><th>Cobertura</th><th>Stock</th><th>Promos</th><th>SKU</th></tr></thead><tbody>{map.points.map(p=><tr key={p.brandKey} className={p.isTarget?styles.targetRow:""}><td><b>{p.brand}</b>{p.isTarget&&<em>Objetivo</em>}</td><td>{money(p.averagePrice)}</td><td>{p.priceIndex.toFixed(1)}</td><td>{pct(p.coveragePct)}</td><td>{pct(p.inStockPct)}</td><td>{pct(p.promoPct)}</td><td>{p.skus}</td></tr>)}</tbody></table></div></div>';
const newTable = '<div className={styles.tableBlock}><div className={styles.tableTitle}><strong>Detalle y trazabilidad del análisis</strong><span>{map.priceBasis?.label||"Mediana comparable"} · calidad {map.quality?.score??"—"}/100 · los precios de referencia no sustituyen el precio exacto de un SKU de góndola.</span></div><div className={styles.tableScroll}><table><thead><tr><th>Marca</th><th>Precio ref.</th><th>Índice</th><th>Cobertura</th><th>Stock</th><th>Promos</th><th>SKU</th><th>Último dato</th><th>Muestra usada</th></tr></thead><tbody>{map.points.map(p=><tr key={p.brandKey} className={p.isTarget?styles.targetRow:""}><td><b>{p.brand}</b>{p.isTarget&&<em>Objetivo</em>}</td><td>{money(p.averagePrice)}</td><td>{p.priceIndex.toFixed(1)}</td><td>{pct(p.coveragePct)}</td><td>{pct(p.inStockPct)}</td><td>{pct(p.promoPct)}</td><td>{p.skus}</td><td><small>{observedDate(p.lastObservedAt)}</small></td><td className={styles.sourceSample}><small>{p.sampleProducts?.slice(0,2).join(" · ")||"Productos comparables del universo analizado"}</small></td></tr>)}</tbody></table></div><div className={styles.provenanceNote}><b>Cómo leerlo</b><span>El motor determina primero categoría, formato, tamaño/unidad y calidad de muestra. Luego calcula medianas y normaliza packs/tamaño cuando corresponde. La IA interpreta esos resultados, pero no recalcula precios. Si la muestra es demasiado heterogénea, el sistema debe evitar una conclusión de pricing.</span></div></div>';
if (!app.includes('Detalle y trazabilidad del análisis')) {
  if (!app.includes(oldTable)) throw new Error("AI Price Map competitive table pattern not found");
  app = app.replace(oldTable, newTable);
}
fs.writeFileSync(appPath, app);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* ai-price-map-provenance-v2 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.sourceSample{min-width:220px;max-width:300px}.sourceSample small{display:block;white-space:normal;line-height:1.4;color:#64748b}.provenanceNote{display:flex;gap:10px;align-items:flex-start;margin:12px 0 0;padding:11px 13px;border:1px solid #dbe7f4;border-radius:10px;background:#f8fbff;color:#5f728a;font-size:10px;line-height:1.5}.provenanceNote b{color:#1f3f66;white-space:nowrap}.tableScroll table{min-width:980px}.qualityBar{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:12px 0 2px;padding:12px 14px;border:1px solid #dbe4ef;border-radius:12px;background:#fbfdff}.qualityBar>div:first-child{margin-right:auto;min-width:220px}.qualityBar b,.qualityBar strong{display:block;color:#17365d}.qualityBar span,.qualityBar small{display:block;margin-top:2px;color:#64748b;font-size:10px}.qualityHigh{border-color:#b9e2c7;background:#f7fcf8}.qualityMedium{border-color:#ead7a7;background:#fffdf7}.qualityLow{border-color:#ecc4c4;background:#fff8f8}\n`;
  fs.writeFileSync(cssPath, css);
}
console.log("AI Price Map provenance and quality ready");
