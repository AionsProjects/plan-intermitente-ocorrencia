const K=process.env.N8N_KEY,BASE="https://aionscorp-n8n.cloudfy.live/api/v1",h={"X-N8N-API-KEY":K,"Accept":"application/json"}
for(const [nm,id] of [["PREVIEW","7gHmbLcZ5r6D5sXz"],["APLICAR","XybrfnzI11Fw5sX4"]]){
  const full=await (await fetch(`${BASE}/workflows/${id}`,{headers:h})).json()
  for(const n of full.nodes){const c=n.parameters?.jsCode||"";if(c.includes("unidadeResolvida"))console.log(`${nm} "${n.name}": AINDA tem unidadeResolvida (orfao!)`)}
}
console.log("check orfaos done")
