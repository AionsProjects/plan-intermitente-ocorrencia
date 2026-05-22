// Nó 9.5 — Determinar Remetente (token) com base no nível de escalonamento
// 14 setores + tokens | Estoque e Contratos usam token Tuca | Comercial usa token Dr. João

const dados = $input.item.json;

// ==========================================
// MAPEAMENTO DE LÍDERES POR SETOR COM TOKENS
// ==========================================
const mapaLideres = {
  'DP':            { nome: 'Odney',                  token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDcxMTI0NiwiYWFpIjoxMSwidWlkIjo1MDQyOTAzMCwiaWFkIjoiMjAyNi0wNC0wMVQxOTozMjozMS4xNjlaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.ypy2lYhwp6dbdK2ACdSVptE7irBwyoYnf13Y_txm37A' },
  'Financeiro':    { nome: 'Ariana',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0NzAwNjI2NiwiYWFpIjoxMSwidWlkIjo3MTUwOTMzNiwiaWFkIjoiMjAyNi0wNC0xN1QxMzo1ODowMC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.smsEhvnb0yc91nwcn2bDLeBvzdULO1BtRvixbit5zLQ' }, // TROCAR
  'RH':            { nome: 'Rainer',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDIxNzYxNiwiYWFpIjoxMSwidWlkIjo2MDAwMjY0MywiaWFkIjoiMjAyNi0wMy0zMVQyMDo1NzowNC4xMTdaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.U0cRprY7mZRIQf7TaFqU6Ft9X3-EN9SITExBsLcJ2Nw' },
  'TI':            { nome: 'Rayro',                  token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYwNDU1MjM0NSwiYWFpIjoxMSwidWlkIjo1NDE0MTk0NSwiaWFkIjoiMjAyNi0wMS0wN1QxNToyNjozNy4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.E825_7VUNkF3Wz0hj3bKp3ItTgJwnkSp3ZQajzuF63I' },
  'Marketing':     { nome: 'Aleane',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYwNzY0Njc2MSwiYWFpIjoxMSwidWlkIjo2NDQ0MTk0MCwiaWFkIjoiMjAyNi0wMS0xNFQxODowMDoyMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.U3wEuDpmn4XDCwutu89KZaCAX2N0zEJ942tafKU-6no' },
  'Sesmt':         { nome: 'Jessica',                token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDIxOTc0MCwiYWFpIjoxMSwidWlkIjo0NTQxNzMzMiwiaWFkIjoiMjAyNi0wMy0zMVQyMTowMjoyNi4yNzVaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.akgxNQulhvxAi7mwdNgfa5wC-haGXWJmG2iWiOVG-vI' },
  'Compras':       { nome: 'Vinicius',               token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDIxODE5NCwiYWFpIjoxMSwidWlkIjo3NjAyMTM2MCwiaWFkIjoiMjAyNi0wMy0zMVQyMDo1ODozNi44MDVaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.TOTLf98sQf0a3YXZwd99TVFdInDjTEVNf-zEU0cgvbA' },
  'Contabilidade': { nome: 'Karine Batista',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDIxODYzMCwiYWFpIjoxMSwidWlkIjo2NzE1ODYxNSwiaWFkIjoiMjAyNi0wMy0zMVQyMDo1OTo0NS44MjlaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.JJv19XkzZqfo2wIblrnqUibuJqfQFwZkJtsmJIPalws' }, // TROCAR
  'Operacional':   { nome: 'Karlla',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYwNDYyODI5OSwiYWFpIjoxMSwidWlkIjo2MDc4ODYyMiwiaWFkIjoiMjAyNi0wMS0wN1QxNzoxODo1NS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjMzODY4NjEsInJnbiI6InVzZTEifQ.dJs48mXAV4BYh80GtHr2GhSEBpfqMWED_xL5_WGCbxs' },
  'AIONS':         { nome: 'Karen Vasconcelos',      token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MjQ3NjE2MywiYWFpIjoxMSwidWlkIjo0NDI5NzU5NCwiaWFkIjoiMjAyNC0xMS0yOFQxNzo0NjoxNy4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.1-LvSIygROh-D_uLEMn2F-RO3mPaWWSVpITRP5P5n3w' },
  'Comercial':     { nome: 'Dr. João',               token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQyMDQ4NjkxOCwiYWFpIjoxMSwidWlkIjozMTgyNjEyMSwiaWFkIjoiMjAyNC0xMC0wN1QxODozMDo1Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.OMBp40rLVAFWKcuuMHFpfsuMe80ljfInFzN5du3A_Ng' }, // TROCAR
  'Contratos':     { nome: 'Jeferson',               token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDcxNTAzOCwiYWFpIjoxMSwidWlkIjo3NDAyMTU4MSwiaWFkIjoiMjAyNi0wNC0wMVQxOTo0MDo0Ni43NjlaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.Qdq2E_WPQYvOkPIyyQpHIMlNAFBBmLnR27NoOOQBHNc' },
  'Fiscal':        { nome: 'Karine Batista',                 token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY0MDIxODYzMCwiYWFpIjoxMSwidWlkIjo2NzE1ODYxNSwiaWFkIjoiMjAyNi0wMy0zMVQyMDo1OTo0NS44MjlaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.JJv19XkzZqfo2wIblrnqUibuJqfQFwZkJtsmJIPalws' },
  'Estoque':       { nome: 'Ernandes',               token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQyMDQ4NjkxOCwiYWFpIjoxMSwidWlkIjozMTgyNjEyMSwiaWFkIjoiMjAyNC0xMC0wN1QxODozMDo1Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.OMBp40rLVAFWKcuuMHFpfsuMe80ljfInFzN5du3A_Ng' }, // TROCAR
};

const TOKEN_DR_JOAO = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQyMDQ4NjkxOCwiYWFpIjoxMSwidWlkIjozMTgyNjEyMSwiaWFkIjoiMjAyNC0xMC0wN1QxODozMDo1Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.OMBp40rLVAFWKcuuMHFpfsuMe80ljfInFzN5du3A_Ng';
const TOKEN_TUCA    = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQyMDQ4NjkxOCwiYWFpIjoxMSwidWlkIjozMTgyNjEyMSwiaWFkIjoiMjAyNC0xMC0wN1QxODozMDo1Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.OMBp40rLVAFWKcuuMHFpfsuMe80ljfInFzN5du3A_Ng';

// ==========================================
// RESOLUÇÃO DO TOKEN BASEADO NO NÍVEL
// ==========================================
const nivel = dados.nivel_escalonamento || 1;
const setorAlvo = dados.setor_demandado_alvo || '';

let tokenRemetente;

if (nivel === 3) {
  tokenRemetente = TOKEN_TUCA;
} else if (nivel === 2) {
  tokenRemetente = TOKEN_DR_JOAO;
} else {
  // Nível 1 — usa token do líder do setor
  const dadosLider = mapaLideres[setorAlvo];
  tokenRemetente = dadosLider ? dadosLider.token : TOKEN_TUCA;
}

return [{
  json: {
    ...dados,
    token_remetente: tokenRemetente
  }
}];
