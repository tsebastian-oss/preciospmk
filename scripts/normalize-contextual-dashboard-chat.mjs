import fs from "node:fs";

const path = "src/lib/openai-intelligence.ts";
let source = fs.readFileSync(path, "utf8");
const property = "dashboardContext: dashboardContextFromSignals(dashboardSignals, filters),";
const duplicate = new RegExp(`(^[ \\t]*)${property.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n[ \\t]*${property.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\n`, "gm");
source = source.replace(duplicate, (_match, indent) => `${indent}${property}\n`);
fs.writeFileSync(path, source);
console.log("Contextual dashboard generated code normalized");
