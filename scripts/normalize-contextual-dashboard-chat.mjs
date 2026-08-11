import fs from "node:fs";

const path = "src/lib/openai-intelligence.ts";
const property = "dashboardContext: dashboardContextFromSignals(dashboardSignals, filters),";
const lines = fs.readFileSync(path, "utf8").split("\n");
const output = [];
for (const line of lines) {
  if (line.trim() === property && output.at(-1)?.trim() === property) continue;
  output.push(line);
}
fs.writeFileSync(path, output.join("\n"));
console.log("Contextual dashboard generated code normalized");
