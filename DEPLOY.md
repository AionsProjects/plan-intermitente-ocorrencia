# Deploy

Guia de deploy do app frontend numa VM Linux (Ubuntu/Debian) servindo via
nginx, atrás de HTTPS via Let's Encrypt.

> O backend (n8n + monday) já roda separado; aqui é só o site estático.

## Pré-requisitos

- VM Linux com acesso SSH e portas 80/443 abertas
- Domínio apontando pro IP da VM (ex: `intermitentes.aionscorp.com`)
- Node.js 20.x ou superior

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
node --version  # confirmar v20.x+
```

## Posicionar o repositório

Caminho recomendado: `/var/www/plano-intermitentes`.

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone https://github.com/AionsProjects/plan-intermitente-ocorrencia.git plano-intermitentes
cd plano-intermitentes
```

## Configurar `.env`

Crie o arquivo `.env` (não commitado) apontando pro n8n de produção:

```bash
cat > .env <<'EOF'
VITE_N8N_BASE_URL=https://aionscorp-n8n.cloudfy.live/webhook
EOF
```

> Importante: nunca subir `.env.local` pra VM — esse arquivo força modo
> mock e o app nem chama o n8n.

## Build de produção

```bash
npm install
npm run build
```

Saída em `dist/`. Toda vez que atualizar o código, repita o build.

## Configurar nginx

Copie o template e ajuste o `server_name`:

```bash
sudo cp docs/nginx-plano-intermitentes.conf.example /etc/nginx/sites-available/plano-intermitentes
sudo nano /etc/nginx/sites-available/plano-intermitentes
# trocar "SEU_DOMINIO_AQUI" pelo domínio real
```

Ativar:

```bash
sudo ln -s /etc/nginx/sites-available/plano-intermitentes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS com Let's Encrypt

A clipboard API (botão "Copiar protocolo") só funciona em contexto seguro.
HTTPS é obrigatório.

```bash
sudo certbot --nginx -d intermitentes.aionscorp.com
```

O certbot edita o nginx config sozinho (adiciona bloco `listen 443 ssl`
e redirect 80→443). Renovação automática vem por padrão via
`systemctl status certbot.timer`.

## Atualizar `APP_BASE_URL` no n8n WF1

No n8n cloud, abra o workflow `Intermitente — 1. Preparar (monday)` →
node "Preparar dados" → primeira linha do código:

```js
const APP_BASE_URL = 'https://intermitentes.aionscorp.com';
```

Salve e ative o WF.

> Itens já criados pelo WF1 com `localhost` ficam com link quebrado.
> Apague-os no board histórico (`18411141462`) ou re-dispare o WF1
> pra cada um após atualizar o domínio.

## Atualizações futuras

```bash
cd /var/www/plano-intermitentes
git pull
npm install   # se package.json mudou
npm run build
# nginx serve direto da pasta dist/, não precisa reload
```

## Diagnóstico

| Sintoma | Causa provável |
|---|---|
| 502 Bad Gateway | nginx ok mas `dist/` vazio → rodar `npm run build` |
| 404 em rotas internas (`/preencher/uuid`, `/corrigir`) | Faltou o `try_files ... /index.html` no nginx — ver template |
| "Link não encontrado" no app | `.env` apontando errado ou `.env.local` na VM |
| Erro CORS no console | Os WFs já incluem `Access-Control-Allow-Origin: *`; se aparecer, conferir o "Respond" node no n8n |
| Botão "Copiar protocolo" não faz nada | Site em HTTP — clipboard API exige HTTPS |
| `npm install` falha em binários nativos | Apagou `node_modules` e `package-lock.json`? Refazer do zero |

## Configurar expiração de links

Links expiram em 30 dias (coluna `Expira Em`). Para mudar status pra
Expirado automaticamente, escolha uma estratégia:

**Opção A — monday Automation (mais simples)**:
No board histórico (`18411141462`) → Automations → criar:
*"When Expira Em arrives, change Status to Expirado"*.

**Opção B — n8n cron diário**:
Novo workflow com Schedule Trigger (1x/dia, ex 03:00) que lista items
com `status=Aguardando AND expira_em < hoje` e seta status=Expirado.
