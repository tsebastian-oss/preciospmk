import fs from "node:fs";

const path = "src/app/BrandsVertical.tsx";
let source = fs.readFileSync(path, "utf8");

source = source.replace('const [selectedBrand, setSelectedBrand] = useState("victorinox");','const [selectedBrand, setSelectedBrand] = useState("krispy-kreme");');

const oldEffect = `  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSource("");
    setQuery("");
    fetch(\`/api/brands?brand=\${encodeURIComponent(selectedBrand)}\`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "brands_failed"); return await response.json() as Payload; })
      .then(value => { if (active) setPayload(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar Brands."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedBrand]);`;

const newEffect = `  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setPayload(null);
    setError("");
    setSource("");
    setQuery("");

    const baseEndpoint = selectedBrand === "victorinox"
      ? \`/api/brands-clickhouse-v3?brand=\${encodeURIComponent(selectedBrand)}\`
      : \`/api/brands?brand=\${encodeURIComponent(selectedBrand)}\`;

    fetch(baseEndpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "brands_failed"); return await response.json() as Payload; })
      .then(value => {
        if (!active) return;
        setPayload({ ...value, live: value.live ?? null });
        setLoading(false);

        if (selectedBrand === "victorinox") return;
        fetch(\`/api/brands-live?brand=\${encodeURIComponent(selectedBrand)}\`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
          .then(async response => await response.json() as { live?: LivePulse | null })
          .then(result => { if (active && result.live) setPayload(current => current ? { ...current, live: result.live ?? null } : current); })
          .catch(() => undefined);
      })
      .catch(cause => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "No fue posible cargar Brands.");
        setLoading(false);
      });
    return () => { active = false; controller.abort(); };
  }, [selectedBrand]);`;

if (source.includes(oldEffect)) source = source.replace(oldEffect, newEffect);
else if (!source.includes('const baseEndpoint = selectedBrand === "victorinox"')) throw new Error("Brands loading effect anchor not found");

if (!source.includes('useState("krispy-kreme")')) throw new Error("Krispy Kreme default brand not applied");
if (!source.includes('/api/brands-live?brand=')) throw new Error("Async live Brands endpoint not applied");
if (!source.includes('/api/brands-clickhouse-v3?brand=')) throw new Error("Victorinox ClickHouse fast path not applied");

fs.writeFileSync(path, source);
console.log("Brands fast non-blocking mobile load applied");
