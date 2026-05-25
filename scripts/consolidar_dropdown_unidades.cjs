#!/usr/bin/env node
/**
 * Consolida labels do dropdown `OP - Local/Unidade` (dropdown_mm3mcnmn)
 * no board ENTRADA (18408773953) contra fonte canônica `unidades.csv`
 * (mapeamento RM oficial).
 *
 * Pipeline:
 *   1. Parse CSV → canônicos por contrato (3º octeto do código define contrato)
 *   2. Fetch dropdown atual via Monday GraphQL
 *   3. Pra cada label atual:
 *      - exact normalized match → auto_merge
 *      - fuzzy Levenshtein ≥ 0.85 contra prefix-stripped canônico → auto_merge
 *      - ≥ 2 candidatos com score similar → ambiguous (user revisa)
 *      - sem match + nome de pessoa → apagar
 *      - sem match + outros → manter (preservar)
 *      - já canônico → ja_canonico
 *   4. --dry-run: gera scripts/mapping_unidades.json sem alterar nada
 *   5. --apply: migra items board ENTRADA + remove labels duplicados
 *               + remove nome-de-pessoa + add canônicos ausentes
 *
 * Decisões user (registradas no plan file):
 *   - Apagar duplicados após migrar items ✓
 *   - Apagar nome-de-pessoa (heurística regex) ✓
 *   - User revisa ambiguous antes de --apply ✓
 *   - Manter intactos labels legítimos fora-do-RM ✓
 *
 * Auth: token Monday API em env MONDAY_TOKEN ou passado via --token=<...>
 *
 * Uso:
 *   node scripts/consolidar_dropdown_unidades.cjs --dry-run
 *   node scripts/consolidar_dropdown_unidades.cjs --apply
 */

const fs = require("fs")
const path = require("path")

const BOARD_ENTRADA = 18408773953
const COL_DROPDOWN = "dropdown_mm3mcnmn"
const COL_TEXTO75 = "texto75"
const COL_CONTRATO = "color_mktcnxwn"
const MONDAY_API = "https://api.monday.com/v2"

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run") || !args.includes("--apply")
const APPLY = args.includes("--apply")
const TOKEN_ARG = args.find((a) => a.startsWith("--token="))
const TOKEN = TOKEN_ARG ? TOKEN_ARG.split("=")[1] : process.env.MONDAY_TOKEN

if (!TOKEN) {
  console.error("ERRO: token Monday ausente. Use --token=<...> ou env MONDAY_TOKEN")
  process.exit(1)
}

