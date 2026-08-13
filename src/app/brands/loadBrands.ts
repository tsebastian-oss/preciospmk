export async function loadBrands(){const r=await fetch('/api/brands?brand=victorinox');return r.json();}
