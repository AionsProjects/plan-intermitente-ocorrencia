// Mostra a árvore do Drive da(s) última(s) convocação(ões) — pra conferir que as TRÊS pastas
// (CAJU, CONFERENCIA, OUTROS) nasceram junto com a pasta da pessoa.
//
// A credencial do Drive só existe na Vercel, então a leitura vai pela rota `/api/drive/arvore`
// (admin/DP, read-only). A sessão é CURTA, criada na identidade de SERVIÇO `n8n@internal.local` —
// nunca na de uma pessoa, pra o rastro não dizer que alguém fez isso — e revogada no fim.
//
//   node --env-file=.env --import tsx src/scripts/conferir-pastas-convocacao.ts [quantas]
import { query } from "../db.js"

const quantas = Math.min(Math.max(Number(process.argv[2] ?? "1") || 1, 1), 10)
const BASE = process.env.PUBLIC_BASE_URL || "https://plan-intermitente-ocorrencia.vercel.app"
const ESPERADAS = ["CAJU", "CONFERENCIA", "OUTROS"]

interface No { nome: string; pasta: boolean; tamanho?: number; filhos?: No[] }

const { rows: convs } = await query<{
  nome: string | null
  contrato: string | null
  data_inicio: string
  pasta_convocacao_drive_id: string | null
  pasta_caminho: string | null
  criado_em: Date
}>(
  `SELECT nome, contrato, data_inicio, pasta_convocacao_drive_id, pasta_caminho, criado_em
     FROM pontual_prepagamento
    WHERE pasta_convocacao_drive_id IS NOT NULL
    ORDER BY criado_em DESC
    LIMIT $1`,
  [quantas],
)
if (!convs.length) {
  console.log("nenhuma convocação com pasta resolvida")
  process.exit(0)
}

const { rows: s } = await query<{ id: string }>(
  `INSERT INTO sessions (user_id, expira_em, user_agent)
   SELECT id, now() + interval '5 minutes', 'script: conferir-pastas-convocacao'
     FROM users WHERE email = 'n8n@internal.local' RETURNING id`,
)
const sid = s[0]?.id
if (!sid) {
  console.error("usuário de serviço n8n@internal.local não existe — sem ele não há como ler o Drive")
  process.exit(1)
}

let faltou = false
try {
  for (const c of convs) {
    console.log(`\n${c.nome} · ${c.contrato} · ${String(c.criado_em).slice(0, 19)}`)
    console.log(`  ${c.pasta_caminho}`)
    const r = await fetch(`${BASE}/api/drive/arvore?pasta=${c.pasta_convocacao_drive_id}&nivel=2`, {
      headers: { Cookie: `pi_sess=${sid}` },
    })
    if (!r.ok) {
      console.log(`  ⚠ HTTP ${r.status} ao ler a árvore`)
      faltou = true
      continue
    }
    const j = (await r.json()) as { filhos?: No[] }
    const pastas = (j.filhos ?? []).filter((n) => n.pasta).map((n) => n.nome)
    for (const n of j.filhos ?? []) {
      console.log(`    ${n.pasta ? "[pasta]" : "       "} ${n.nome}`)
      for (const f of n.filhos ?? []) console.log(`             ${f.nome}`)
    }
    const semEssas = ESPERADAS.filter((e) => !pastas.includes(e))
    if (semEssas.length) {
      console.log(`  ⚠ FALTAM: ${semEssas.join(", ")}`)
      faltou = true
    } else {
      console.log("  ✓ as três pastas existem")
    }
  }
} finally {
  await query(`DELETE FROM sessions WHERE id = $1`, [sid])
  console.log("\nsessão temporária revogada")
}

process.exit(faltou ? 1 : 0)
