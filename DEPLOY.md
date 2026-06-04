# Deploy

Há **duas formas** de subir o frontend numa VM Linux:

- **[Docker](#deploy-com-docker-recomendado) (recomendado)** — uma imagem
  com node+nginx, sobe com `docker compose up -d`. Não precisa instalar
  Node, nginx, nem certbot na VM.
- **[Bare-metal](#deploy-sem-docker-bare-metal)** — clone do repo, `npm
  run build`, nginx do sistema servindo `dist/`.

> O backend (n8n + monday) já roda separado; aqui é só o site estático.

---

## Deploy com Docker (recomendado)

### Pré-requisitos na VM

- Docker Engine e Docker Compose plugin instalados
- Porta 80 livre no host (se já tem nginx do sistema, pare ou mude porta)

Instalar Docker no Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # logout/login depois pra valer
```

### Clonar e configurar

```bash
sudo mkdir -p /opt
sudo chown -R $USER:$USER /opt
cd /opt
git clone https://github.com/AionsProjects/plan-intermitente-ocorrencia.git plano-intermitentes
cd plano-intermitentes
```

Crie um `.env` ao lado do `docker-compose.yml` apontando pros DOIS n8n:

```bash
cat > .env <<'EOF'
VITE_N8N_BASE_URL=https://aionscorp-n8n.cloudfy.live/webhook
VITE_N8N_ANTIGO_BASE_URL=https://antigoaionscorp-n8n.cloudfy.live/webhook
EOF
```

> Esse `.env` é lido pelo docker compose só pra passar como `--build-arg`
> ao Vite. **Não confunda com o `.env` do dev local** — é a mesma chave
> mas o uso é diferente.

> ⚠️ **CRÍTICO — não erre os hosts (já quebrou em produção):**
> - `VITE_N8N_BASE_URL` = **n8n NOVO** (`aionscorp-n8n`). É onde vivem
>   WF2 (ler), **WF3 (finalizar)**, descontos, ponto facultativo, atestados,
>   feriados. Se isso apontar pro ANTIGO, o `/preencher` **não chama o WF3**
>   (o webhook não existe no antigo) e nada é registrado.
> - `VITE_N8N_ANTIGO_BASE_URL` = **n8n ANTIGO** (`antigoaionscorp-n8n`).
>   Usado por convocar (WF7), busca empregado RM (BEN 2/WF8), cancelar.
> - **Sintoma de host trocado**: form envia mas não aparece execução no WF3.
>   Confira `cat /opt/plano-intermitentes/.env`.

### Subir

```bash
docker compose up -d --build
```

Pronto. App acessível em `http://192.168.0.40` (porta 80 do host).

### Comandos úteis

```bash
docker compose logs -f app          # ver logs do nginx
docker compose ps                   # status do container
docker compose restart app          # reiniciar
docker compose down                 # parar e remover container
```

### Atualizar para nova versão do código

```bash
cd /opt/plano-intermitentes
git pull
docker compose up -d --build        # rebuilda imagem e troca container
```

> O `--build` é importante porque a `VITE_N8N_BASE_URL` é "baked" no bundle
> JS no momento do build. Mudou o `.env`? Tem que rebuildar.

> ⚠️ **`git pull` NÃO atualiza o `.env`** (é gitignored, fica só na VM). Se
> o app começar a "não chamar o n8n" depois de um pull, confira os hosts do
> `.env` da VM (ver bloco crítico acima) e rebuilde.

### Trocar a porta do host

Se já tem algo na porta 80, edite o [docker-compose.yml](docker-compose.yml):

```yaml
ports:
  - "8080:80"   # acesso vira http://192.168.0.40:8080
```

E ajuste o `APP_BASE_URL` no WF1 do n8n pra incluir a porta.

### Diagnóstico Docker

| Sintoma | Causa provável |
|---|---|
| `Error response from daemon: ports are not available` | Algo já usa porta 80 (`sudo lsof -i :80`) — pare o serviço ou mude a porta no compose |
| App carrega mas "Link não encontrado" em tudo | `VITE_N8N_BASE_URL` ficou vazia no build → entrou em modo mock. Confira o `.env` e rebuilde |
| Mudei o `.env`, subi de novo, mas não pegou | Faltou `--build`. Rode `docker compose up -d --build` |
| `permission denied while trying to connect to Docker daemon` | Faltou `sudo usermod -aG docker $USER` + relogar, ou usar `sudo docker compose ...` |

---

## Deploy sem Docker (bare-metal)

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

O template já vem com `server_name _;` (catch-all), então funciona tanto
por IP da VM quanto por qualquer hostname:

```bash
sudo cp docs/nginx-plano-intermitentes.conf.example /etc/nginx/sites-available/plano-intermitentes
sudo ln -s /etc/nginx/sites-available/plano-intermitentes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> Se houver outro site default no nginx (ex: `/etc/nginx/sites-enabled/default`),
> remova o symlink dele para evitar conflito de `default_server`.

## HTTPS

### Caso A — sem domínio, acesso por IP intranet (cenário atual)

VM `192.168.0.40` é IP **privado**. Let's Encrypt **não emite cert** pra
IP privado (não consegue validar pelo lado de fora). Ficamos em HTTP puro.

Implicações já tratadas no código:

- O botão **"Copiar protocolo"** tem fallback `document.execCommand('copy')`
  que funciona em HTTP — não depende da Clipboard API moderna.
- O protocolo também é mostrado em fonte grande e selecionável (clique seleciona
  o texto inteiro pra Ctrl+C manual).
- O protocolo também fica salvo no board monday histórico (`18411141462`,
  coluna `Protocolo`) — backup natural caso a cópia falhe.

Browsers vão exibir aviso "Não seguro" na barra de endereço — é esperado em
HTTP. Se isso incomodar, ver Caso B.

### Caso B — com domínio (futuro)

```bash
sudo certbot --nginx -d intermitentes.aionscorp.com
```

O certbot edita o nginx (adiciona `listen 443 ssl` e redirect 80→443).
Renovação automática via `systemctl status certbot.timer`.

## Atualizar `APP_BASE_URL` no n8n WF1

No n8n cloud, abra o workflow `Intermitente — 1. Preparar (monday)` →
node "Preparar dados" → primeira linha do código.

**Cenário atual (IP intranet):**
```js
const APP_BASE_URL = 'http://192.168.0.40';
```

**Caso B (com domínio):**
```js
const APP_BASE_URL = 'https://intermitentes.aionscorp.com';
```

Salve e ative o WF.

> Itens já criados pelo WF1 antes da atualização ficam com link apontando
> pro valor antigo. Apague-os no board histórico (`18411141462`) ou
> re-dispare o WF1 a partir do board origem.

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
| Botão "Copiar protocolo" não faz nada em HTTP | Fallback `execCommand` está implementado, mas alguns browsers desabilitam tudo. Workaround: clicar no protocolo seleciona o texto, daí Ctrl+C |
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