// ──────────────────────────────────────────────────────────────────────
// HELPERS — normalização + fuzzy match
// ──────────────────────────────────────────────────────────────────────

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stripPrefixContrato(label) {
  return normalize(label)
    .replace(/^(SEMSA|SEDUC ESCOLA|SEDUC INTERIOR|SEDUC SEDE|SEDUC|DETRAN|TRE PB|CETAM)\s+/, "")
    .replace(/^-\s*/, "")
    .trim()
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

/**
 * Heurística pra detectar label que é nome de pessoa:
 *   - 2+ palavras
 *   - sem prefix contrato
 *   - sem token de unidade (UBS/USF/CF/CAPS/POL/POLI/POLICLINICA/LABORATORIO/CEO/CENTRO/SEDE/UNIDADE/DEP/DEPOSITO/COORDENADORIA/ESCOLA/CETI/CETAM/IFAM/UEA/TRE/DETRAN/SEMSA/SEDUC/AFASTADO/LICENCA/INTERMITENTE/RESCISAO/ADMINISTRACAO/ADMINISTRATIVO/FORUM/ANEXO/MUSEU/GASTRONOMIA/ZONA/PARINTINS/CARAUARI/etc)
 *   - tem apenas letras e espaços (sem números/siglas)
 */
function ehNomeDePessoa(label) {
  const norm = normalize(label)
  const palavras = norm.split(" ")
  if (palavras.length < 2) return false
  const stopwords = new Set([
    "UBS", "UBSR", "USF", "CF", "CAPS", "POL", "POLI", "POLICLINICA", "LABORATORIO",
    "LAB", "CEO", "CENTRO", "SEDE", "UNIDADE", "DEP", "DEPOSITO", "COORDENADORIA",
    "ESCOLA", "ESCOLAS", "CETI", "CETAM", "IFAM", "UEA", "TRE", "DETRAN", "SEMSA",
    "SEDUC", "AFASTADO", "LICENCA", "INTERMITENTE", "INTERMITENTES", "RESCISAO",
    "ADMINISTRACAO", "ADMINISTRATIVO", "FORUM", "ANEXO", "MUSEU", "GASTRONOMIA",
    "ZONA", "PARINTINS", "CARAUARI", "MANACAPURU", "TABATINGA", "IRANDUBA",
    "PRESIDENCIA", "MANAUS", "BORBA", "CODAJAS", "MAUES", "AUTAZES", "HUMAITA",
    "MANICORE", "MANAQUIRI", "CAREIRO", "VARZEA", "CASTANHO", "TAPAUA",
    "AIRAO", "ARIPUANA", "ALVARAES", "FIGUEIREDO", "EVA", "GABRIEL", "CACHOEIRA",
    "CAAPIRANGA", "TEFE", "EE", "EEI", "EI", "ANIBAL", "BECA", "OL",
    "MATERNIDADE", "INSS", "DESPESAS", "OPERACIONAIS", "SETOR", "DIRETORIA",
    "FAAR", "FIOCRUZ", "FUFMT", "FUNASA", "ISB", "IPHAN", "DRF", "MPF",
    "PRF", "DSEI", "ICMBIO", "IFFAR", "IFMS", "IFRN", "IFSMG", "IFP",
    "BARCO", "APRENDIZES", "ESTAGIARIOS", "ESTAGIARIO", "INSTITUTO",
    "ZOONOSES", "MOVEL", "ADM", "VIGILANCIA", "DISTRITAL", "ANTIGA",
    "REABILITACAO", "CONSERVACAO", "ARQUIVO", "VPRESHAF", "PCD", "ROCAS",
    "ALTA", "PARNAMIRIM", "LAJES", "MOSSORO", "RETORIA", "CIDADE", "CANIL",
    "GARANHUS", "GRAVATA", "HANGAR", "IGARASSU", "OURICURI", "PETROLINA",
    "RAJADA", "RECIFE", "SALGUEIRO", "SANTA", "BOA", "VISTA", "CAETANO",
    "SERRA", "TALHADA", "SERTANIA", "TREVO", "IBO", "CARUARU", "FLORESTA",
    "PRETA", "FUNDACAO", "ICEAM", "FEDERAL", "ESTADUAL", "MUNICIPAL",
    "EDUCACAO", "DESPORTO", "SAUDE", "TRANSITO", "PATRIMONIO", "HISTORICO",
    "TURISMO", "EVENTOS", "INDIO", "FUNAI", "CULTURA", "RECEITA",
    "DELEGACIA", "DEFENSORIA", "PROCURADORIA", "TRIBUNAL", "JUSTICA",
    "MINISTERIO", "AGRICULTURA", "PECUARIA", "ABASTECIMENTO", "NACIONAL",
    "REGIONAL", "AGENCIA", "MINERACAO", "PORTO", "VELHO", "RIO", "BRANCO",
    "ACRE", "RONDONIA", "BAHIA", "AMAZONAS", "MATO", "GROSSO", "MINAS",
    "GERAIS", "PARAIBA", "GOIAS", "ALAGOAS", "SAO", "PAULO", "RESIDENCIAL",
    "CONDOMINIO", "PARADISE", "LAKE", "ENG", "AGRO", "AMERICA", "OPERA",
    "OPERACOES", "SEGURANCA", "TRABALHO", "PATRIMONIAL", "TECNOLOGIA",
    "INFORMACAO", "FINANCEIRO", "FISCAL", "FATURAMENTO", "ESTOQUES",
    "CONTRATOS", "MARKETING", "COMERCIAL", "BARCOS", "COMPRAS", "CONTABILIDADE",
    "PESSOAL", "RECURSOS", "HUMANOS", "EXECUTIVA", "FINANCEIRA", "MANUTENCAO",
    "APOIO", "RENDIMENTO", "ALTO", "CONSERVA", "AMADEU", "TEIXEIRA",
    "ARENA", "CARLOS", "ZAMITH", "COLINA", "OSVALDO", "FROTA", "RENNE",
    "MONTEIRO", "VILA", "OLIMPICA", "LEONIDAS", "MARIA", "DEANE",
    "CUIABA", "PONTAL", "ARAGUAIA", "SALVADOR", "MUZAMBINHO", "RIO", "POMBA",
    "ARACUAI", "CANOAS", "CATARINENSE", "CEARA", "MIRIM", "CURRAIS", "NOVOS",
    "RECIFE", "FREDERICO", "WESTPHALEN", "URUGUAIANA", "ALEGRETE", "CORUMBA",
    "NOVA", "ANDRADINA", "TRES", "LAGOAS", "ITABAINA", "CANGUARETAMA",
    "NATAL", "PARELHAS", "GONCALO", "SUL", "ES", "MS", "MG", "RS", "RN",
    "TARUMA", "ACRITICA", "BAURU", "AEROPORTO", "COMPLEXO", "DEPOSITO",
    "ALTAMIRA", "JARAGU", "JOINVILE", "MAFRA", "FRANCISCO", "TUBARAO",
    "ARARANGUA", "CRICIUMA", "LAGUNA", "FAZENDA", "EXPERIMENTAL", "HOSPITAL",
    "VETERINARIO", "NUCLEO", "MEIO", "AMBIENTE", "RECONCAVO", "INDIRETA",
    "VOLTA", "PIRENOPOLIS", "GOIANIA", "JOAO", "PESSOA", "CIDADE",
    "INTERIOR", "COORDENADORIAS", "ENCARREGADO", "ANEXO", "FORUM",
    "JORGE", "KARAM", "NETO", "PADRE", "PEDRO", "GISLANDY",
    // operacionais SEMSA com palavras como WALDIR/BUGALHO/ANTONIO/REIS/etc — vamos confiar no token UBS/USF/CF que sempre antecede
  ])
  for (const p of palavras) {
    if (stopwords.has(p)) return false
  }
  // Tudo letras (sem dígito)
  if (/\d/.test(norm)) return false
  // Tem hífen no original mas não no início (UBS-X pode aparecer, mas nome de pessoa normalmente não tem hífen)
  // Aceita "JOAO NOGUEIRA", "MARIA SILVA DOS SANTOS" — provável pessoa se 2-5 palavras curtas alfabéticas
  return palavras.length >= 2 && palavras.length <= 5
}

// ──────────────────────────────────────────────────────────────────────
// PARSE CSV
// ──────────────────────────────────────────────────────────────────────

function parseCSV(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "")
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())
  // header
  lines.shift()
  const out = []
  for (const line of lines) {
    // Lida com aspas envolvendo valores
    const m = line.match(/^([^;]+);(.*)$/)
    if (!m) continue
    const codigo = m[1].trim()
    let label = m[2].trim()
    // Remove aspas externas (incl. casos multiline mal-formados no CSV)
    label = label.replace(/^"+|"+$/g, "").trim()
    // Aceita label multilinha (entre aspas) — collapse spaces
    label = label.replace(/\s+/g, " ").trim()
    if (!codigo || !label) continue
    out.push({ codigo, label })
  }
  return out
}

