import fs from "node:fs";

const uiPath = "src/app/BrandIntelligenceChat.tsx";
const apiPath = "src/app/api/brand-chat/route.ts";
const cssPath = "src/app/BrandIntelligenceChat.module.css";
let ui = fs.readFileSync(uiPath, "utf8");

const sourceType = `type BrandSource = {
  product?: string;
  category?: string | null;
  supermarkets?: number;
  bestPrice?: number;
  highestPrice?: number;
  averagePrice?: number;
  priceGap?: number;
  savingsPct?: number;
  bestRetailer?: string | null;
  listings?: Array<{ retailer?: string; price?: number; inStock?: boolean }>;
};`;
if (!ui.includes("type BrandSource =")) {
  const summaryStart = ui.indexOf("type BrandSummary = {");
  const summaryEnd = summaryStart >= 0 ? ui.indexOf("\n};", summaryStart) : -1;
  if (summaryStart < 0 || summaryEnd < 0) throw new Error("Brand summary type anchor missing");
  const insertAt = summaryEnd + 3;
  ui = `${ui.slice(0, insertAt)}\n${sourceType}${ui.slice(insertAt)}`;
}

ui = ui.replace(
  '  analysis?: StructuredAnalysis;\n  ai?: boolean;\n};',
  '  analysis?: StructuredAnalysis;\n  sources?: BrandSource[];\n  ai?: boolean;\n};',
);
ui = ui.replace(
  '  data?: { current?: { summary?: BrandSummary } };',
  '  data?: { current?: { summary?: BrandSummary }; priceMatches?: BrandSource[] };',
);
ui = ui.replace(
  '    summary?: BrandSummary | null;\n  } | null;',
  '    summary?: BrandSummary | null;\n    sources?: BrandSource[] | null;\n  } | null;',
);
ui = ui.replace(
  '        summary: message.payload?.summary ?? undefined,\n      }));',
  '        summary: message.payload?.summary ?? undefined,\n        sources: message.payload?.sources ?? undefined,\n      }));',
);
ui = ui.replace(
  '        summary: data.data?.current?.summary,\n      }]);',
  '        summary: data.data?.current?.summary,\n        sources: data.data?.priceMatches ?? [],\n      }]);',
);

const footerAnchor = `    <footer className={styles.executiveFooter}>
      {summary?.lastObservedAt && <span>Datos al {displayDate(summary.lastObservedAt)}</span>}
      {message.ai === false && <span>Respuesta de respaldo</span>}
    </footer>`;
const sourceBlock = `    {message.sources && message.sources.length > 0 && <details className={styles.provenance}>
      <summary>Ver comparables usados en el análisis ({message.sources.length})</summary>
      <div className={styles.provenanceTable}><table><thead><tr><th>Producto comparable</th><th>Mejor retailer</th><th>Mejor precio</th><th>Precio máx.</th><th>Brecha</th><th>Cadenas</th></tr></thead><tbody>{message.sources.slice(0,6).map((source,index) => <tr key={(source.product || "source") + "-" + index}><td><strong>{source.product || "Comparable"}</strong><small>{source.category || ""}</small></td><td>{source.bestRetailer || "—"}</td><td>{money(source.bestPrice)}</td><td>{money(source.highestPrice)}</td><td>{source.savingsPct !== undefined ? Number(source.savingsPct).toFixed(1) + "%" : "—"}</td><td>{source.supermarkets ?? source.listings?.length ?? "—"}</td></tr>)}</tbody></table></div>
      <p>Estos comparables provienen del alcance y período activos. La IA interpreta los datos; los precios y brechas se calculan desde la base monitoreada.</p>
    </details>}
${footerAnchor}`;
if (!ui.includes("Ver comparables usados en el análisis")) {
  if (!ui.includes(footerAnchor)) throw new Error("Brand executive footer anchor missing");
  ui = ui.replace(footerAnchor, sourceBlock);
}
fs.writeFileSync(uiPath, ui);

let api = fs.readFileSync(apiPath, "utf8");
const payloadOld = 'payload: { analysis: data.analysis ?? null, summary: data.data?.current?.summary ?? null, model: data.model ?? null }';
const payloadNew = 'payload: { analysis: data.analysis ?? null, summary: data.data?.current?.summary ?? null, sources: Array.isArray(data.data?.priceMatches) ? data.data.priceMatches.slice(0, 6) : [], model: data.model ?? null }';
if (!api.includes("sources: Array.isArray(data.data?.priceMatches)")) {
  if (!api.includes(payloadOld)) throw new Error("Brand chat payload anchor missing");
  api = api.replace(payloadOld, payloadNew);
  fs.writeFileSync(apiPath, api);
}

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* brand-intelligence-provenance-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.provenance{margin-top:18px;border:1px solid #dde7f2;border-radius:12px;background:#f8fbff;overflow:hidden}.provenance summary{cursor:pointer;padding:12px 14px;font-size:11px;font-weight:850;color:#21466f}.provenanceTable{overflow:auto;border-top:1px solid #e4edf5}.provenanceTable table{width:100%;min-width:680px;border-collapse:collapse;background:#fff}.provenanceTable th,.provenanceTable td{padding:9px 10px;border-bottom:1px solid #edf2f7;text-align:left;font-size:9px}.provenanceTable th{background:#f8fafc;color:#60758d}.provenanceTable td strong,.provenanceTable td small{display:block}.provenanceTable td small{margin-top:3px;color:#8494a7}.provenance>p{margin:0;padding:10px 14px;color:#697d94;font-size:9px;line-height:1.5}\n`;
  fs.writeFileSync(cssPath, css);
}
console.log("Brand Intelligence provenance ready");
