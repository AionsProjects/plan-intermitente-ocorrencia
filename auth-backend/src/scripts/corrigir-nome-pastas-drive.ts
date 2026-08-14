// Tira espaço/duplicidade do NOME de pastas do Drive: `INTERMITENTE - MENSAL ` -> `INTERMITENTE - MENSAL`.
//
// Por que importa: `ensureFolder` acha a pasta por nome EXATO, e o nosso `sanitizeName` faz trim.
// Numa pasta criada pelo n8n com espaço no fim, o código não acha e CRIA UMA SEGUNDA — os
// arquivos do mês racham entre as duas e ninguém percebe.
//
// Renomear (e não recriar) preserva id, url e o conteúdo: os links já gravados no Monday e no
// snapshot do pré-pagamento continuam valendo.
//
// Anda a árvore a partir da raiz configurada. Dry-run por padrão; grava com --aplicar.
//   node --env-file=.env --import tsx src/scripts/corrigir-nome-pastas-drive.ts [--aplicar] [profundidade]
import { findFolder, listarPasta, renomearPasta, rootFolderId, sanitizeName } from "../clients/drive.js"

const aplicar = process.argv.includes("--aplicar")
const maxNivel = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? "6")

interface Alvo {
  id: string
  de: string
  para: string
  paiId: string
  caminho: string
  /** Já existe irmã com o nome limpo — renomear criaria colisão. */
  colide: boolean
}

const alvos: Alvo[] = []
let pastas = 0

async function andar(id: string, caminho: string, nivel: number): Promise<void> {
  if (nivel > maxNivel) return
  const itens = await listarPasta(id)
  for (const it of itens) {
    if (!it.ehPasta) continue
    pastas++
    const limpo = sanitizeName(it.name)
    if (limpo !== it.name && limpo) {
      // Colisão: a irmã com o nome certo já existe. Renomear deixaria duas com o mesmo nome —
      // aí o certo é MOVER o conteúdo, decisão que não cabe a um script de nome.
      const irma = await findFolder(id, limpo)
      alvos.push({
        id: it.id,
        de: it.name,
        para: limpo,
        paiId: id,
        caminho: `${caminho}/${it.name}`,
        colide: !!irma && irma.id !== it.id,
      })
    }
    await andar(it.id, `${caminho}/${it.name}`, nivel + 1)
  }
}

const raiz = rootFolderId()
console.log(`raiz ${raiz} · profundidade ${maxNivel} · modo ${aplicar ? "APLICAR" : "dry-run"}\n`)
await andar(raiz, "", 1)

const limpos = alvos.filter((a) => !a.colide)
const colidem = alvos.filter((a) => a.colide)

console.log(`pastas visitadas: ${pastas}`)
console.log(`a renomear: ${limpos.length}`)
for (const a of limpos) console.log(` ${JSON.stringify(a.de)} -> ${JSON.stringify(a.para)}   ${a.caminho}`)
if (colidem.length) {
  console.log(`\n⚠ ${colidem.length} com IRMÃ de mesmo nome já existente — NÃO renomeio (viraria duplicata):`)
  for (const a of colidem) console.log(` ${JSON.stringify(a.de)}   ${a.caminho}`)
  console.log(" Nesses casos o conteúdo precisa ser MOVIDO pra irmã, não renomeado.")
}

if (!aplicar) {
  console.log("\ndry-run: nada gravado. Rode com --aplicar.")
  process.exit(0)
}

let ok = 0
for (const a of limpos) {
  // `renomearPasta` lança em erro (não devolve false) — uma falha não pode parar o resto.
  try {
    await renomearPasta(a.id, a.para)
    ok++
  } catch (e) {
    console.error(` FALHOU ${a.id} ${a.caminho}: ${(e as Error).message}`)
  }
}
console.log(`\nrenomeadas: ${ok}/${limpos.length}`)
process.exit(0)
