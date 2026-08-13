import fs from "node:fs";

const file = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Brands patch failed: ${label}`);
  source = source.replace(from, to);
}

if (!source.includes('import BrandsVertical from "./BrandsVertical";')) {
  const anchor = 'import AutomotiveIntelligence from "./AutomotiveIntelligence";';
  if (source.includes(anchor)) source = source.replace(anchor, `${anchor}\nimport BrandsVertical from "./BrandsVertical";`);
  else {
    const importAnchor = 'import';
    const firstNl = source.indexOf("\n");
    if (firstNl < 0 || !source.startsWith(importAnchor)) throw new Error("Brands patch failed: import anchor");
    source = `${source.slice(0, firstNl + 1)}import BrandsVertical from \"./BrandsVertical\";\n${source.slice(firstNl + 1)}`;
  }
}

if (!source.includes('| "brands"')) {
  if (source.includes('| "automotive"')) source = source.replace('| "automotive"', '| "automotive"\n  | "brands"');
  else throw new Error("Brands patch failed: View type");
}

if (!source.includes('label: "Brands"')) {
  const automotiveGroup = /\{\s*label:\s*"Automotriz",\s*items:\s*\[\{\s*view:\s*"automotive"[^\]]*\]\s*\},?/m;
  const match = source.match(automotiveGroup);
  if (!match) throw new Error("Brands patch failed: navigation group");
  source = source.replace(match[0], `${match[0]}\n  { label: "Brands", items: [{ view: "brands", label: "Marcas", icon: "◆" }] },`);
}

if (!source.includes('brands: {')) {
  const copyAnchor = 'automotive: {';
  const idx = source.indexOf(copyAnchor);
  if (idx < 0) throw new Error("Brands patch failed: copy anchor");
  const next = source.indexOf("\n  },", idx);
  if (next < 0) throw new Error("Brands patch failed: copy block");
  const insertAt = next + 5;
  const block = '\n  brands: { eyebrow: "Brands", title: "Brand & Retail Intelligence", description: "Descubre dónde se vende una marca, monitorea su catálogo, precios, sellers y presencia digital." },';
  source = source.slice(0, insertAt) + block + source.slice(insertAt);
}

for (const setName of ["LAZY_VIEWS", "DARK_VIEWS"]) {
  const rx = new RegExp(`const ${setName} = new Set<View>\\(\\[([^\\]]*)\\]\\)`);
  const match = source.match(rx);
  if (match && !match[1].includes('"brands"')) source = source.replace(match[0], match[0].replace("])", ', "brands"])'));
}

if (!source.includes('view === "brands" ? <BrandsVertical')) {
  const automotiveRender = 'view === "automotive" ? <AutomotiveIntelligence /> :';
  if (source.includes(automotiveRender)) source = source.replace(automotiveRender, `${automotiveRender}\n                  view === "brands" ? <BrandsVertical /> :`);
  else {
    const fallback = '<AutomotiveIntelligence />';
    const idx = source.lastIndexOf(fallback);
    if (idx < 0) throw new Error("Brands patch failed: render anchor");
    const end = idx + fallback.length;
    source = source.slice(0,end) + ' :\n                  view === "brands" ? <BrandsVertical />' + source.slice(end);
  }
}

fs.writeFileSync(file, source);
console.log("Brands vertical applied");