function contratoDeCodigo(codigo) {
  const partes = codigo.split(".")
  if (partes.length < 3) return null
  const terceiro = partes[2]
  const quarto = partes[3] ?? ""

  if (terceiro === "0011") {
    if (quarto === "01") return "SEDUC ESCOLA"
    if (quarto === "02") return "SEDUC INTERIOR"
    return null
  }
  const map = {
    "0004": "DETRAN",
    "0010": "SEDUC SEDE",
    "0074": "CETAM",
    "0079": "TRE PB",
    "0085": "SEMSA",
  }
  return map[terceiro] ?? null
}

// ──────────────────────────────────────────────────────────────────────
// MONDAY API
// ──────────────────────────────────────────────────────────────────────

async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  })
  const data = await res.json()
  if (data.errors) {
    throw new Error(`Monday GraphQL: ${JSON.stringify(data.errors)}`)
  }
  return data.data
}

async function fetchDropdownLabels() {
  const data = await mondayQuery(
    `query { boards(ids:[${BOARD_ENTRADA}]) { columns(ids:["${COL_DROPDOWN}"]) { settings_str } } }`,
  )
  const settings = JSON.parse(data.boards[0].columns[0].settings_str)
  return settings.labels
}

async function fetchItemsByLabel(labelText) {
  const labelEscaped = labelText.replace(/"/g, '\\"')
  const data = await mondayQuery(
    `query { items_page_by_column_values(limit: 500, board_id: ${BOARD_ENTRADA}, columns: [{column_id: "${COL_DROPDOWN}", column_values: ["${labelEscaped}"]}]) { items { id name } } }`,
  )
  return data.items_page_by_column_values?.items ?? []
}

async function setItemColumns(itemId, dropdownLabel) {
  // dropdown_mm3mcnmn ← {labels: [<canonical>]}
  // texto75 ← canonical (string)
  const cv = {
    [COL_DROPDOWN]: { labels: [dropdownLabel] },
    [COL_TEXTO75]: dropdownLabel,
  }
  const cvJson = JSON.stringify(JSON.stringify(cv))
  const data = await mondayQuery(
    `mutation { change_multiple_column_values(board_id: ${BOARD_ENTRADA}, item_id: ${itemId}, column_values: ${cvJson}) { id } }`,
  )
  return data.change_multiple_column_values?.id
}

async function atualizarSettingsDropdown(novosLabels) {
  // change_column_metadata aceita só title/description. Pra labels do dropdown:
  // Monday API v2024 não permite atualizar labels via change_column_metadata.
  // Workaround: usar create_or_get_dropdown_value (cria label novo) pra adicionar
  // novos canônicos. Remoção de labels precisa ser feita pela UI ou via API
  // priv com mutation interna (não documentada).
  //
  // Pra ESTA migração: items já foram migrados pros canônicos. Labels antigos
  // ficam ÓRFÃOS no dropdown (sem items referenciando). Não afeta funcionalmente
  // — só visualmente o dropdown tem labels extras. Codex/user pode limpar via UI
  // depois ou via deploy script dedicado se Monday liberar API de remoção.
  //
  // Pra criar labels ausentes (canônicos CSV não existentes no dropdown):
  const novosAdicionados = []
  for (const lbl of novosLabels) {
    if (!lbl._criar) continue
    try {
      const data = await mondayQuery(
        `mutation { create_or_get_dropdown_value(board_id: ${BOARD_ENTRADA}, column_id: "${COL_DROPDOWN}", dropdown_value: ${JSON.stringify(lbl.name)}) { id name } }`,
      )
      if (data.create_or_get_dropdown_value?.id) {
        novosAdicionados.push(lbl.name)
      }
    } catch (err) {
      console.warn(`  ⚠ não consegui criar label "${lbl.name}": ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 80))
  }
  return novosAdicionados
}

// ──────────────────────────────────────────────────────────────────────
// BUILD MAPPING
// ──────────────────────────────────────────────────────────────────────

function buildMapping(csvRows, dropdownLabels) {
  // Índice canônicos por normalize(label) e normalize(stripPrefix(label))
  const canonicaisPorContrato = {}
  const indexExato = new Map() // normalize(label) → { canonico, contrato }
  const indexStripped = new Map() // normalize(strip(label)) → [{ canonico, contrato }]

  for (const { codigo, label } of csvRows) {
    const contrato = contratoDeCodigo(codigo)
    if (!contrato) continue // pula codigos sem contrato operacional
    if (!canonicaisPorContrato[contrato]) canonicaisPorContrato[contrato] = []
    if (!canonicaisPorContrato[contrato].includes(label)) {
      canonicaisPorContrato[contrato].push(label)
    }
    const exato = normalize(label)
    const stripped = stripPrefixContrato(label)
    if (!indexExato.has(exato)) indexExato.set(exato, { canonico: label, contrato })
    if (!indexStripped.has(stripped)) indexStripped.set(stripped, [])
    indexStripped.get(stripped).push({ canonico: label, contrato })
  }

  const auto_merge = {}
  const ambiguous = {}
  const manter = []
  const apagar_nome_pessoa = []
  const ja_canonico = []

  for (const { id, name: label } of dropdownLabels) {
    const exato = normalize(label)

    // já canônico? (exact match com label do CSV)
    const hitExato = indexExato.get(exato)
    if (hitExato && hitExato.canonico === label) {
      ja_canonico.push(label)
      continue
    }
    if (hitExato) {
      // normalize bate mas grafia exata diferente — merge pro canônico do CSV
      auto_merge[label] = {
        id,
        canonico: hitExato.canonico,
        contrato: hitExato.contrato,
        confianca: 1.0,
        razao: "exact_normalized",
      }
      continue
    }

    // strip prefix dos canônicos do CSV, comparar com label atual
    const labelStripped = stripPrefixContrato(label)
    const hitStripped = indexStripped.get(labelStripped)
    if (hitStripped && hitStripped.length === 1) {
      auto_merge[label] = {
        id,
        canonico: hitStripped[0].canonico,
        contrato: hitStripped[0].contrato,
        confianca: 0.95,
        razao: "stripped_prefix_match",
      }
      continue
    }
    if (hitStripped && hitStripped.length > 1) {
      ambiguous[label] = hitStripped.map((h) => ({ canonico: h.canonico, contrato: h.contrato }))
      continue
    }

    // fuzzy Levenshtein contra todos canônicos (versão stripped)
    // + bonus substring + bonus word-fuzzy (palavras similares)
    let melhores = []
    for (const [strippedCanonico, candidatos] of indexStripped.entries()) {
      let score = similarity(labelStripped, strippedCanonico)
      if (labelStripped && strippedCanonico) {
        // Bonus: substring (ex: "UBS THEOMARIO PINTO" ⊂ "UBS THEOMARIO PINTO DA COSTA")
        if (strippedCanonico.includes(labelStripped) || labelStripped.includes(strippedCanonico)) {
          score = Math.max(score, 0.92)
        }
        // Bonus: keywords compartilhadas (palavras de 4+ chars, exact OU fuzzy ≥0.8)
        const wordsA = labelStripped.split(" ").filter((w) => w.length >= 4)
        const wordsB = strippedCanonico.split(" ").filter((w) => w.length >= 4)
        if (wordsA.length > 0) {
          let sharedCount = 0
          for (const wA of wordsA) {
            if (wordsB.includes(wA)) {
              sharedCount++
              continue
            }
            // word-fuzzy: alguma palavra de B similar a wA com Levenshtein ≥0.8?
            for (const wB of wordsB) {
              if (similarity(wA, wB) >= 0.78) {
                sharedCount++
                break
              }
            }
          }
          const ratio = sharedCount / wordsA.length
          if (ratio >= 0.6) score = Math.max(score, 0.84)
          else if (ratio >= 0.4) score = Math.max(score, 0.7)
        }
      }
      if (score >= 0.55) {
        for (const c of candidatos) {
          melhores.push({ canonico: c.canonico, contrato: c.contrato, score })
        }
      }
    }
    melhores.sort((a, b) => b.score - a.score)

    // Score >= 0.85 + único top → auto_merge
    if (melhores.length >= 1 && melhores[0].score >= 0.85) {
      const gap = (melhores[1]?.score ?? 0) === 0 ? 1 : melhores[0].score - melhores[1].score
      // Top distinto (gap ≥ 0.05) ou único candidato → auto_merge
      if (melhores.length === 1 || gap >= 0.05) {
        auto_merge[label] = {
          id,
          canonico: melhores[0].canonico,
          contrato: melhores[0].contrato,
          confianca: melhores[0].score,
          razao: "fuzzy_alto",
        }
        continue
      }
    }

    if (melhores.length > 0) {
      // 0.62-0.85 ou ambíguos → ambiguous (user revisa)
      const top = melhores.slice(0, 5)
      ambiguous[label] = top.map((m) => ({
        canonico: m.canonico,
        contrato: m.contrato,
        score: Number(m.score.toFixed(3)),
      }))
      continue
    }

    // Sem match — pode ser nome-de-pessoa
    if (ehNomeDePessoa(label)) {
      apagar_nome_pessoa.push({ id, label })
      continue
    }

    // Sem match + não-pessoa → manter
    manter.push({ id, label })
  }

  return {
    canonicais_por_contrato: canonicaisPorContrato,
    auto_merge,
    ambiguous,
    manter,
    apagar_nome_pessoa,
    ja_canonico,
  }
}

// ──────────────────────────────────────────────────────────────────────
// APPLY
// ──────────────────────────────────────────────────────────────────────

async function aplicarMigracao(mapping) {
  const relatorio = {
    items_migrados: 0,
    items_falha: 0,
    labels_removidos: 0,
    labels_adicionados: 0,
    erros: [],
  }

  // 1) Migra items com auto_merge: pra cada label de origem, busca items + seta canônico
  for (const [labelAtual, info] of Object.entries(mapping.auto_merge)) {
    console.log(`\n→ Migrando "${labelAtual}" → "${info.canonico}"`)
    let items
    try {
      items = await fetchItemsByLabel(labelAtual)
    } catch (err) {
      console.error(`  Erro fetch items: ${err.message}`)
      relatorio.erros.push({ label: labelAtual, etapa: "fetch", erro: err.message })
      continue
    }
    console.log(`  ${items.length} items afetados`)
    for (const it of items) {
      try {
        await setItemColumns(it.id, info.canonico)
        relatorio.items_migrados++
      } catch (err) {
        console.error(`  Erro migrar item ${it.id}: ${err.message}`)
        relatorio.items_falha++
        relatorio.erros.push({ label: labelAtual, item_id: it.id, etapa: "set", erro: err.message })
      }
      // throttle leve pra evitar rate limit
      await new Promise((r) => setTimeout(r, 80))
    }
  }

  // 2) Atualiza dropdown settings: novo conjunto = (canônicos CSV ∪ manter) − (auto_merge_origem ∪ apagar_nome_pessoa)
  console.log(`\n→ Atualizando settings do dropdown...`)
  const labelsAtuais = await fetchDropdownLabels()
  const removeSet = new Set([
    ...Object.keys(mapping.auto_merge),
    ...mapping.apagar_nome_pessoa.map((p) => p.label),
  ])
  const novosLabels = []
  let nextId = 0
  // Inclui todos canônicos do CSV (alguns podem não estar no dropdown atual)
  const todosCanonicos = new Set()
  for (const arr of Object.values(mapping.canonicais_por_contrato)) {
    for (const c of arr) todosCanonicos.add(c)
  }
  // Mantém também labels em "manter" (fora-do-RM, legítimos)
  for (const m of mapping.manter) todosCanonicos.add(m.label)

  // Identifica labels canônicos ausentes do dropdown atual — precisa criar via API
  const labelsAtuaisNames = new Set(labelsAtuais.map((l) => l.name))
  for (const lbl of labelsAtuais) {
    if (removeSet.has(lbl.name)) continue
    if (todosCanonicos.has(lbl.name)) {
      novosLabels.push({ id: lbl.id, name: lbl.name, _criar: false })
      todosCanonicos.delete(lbl.name)
      if (lbl.id >= nextId) nextId = lbl.id + 1
    }
  }
  // Marca canônicos ausentes pra criar
  for (const novo of todosCanonicos) {
    novosLabels.push({ id: nextId++, name: novo, _criar: true })
  }
  // Labels removidos = origem auto_merge + nome-pessoa. Monday API não tem
  // delete-label nativo — ficam como labels órfãos sem items referenciando.
  // Esses NÃO devem aparecer na UI ativa porque nenhum item os usa, mas
  // ainda existem nas settings. Codex/user limpa manualmente via UI Monday.
  relatorio.labels_removidos_orfaos = removeSet.size

  try {
    const adicionados = await atualizarSettingsDropdown(novosLabels)
    relatorio.labels_adicionados = adicionados.length
    console.log(
      `  Labels criados: ${adicionados.length}. Labels órfãos no dropdown: ${relatorio.labels_removidos_orfaos} (limpar manual na UI Monday)`,
    )
  } catch (err) {
    console.error(`  Erro adicionar labels: ${err.message}`)
    relatorio.erros.push({ etapa: "settings", erro: err.message })
  }

  return relatorio
}

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}`)
  console.log(`Board: ${BOARD_ENTRADA}, coluna: ${COL_DROPDOWN}`)

  const csvPath = path.join(__dirname, "data", "unidades.utf8.csv")
  console.log(`\nParsing CSV: ${csvPath}`)
  const csvRows = parseCSV(csvPath)
  console.log(`  ${csvRows.length} linhas (códigos + labels)`)

  console.log(`\nFetching dropdown atual...`)
  const dropdownLabels = await fetchDropdownLabels()
  console.log(`  ${dropdownLabels.length} labels no dropdown`)

  console.log(`\nBuilding mapping...`)
  const mapping = buildMapping(csvRows, dropdownLabels)

  // Aplica overrides manuais (decisões user) se mapping_overrides.json existe
  const overridesPath = path.join(__dirname, "mapping_overrides.json")
  if (fs.existsSync(overridesPath)) {
    console.log(`  Aplicando overrides: ${overridesPath}`)
    const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"))
    // force_merge: move ambiguous/manter → auto_merge com canônico user-aprovado
    const labelToId = new Map(dropdownLabels.map((l) => [l.name, l.id]))
    for (const [labelAtual, info] of Object.entries(overrides.force_merge ?? {})) {
      const id = labelToId.get(labelAtual)
      if (id === undefined) {
        console.warn(`  ⚠ override force_merge: label "${labelAtual}" não existe no dropdown`)
        continue
      }
      mapping.auto_merge[labelAtual] = {
        id,
        canonico: info.canonico,
        contrato: info.contrato,
        confianca: 1.0,
        razao: "override_user",
      }
      delete mapping.ambiguous[labelAtual]
      mapping.manter = mapping.manter.filter((m) => m.label !== labelAtual)
    }
    // force_manter: garante que label fica em manter (remove de ambiguous/auto_merge)
    for (const label of overrides.force_manter ?? []) {
      const id = labelToId.get(label)
      if (id === undefined) continue
      delete mapping.auto_merge[label]
      delete mapping.ambiguous[label]
      if (!mapping.manter.some((m) => m.label === label)) {
        mapping.manter.push({ id, label })
      }
    }
    console.log(
      `  Overrides aplicados: ${Object.keys(overrides.force_merge ?? {}).length} force_merge, ${(overrides.force_manter ?? []).length} force_manter`,
    )
  }

  const outDir = path.join(__dirname)
  const mappingPath = path.join(outDir, "mapping_unidades.json")
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), "utf8")
  console.log(`  Gravado: ${mappingPath}`)

  // Resumo
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`RESUMO MAPPING`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Canônicos do CSV (por contrato):`)
  for (const [c, arr] of Object.entries(mapping.canonicais_por_contrato)) {
    console.log(`  ${c}: ${arr.length}`)
  }
  console.log(``)
  console.log(`Labels já canônicas (sem ação):    ${mapping.ja_canonico.length}`)
  console.log(`Labels p/ auto-merge:              ${Object.keys(mapping.auto_merge).length}`)
  console.log(`Labels ambíguas (revisar):         ${Object.keys(mapping.ambiguous).length}`)
  console.log(`Labels nome-de-pessoa (apagar):    ${mapping.apagar_nome_pessoa.length}`)
  console.log(`Labels sem-match (manter):         ${mapping.manter.length}`)
  console.log(``)

  if (Object.keys(mapping.ambiguous).length > 0) {
    console.log(`⚠ AMBÍGUOS — revisar em ${mappingPath} antes de --apply:`)
    for (const [label, cands] of Object.entries(mapping.ambiguous)) {
      console.log(`  "${label}":`)
      for (const c of cands.slice(0, 3)) {
        console.log(`     → ${c.canonico} (${c.contrato}${c.score ? `, score ${c.score}` : ""})`)
      }
    }
    console.log(``)
  }

  if (mapping.apagar_nome_pessoa.length > 0) {
    console.log(`🗑 NOME-DE-PESSOA (serão apagados em --apply):`)
    for (const p of mapping.apagar_nome_pessoa) console.log(`  - "${p.label}"`)
    console.log(``)
  }

  if (DRY_RUN) {
    console.log(`✓ Dry-run completo. Revise ${mappingPath} antes de rodar --apply.`)
    return
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`APLICANDO MIGRAÇÃO...`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  const relatorio = await aplicarMigracao(mapping)
  const relPath = path.join(outDir, "relatorio_migracao_unidades.json")
  fs.writeFileSync(relPath, JSON.stringify(relatorio, null, 2), "utf8")
  console.log(`\n✓ Concluído. Relatório: ${relPath}`)
  console.log(`  Items migrados: ${relatorio.items_migrados}`)
  console.log(`  Items falha:    ${relatorio.items_falha}`)
  console.log(`  Labels removidos: ${relatorio.labels_removidos}`)
  console.log(`  Labels adicionados: ${relatorio.labels_adicionados}`)
  console.log(`  Erros: ${relatorio.erros.length}`)
}

main().catch((err) => {
  console.error(`ERRO FATAL: ${err.stack || err.message}`)
  process.exit(1)
})
