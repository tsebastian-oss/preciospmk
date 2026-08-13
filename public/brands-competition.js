fetch('/api/brands?brand=victorinox').then(r=>r.json()).then(d=>{document.getElementById('competition-root').textContent=JSON.stringify(d.competition,null,2)})
