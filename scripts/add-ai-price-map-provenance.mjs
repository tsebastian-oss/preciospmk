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

const oldTable = '<div className={styles.tableBlock}><div className={styles.tableTitle}><strong>Detalle competitivo</strong><span>Precio equivalente normaliza packs cuando es posible</span></div><div className={styles.tableScroll}><table><thead><tr><th>Marca</th><th>Precio prom.</th><th>Índice</th><th>Cobertura</th><th>Stock</th><th>Promos</th><th>SKU</th></tr></thead><tbody>{map.points.map(p=><tr key={p.brandKey} className={p.isTarget?styles.targetRow:""}><td><b>{p.brand}</b>{p.isTarget&&<em>Objetivo</em>}</td><td>{money(p.averagePrice)}</td><td>{p.priceIndex.toFixed(1)}</td><td>{pct(p.coveragePct)}</td><td>{pct(p.inStockPct)}</td><td>{pct(p.promoPct)}</td><td>{p.skus}</td></tr>)}</tbody></table></div></div>';
const newTable = '<div className={styles.tableBlock}><div className={styles.tableTitle}><strong>Detalle y trazabilidad del análisis</strong><span>Los valores provienen de productos observados en el alcance actual; la IA selecciona y explica los comparables.</span></div><div className={styles.tableScroll}><table><thead><tr><th>Marca</th><th>Precio prom.</th><th>Índice</th><th>Cobertura</th><th>Stock</th><th>Promos</th><th>SKU</th><th>Último dato</th><th>Muestra usada</th></tr></thead><tbody>{map.points.map(p=><tr key={p.brandKey} className={p.isTarget?styles.targetRow:""}><td><b>{p.brand}</b>{p.isTarget&&<em>Objetivo</em>}</td><td>{money(p.averagePrice)}</td><td>{p.priceIndex.toFixed(1)}</td><td>{pct(p.coveragePct)}</td><td>{pct(p.inStockPct)}</td><td>{pct(p.promoPct)}</td><td>{p.skus}</td><td><small>{observedDate(p.lastObservedAt)}</small></td><td className={styles.sourceSample}><small>{p.sampleProducts?.slice(0,2).join(" · ")||"Productos comparables del universo analizado"}</small></td></tr>)}</tbody></table></div><div className={styles.provenanceNote}><b>Cómo leerlo</b><span>Precio, cobertura, stock, promociones y cantidad de SKU se calculan desde la base monitoreada. La IA interviene en la interpretación de la consulta, selección de competidores y explicación; valida decisiones críticas contra el detalle disponible.</span></div></div>';
if (!app.includes('Detalle y trazabilidad del análisis')) {
  if (!app.includes(oldTable)) throw new Error("AI Price Map competitive table pattern not found");
  app = app.replace(oldTable, newTable);
}
fs.writeFileSync(appPath, app);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* ai-price-map-provenance-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.sourceSample{min-width:220px;max-width:300px}.sourceSample small{display:block;white-space:normal;line-height:1.4;color:#64748b}.provenanceNote{display:flex;gap:10px;align-items:flex-start;margin:12px 0 0;padding:11px 13px;border:1px solid #dbe7f4;border-radius:10px;background:#f8fbff;color:#5f728a;font-size:10px;line-height:1.5}.provenanceNote b{color:#1f3f66;white-space:nowrap}.tableScroll table{min-width:980px}\n`;
  fs.writeFileSync(cssPath, css);
}
console.log("AI Price Map provenance ready");
