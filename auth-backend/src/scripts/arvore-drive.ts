// SÓ LEITURA: imprime a árvore do Drive a partir de uma pasta (ou da raiz configurada).
//
// Existe pra responder "o arquivo caiu na pasta certa?" sem abrir o navegador — e pra conferir a
// árvore inteira depois de mexer em `driveArquivar` (natureza, subpasta por tipo, período).
//
// Uso:
//   node --env-file=.env --import tsx src/scripts/arvore-drive.ts <folderId> [profundidade]
//   node --env-file=.env --import tsx src/scripts/arvore-drive.ts raiz 3
import { listarPasta, rootFolderId, webViewUrl } from "../clients/drive.js"

const arg = process.argv[2] ?? "raiz"
const raiz = arg === "raiz" ? rootFolderId() : arg
const maxNivel = Number(process.argv[3] ?? "4")

const kb = (size?: string): string =>
  size ? ` (${(Number(size) / 1024).toFixed(1)} KB)` : ""

async function andar(id: string, prefixo: string, nivel: number): Promise<void> {
  if (nivel > maxNivel) return
  const itens = await listarPasta(id)
  for (const it of itens) {
    if (it.ehPasta) {
      console.log(`${prefixo}📁 ${it.name}`)
      await andar(it.id, prefixo + "   ", nivel + 1)
    } else {
      console.log(`${prefixo}   ${it.name}${kb(it.size)}`)
    }
  }
}

console.log(`raiz: ${raiz}  ${webViewUrl(raiz)}  (profundidade ${maxNivel})\n`)
await andar(raiz, "", 1)
process.exit(0)
