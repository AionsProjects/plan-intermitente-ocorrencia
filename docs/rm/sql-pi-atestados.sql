-- =============================================================================
-- PI ATESTADOS — ausências do RM que quebram uma convocação de intermitente.
--
-- Registrar no RM (Gestão > Consulta SQL). Sugestão de código: PI ATESTADOS
-- Sistema: P    Coligada: 3
--
-- Parâmetros (todos obrigatórios):
--   :$CODCOLIGADA  int    — injetado pelo backend (sempre 3)
--   :DATA_INICIAL  string 'YYYY-MM-DD'
--   :DATA_FINAL    string 'YYYY-MM-DD'
--   :CHAPA         string — '006824' no pontual; '%' no lote (é LIKE, igual ao BEN 2)
--
-- Consumidor: auth-backend/src/services/ausenciasRm.ts
-- Uso: partir uma convocação em pedaços. Convocação 05→20 com atestado 10→11
-- vira 05→09 e 12→20, porque dia coberto por atestado não é dia convocado.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDOU EM RELAÇÃO À CONSULTA BASE, E POR QUÊ
--
-- 1. INTERSEÇÃO de período, não `DTINICIO BETWEEN`.
--    A base pergunta "o atestado COMEÇOU na janela?". Um atestado de 28/07 a
--    05/08 não começou em agosto — e é exatamente ele que cobre os primeiros
--    dias de uma convocação de agosto. Sumia calado.
--    O `< DATEADD(DAY,1,...)` em vez de `<=` cobre DTINICIO com hora: com `<=`,
--    um atestado que começa no último dia às 14:00 fica de fora.
--
-- 2. COALESCE(DTFINAL, DTINICIO).
--    Atestado de 1 dia pode vir com DTFINAL nulo. `NULL >= x` é UNKNOWN, e a
--    linha some — some justo o caso mais comum.
--
-- 3. CODSITUACAO e CODCATEGORIAESOCIAL viram COLUNA, não filtro.
--    Filtro só consegue REMOVER linha. Se a categoria eSocial estiver errada no
--    cadastro (acontece), o filtro esconde o atestado e a automação convoca por
--    cima de dia coberto — em silêncio, com S-2260 transmitido. Devolvendo como
--    coluna, quem decide é o código, que loga o descarte.
--
-- 4. VTIPOATESTADO vira LEFT JOIN; PFCOMPL e PSECAO saem.
--    INNER em tipo faz o atestado sumir quando o tipo não está cadastrado.
--    PFCOMPL/PSECAO eram INNER que não contribuem nenhuma coluna aqui: só têm
--    o poder de perder linha (pessoa sem complemento/seção).
--
-- 5. VCID sai inteiro.
--    Diagnóstico não é necessário pra partir período e não deve trafegar entre
--    sistemas. Só a existência e o intervalo da ausência importam.
--
-- 6. Aliases ASCII SCREAMING_SNAKE e datas em CONVERT(...,120).
--    Chave de JSON com acento já chegou corrompida neste projeto — lookup falha
--    calado e vira "zero ausências", que é o resultado perigoso. E data como
--    'dd/MM/yyyy' obriga a parsear no cliente; 120 é ISO, direto.
--
-- HORAINICIO/HORAFINAL saem CRUS (minutos desde 00:00). É o código que decide o
-- que é dia cheio — a regra pode mudar sem mexer na consulta registrada.
-- =============================================================================

SELECT PFUNC.CHAPA                                                     AS CHAPA,
       PFUNC.NOME                                                      AS NOME,
       PFUNC.CODSITUACAO                                               AS COD_SITUACAO,
       PFUNC.CODCATEGORIAESOCIAL                                       AS COD_CATEGORIA_ESOCIAL,
       PPESSOA.CODIGO                                                  AS COD_PESSOA,
       VATESTADO.CODTPATESTADO                                         AS COD_TIPO_ATESTADO,
       VTIPOATESTADO.NOMETPATESTADO                                    AS TIPO_ATESTADO,
       CONVERT(VARCHAR(10), VATESTADO.DTINICIO, 120)                   AS DT_INICIO,
       CONVERT(VARCHAR(10),
               COALESCE(VATESTADO.DTFINAL, VATESTADO.DTINICIO), 120)   AS DT_FINAL,
       -- 0 = o RM não informou fim (atestado de 1 dia). Sem isso, não dá pra
       -- distinguir "fim ausente" de "fim igual ao início" depois do COALESCE.
       CASE WHEN VATESTADO.DTFINAL IS NULL THEN 0 ELSE 1 END           AS FIM_INFORMADO,
       VATESTADO.HORAINICIO                                            AS HORA_INICIO_MIN,
       VATESTADO.HORAFINAL                                             AS HORA_FINAL_MIN,
       VATESTADO.RECCREATEDBY                                          AS CRIADO_POR,
       CONVERT(VARCHAR(19), CAST(VATESTADO.RECCREATEDON AS DATETIME), 120)  AS CRIADO_EM,
       CONVERT(VARCHAR(19), CAST(VATESTADO.RECMODIFIEDON AS DATETIME), 120) AS ALTERADO_EM
FROM   PFUNC (NOLOCK)
       INNER JOIN PPESSOA (NOLOCK)
               ON PPESSOA.CODIGO = PFUNC.CODPESSOA
       INNER JOIN VATESTADO (NOLOCK)
               ON VATESTADO.CODPESSOA = PPESSOA.CODIGO
       LEFT JOIN VTIPOATESTADO (NOLOCK)
               ON VTIPOATESTADO.CODTPATESTADO = VATESTADO.CODTPATESTADO
WHERE  PFUNC.CODCOLIGADA = :$CODCOLIGADA
       AND PFUNC.CHAPA LIKE :CHAPA
       -- Interseção: [atestado] toca [janela]
       AND VATESTADO.DTINICIO < DATEADD(DAY, 1, CONVERT(DATE, :DATA_FINAL))
       AND COALESCE(VATESTADO.DTFINAL, VATESTADO.DTINICIO) >= CONVERT(DATE, :DATA_INICIAL)
ORDER  BY PFUNC.CHAPA, VATESTADO.DTINICIO
