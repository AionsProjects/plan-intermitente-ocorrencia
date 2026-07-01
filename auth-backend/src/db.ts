import { Pool, types, type QueryResultRow } from "pg"
import { config } from "./config.js"

// Coluna `date` (OID 1082) volta como string "YYYY-MM-DD" crua — sem virar Date
// (evita shift de timezone e o String(Date) mangling em datas só-dia). Timestamps
// (timestamptz) seguem como Date normalmente.
types.setTypeParser(1082, (v) => v)

// Pool unico de conexoes. O Postgres NUNCA e exposto ao browser — so este backend fala com ele.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
})

// O banco cloudfy e COMPARTILHADO (pode ter outra tabela `users`). Isolamos tudo no
// schema `pi`. search_path resolve as queries sem qualificar; cai em public so p/ extensoes.
pool.on("connect", (client) => {
  client.query("SET search_path TO pi, public")
})

export type Papel = "admin" | "dp" | "rh" | "operacional"

export interface Usuario {
  id: string
  google_sub: string | null
  email: string
  nome: string
  sobrenome: string | null
  cpf: string | null
  papel: Papel
  ativo: boolean
  perfil_completo: boolean
  senha_hash: string | null
  criado_em: string
  ultimo_login: string | null
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  return pool.query<T>(text, params)
}
