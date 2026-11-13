# Pulso · Monitoramento de pedidos por webhook

Painel operacional que recebe webhooks assinados de marketplaces, consolida pedidos por loja e avisa a equipe em tempo real quando algo exige atenção.

[English version](README.en.md) · [![CI](https://github.com/VictorStavarengo/pulso-webhooks/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorStavarengo/pulso-webhooks/actions/workflows/ci.yml)
![Python 3.13](https://img.shields.io/badge/python-3.13-3776AB?logo=python&logoColor=white)
![React 19](https://img.shields.io/badge/react-19-20232A?logo=react&logoColor=61DAFB)
![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-000000)

![Dashboard do Pulso](docs/screenshots/02-dashboard.png)

> **Demo local em um comando:** `PULSO_DEMO_SEED=1 PULSO_ALERTAS_EXTERNAS=0 docker compose up --build` → `http://localhost:8000` com `admin@pulso.local` / `pulso123`, 12 pedidos, integrações, notificações e uma fila de entrega já preenchida. O passo a passo da demo pública está em [Deploy de demonstração](#deploy-de-demonstração).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/VictorStavarengo/pulso-webhooks)

## O problema

Lojas que vendem em vários marketplaces (Shopify, Mercado Livre, Nuvemshop…) recebem dezenas de webhooks por dia em formatos diferentes. Sem uma camada de consolidação, a equipe descobre pedidos atrasados, cancelamentos e vendas de ticket alto tarde demais — e cada integração vira um script isolado, sem assinatura, sem idempotência e sem visibilidade.

O Pulso resolve isso em um só lugar:

- valida a assinatura HMAC de cada evento antes de aceitar qualquer dado;
- consolida o pedido mais recente por `pedido_id` e mantém o histórico de eventos;
- detecta atraso, cancelamento e valor alto, e alerta por e-mail, Telegram ou WhatsApp;
- entrega o painel em tempo real via SSE, com filtros, paginação e exportação CSV.

## Funcionalidades

| Área | O que já funciona |
| --- | --- |
| Recebimento | `POST /webhooks/pedidos` com HMAC-SHA256, janela de tolerância, deduplicação por `evento_id` e rate limit por IP/loja |
| Pedidos | lista paginada, busca, filtro por status e período, ordenação, resumo (receita, ticket médio, em andamento) e CSV |
| Detalhe | histórico completo do pedido com payload de cada evento e alertas gerados |
| Tempo real | SSE em `/api/stream` (hub em memória ou Redis) atualiza o painel sem recarregar |
| Multi-loja | isolamento por loja, troca de loja ativa, configurações de alerta por loja |
| Equipe | papéis `admin` e `operador`, convite de pessoas, proteção contra remover o último admin |
| Segurança | cookie assinado, CSRF double-submit, 2FA TOTP, scrypt para senhas, rate limit no login |
| Operação | retenção automática de logs, `/health`, `/metrics` Prometheus, Sentry opcional, logs estruturados |
| Alertas | e-mail (SMTP), Telegram e WhatsApp Cloud API, com teste de canal pelo painel |
| Confiabilidade | fila de entrega com retentativa e backoff exponencial; falhas persistentes viram **dead-letter** e ficam auditáveis no painel |

## Arquitetura

```mermaid
flowchart LR
    MP["Marketplaces<br/>Shopify · Mercado Livre · Nuvemshop"] -->|"POST assinado (HMAC)"| API

    subgraph Pulso
        API["FastAPI<br/>routers/auth · pedidos · webhooks<br/>lojas · notificacoes · usuarios · sistema"]
        API --> DB[("SQLite (WAL)<br/>ou Postgres")]
        API --> RL["Rate limit<br/>memória ou Redis"]
        API --> AL["Alertas<br/>e-mail · Telegram · WhatsApp"]
        API --> MET["/metrics · /health"]
    end

    UI["Painel React 19<br/>Vite + Tailwind"] -->|"cookie + CSRF"| API
    API -->|"SSE /api/stream"| UI
```

Decisões que valem destacar:

- **Uma imagem, uma origem.** A imagem Docker compila o painel e a API serve os estáticos (`PULSO_SERVIR_FRONTEND=1`). Cookie de sessão e CSRF ficam no mesmo domínio, sem CORS frágil.
- **Opcionais por ambiente.** SQLite + memória rodam sem infraestrutura; `DATABASE_URL` e `REDIS_URL` escalam para Postgres e Redis sem mudar código.
- **Regra de negócio fora das rotas.** A consolidação de eventos vive em `servicos.py`, então HTTP e testes compartilham o mesmo caminho.
- **Falha de canal não perde o alerta.** Cada tentativa de entrega externa vira uma linha em `envios_alerta`. Em caso de erro, um worker reagenda com backoff (`60s → 5min → 15min`); esgotadas as tentativas, o registro fica como `descartado` (dead-letter) e pode ser consultado em `GET /api/lojas/{id}/alertas/envios`.

## Stack

| Camada | Tecnologias |
| --- | --- |
| API | Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2, Uvicorn |
| Banco | SQLite com WAL por padrão, Postgres opcional, Alembic para migrações |
| Painel | React 19, TypeScript, Vite 8, Tailwind CSS 4 |
| Segurança | scrypt, HMAC-SHA256, TOTP (pyotp), CSRF double-submit |
| Observabilidade | Prometheus (`prometheus-client`), Sentry, logs JSON |
| Qualidade | pytest (64 testes), Playwright (E2E), ESLint, GitHub Actions |
| Entrega | Docker multi-stage, Docker Compose, Render Blueprint |

## Como rodar

Pré-requisitos: Python 3.13+, Node 22+.

```bash
# API
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env               # preencha só o que for usar
uvicorn main:app --reload

# Painel (em outro terminal)
cd frontend
npm install
npm run dev
```

Painel em `http://localhost:5173` e API em `http://localhost:8000` (o Vite faz proxy de `/api`, `/webhooks` e `/health`).

Acesso inicial, criado no primeiro boot:

| Papel | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@pulso.local` | `pulso123` |

Troque as credenciais com `PULSO_ADMIN_EMAIL` e `PULSO_ADMIN_SENHA` **antes** de expor a aplicação. O painel permite criar operadores em **Menu da conta → Equipe e acessos**.

### Docker Compose

```bash
docker compose up --build
# painel + API em http://localhost:8000
```

O segredo de sessão é gravado em `/dados/.pulso-sessao` (volume nomeado), então reiniciar o container não derruba as sessões. Para usar Postgres e Redis:

```bash
DATABASE_URL=postgresql+psycopg://pulso:pulso@postgres:5432/pulso \
REDIS_URL=redis://redis:6379/0 \
docker compose --profile postgres --profile redis up --build
```

## Configuração

Tudo é opcional: sem `.env`, a aplicação sobe com SQLite local, admin padrão e alertas externos desligados. O arquivo [`.env.example`](.env.example) lista todas as variáveis; as principais:

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///ecommerce.db` | Banco da aplicação (`postgresql://…` é convertida para o driver psycopg) |
| `REDIS_URL` | vazio | SSE entre workers e rate limit compartilhado |
| `SESSION_SECRET` | arquivo `.pulso-sessao` | Assinatura dos cookies; obrigatório em produção |
| `PULSO_SESSAO_ARQUIVO` | `.pulso-sessao` | Onde persistir o segredo quando não há `SESSION_SECRET` |
| `PULSO_COOKIE_SECURE` | `0` | `1` atrás de HTTPS |
| `PULSO_WEBHOOK_TOLERANCIA` | `300` | Janela (s) aceita para o timestamp do webhook |
| `PULSO_RATE_LIMIT_LOGIN` / `PULSO_RATE_LIMIT_WEBHOOK` | `10` / `300` | Requisições por janela de 60 s |
| `PULSO_RETENCAO_DIAS` | `90` | Expurgo automático de webhooks antigos (`0` desliga) |
| `PULSO_ALERTAS_EXTERNAS` | `1` | Liga o envio de e-mail/Telegram/WhatsApp |
| `PULSO_ALERTA_MAX_TENTATIVAS` | `4` | Tentativas totais por envio antes do dead-letter |
| `PULSO_ALERTA_BACKOFF` | `60,300,900` | Atrasos (s) entre retentativas; o último se repete |
| `PULSO_ALERTA_RETENTATIVA_INTERVALO` | `30` | Intervalo (s) do worker que varre a fila |
| `PULSO_DEMO_SEED` | `0` | Semeia pedidos e fila fictícios em banco vazio (demo pública) |
| `PULSO_SMTP_HOST`, `PULSO_SMTP_USUARIO`, `PULSO_SMTP_SENHA` | vazio | Canal de e-mail |
| `PULSO_TELEGRAM_BOT_TOKEN` | vazio | Canal Telegram |
| `PULSO_WHATSAPP_TOKEN`, `PULSO_WHATSAPP_PHONE_ID` | vazio | Canal WhatsApp Cloud API |
| `SENTRY_DSN`, `PULSO_LOG_JSON` | vazio / `0` | Erros e logs estruturados |
| `ALLOWED_ORIGINS` | origens locais | CORS do painel em desenvolvimento |

## Contrato do webhook

```http
POST /webhooks/pedidos
Content-Type: application/json
X-Pulso-Loja: minha-loja
X-Pulso-Marketplace: shopify
X-Pulso-Timestamp: 1762900000
X-Pulso-Evento: evt_123
X-Pulso-Assinatura: <hex hmac-sha256>

{"origem":"shopify","pedido_id":"BR-1042","status":"PAGO","valor":349.9,"cliente_nome":"Mariana Alves","evento_id":"evt_123"}
```

A assinatura é `HMAC-SHA256(segredo, timestamp + "." + corpo_bruto)` em hexadecimal. Exemplo para gerar e enviar:

```python
import hashlib, hmac, json, time, urllib.request

segredo = "segredo-da-integracao"          # visível em Integrações e segredos
corpo = json.dumps({
    "origem": "shopify", "pedido_id": "BR-1042", "status": "PAGO",
    "valor": 349.9, "cliente_nome": "Mariana Alves", "evento_id": "evt_123",
}).encode()
timestamp = str(int(time.time()))
assinatura = hmac.new(segredo.encode(), timestamp.encode() + b"." + corpo, hashlib.sha256).hexdigest()

requisicao = urllib.request.Request(
    "http://localhost:8000/webhooks/pedidos",
    data=corpo,
    headers={
        "Content-Type": "application/json",
        "X-Pulso-Loja": "minha-loja",
        "X-Pulso-Marketplace": "shopify",
        "X-Pulso-Timestamp": timestamp,
        "X-Pulso-Evento": "evt_123",
        "X-Pulso-Assinatura": assinatura,
    },
)
with urllib.request.urlopen(requisicao) as resposta:
    print(resposta.status, resposta.read().decode())
```

Reenvios com o mesmo `evento_id` respondem como duplicados e não alteram o pedido.

## API

- `POST /webhooks/pedidos` — recebe evento assinado.
- `GET /api/pedidos` — lista paginada com busca, status e período; `GET /api/pedidos/exportacao.csv` exporta o filtro atual.
- `GET /api/pedidos/{id}` — detalhe com histórico de eventos e alertas.
- `GET /api/stream` — SSE de atualizações em tempo real.
- `GET/POST /api/lojas`, `PATCH /api/lojas/{id}/configuracoes`, `POST /api/lojas/{id}/alertas/teste` — lojas e canais.
- `GET /api/lojas/{id}/alertas/envios` — fila de entrega com `status`, `tentativas`, próximo horário e erro (admin).
- `GET/POST /api/lojas/{id}/integracoes`, `POST /api/integracoes/{id}/rotacionar`, `DELETE /api/integracoes/{id}` — segredos por marketplace.
- `GET /api/notificacoes`, `POST /api/notificacoes/{id}/ler`, `POST /api/notificacoes/ler-todas`.
- `GET/POST /api/usuarios`, `PATCH /api/usuarios/{id}` — equipe (admin).
- `POST /api/auth/login`, `POST /api/auth/2fa`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/loja`.
- `POST /api/simular-webhook` — gera um evento de teste na loja ativa (admin).
- `GET /health`, `GET /metrics`, documentação interativa em `/docs`.

## Testes

### API · pytest

```bash
pip install -r requirements-dev.txt
python -m pytest -q      # 64 testes
```

Cobre autenticação, CSRF, 2FA, papéis, assinatura de webhook, idempotência, paginação, alertas, retentativa/dead-letter, retenção, migrações Alembic, métricas e rate limit, sempre em um SQLite temporário.

### E2E · Playwright

```bash
cd e2e
npm install
npx playwright test            # headless
npm run test:headed            # abre o Chrome para acompanhar
```

Pré-requisitos: Python com `requirements-dev.txt` instalado, Node 22+ e Chrome. O teste é autossuficiente:

- compila o painel e sobe a API em `127.0.0.1:8010` com um SQLite descartável (`e2e/e2e-pulso.db`, coberto pelo `.gitignore`);
- semeia pedidos via API autenticada, sem tocar no seu banco real nem exigir marketplace externo;
- valida o **login pela interface**, lista de pedidos, detalhe com histórico, painel de notificações e a fila de entrega;
- valida a chegada de um pedido novo **em tempo real via SSE**, sem recarregar a página;
- em falha, guarda trace e screenshot em `e2e/test-results/`.

Configuração em [`e2e/playwright.config.ts`](e2e/playwright.config.ts); o servidor de teste fica em [`e2e/servidor.mjs`](e2e/servidor.mjs).

## CI

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em cada push e pull request:

- **API** — instala `requirements-dev.txt` e executa a suíte pytest;
- **Painel** — `npm ci`, `npm run lint` e `npm run build` com cache de dependências;
- **E2E** — instala API + painel + Playwright e roda o fluxo principal no Chrome do runner.

## Segurança

- Senhas com **scrypt** (`n=16384, r=8, p=1`) e salt por usuário; comparação em tempo constante.
- Sessão em cookie `httpOnly` assinado com HMAC e expiração de 7 dias; `Secure` habilitado por ambiente.
- **CSRF double-submit** (`pulso_csrf` + header `X-Pulso-Csrf`) em toda escrita autenticada.
- **2FA TOTP** opcional por usuário, com cookie pendente de 5 minutos.
- Webhooks exigem assinatura HMAC, timestamp dentro da tolerância, origem coerente e `evento_id` único.
- Rate limit em login, 2FA e webhooks; memória local ou Redis.
- Papéis `admin`/`operador`, isolamento por loja e proteções para não deixar a loja sem administrador.
- Segredos de integração são gerados com `secrets.token_hex(24)` e podem ser rotacionados no painel.
- `.env`, banco local, backups e o arquivo de segredo de sessão estão no `.gitignore`.

## Deploy de demonstração

O mesmo Dockerfile serve API e painel, o que simplifica qualquer PaaS. A demo pública roda em um único serviço, sem banco externo:

1. **Render** — crie um Blueprint apontando para o repositório. O [`render.yaml`](render.yaml) sobe um serviço Docker com SQLite no próprio container e `PULSO_DEMO_SEED=1`. Preencha `PULSO_ADMIN_EMAIL` e `PULSO_ADMIN_SENHA` no dashboard com credenciais exclusivas de demonstração (nunca contas reais).
2. **Deploy automático** — copie o *deploy hook* do serviço no Render e salve como secret `RENDER_DEPLOY_HOOK` no GitHub. O workflow [`deploy-render.yml`](.github/workflows/deploy-render.yml) dispara um deploy a cada push na `main`.
3. **Dados de demonstração** — no primeiro boot de um banco vazio, a demo recebe 12 pedidos, 3 integrações com segredo, notificações e uma fila de entrega com um envio pendente e um dead-letter. Entre com o admin e abra **Simulador de webhook** para criar pedidos novos em tempo real via SSE.
4. **Alternativas** — Fly.io ou Railway funcionam com o mesmo `Dockerfile`, a porta de `$PORT` e um volume em `/dados` para persistir o SQLite.

> O plano free do Render não inclui disco persistente: cada restart ou deploy recria o SQLite e semeia a demonstração de novo, o que mantém o link limpo e sem custo. O serviço hiberna após 15 minutos sem acesso, então o primeiro carregamento pode levar cerca de um minuto. GitHub Pages não serve: ele só entrega arquivos estáticos e não executa FastAPI.

### Publicando no GitHub

O histórico já está dividido em commits por assunto (núcleo da API, segurança, alertas, frontend, testes, entrega e documentação) para facilitar a revisão do código.

```bash
git clone https://github.com/VictorStavarengo/pulso-webhooks.git
cd pulso-webhooks
docker compose up --build
```

Confirme que `.env`, `*.db` e `.pulso-sessao` não aparecem em `git status` — eles já estão ignorados.

## Prints do painel

| Login | Pedidos em tempo real |
| --- | --- |
| ![Login](docs/screenshots/01-login.png) | ![Dashboard](docs/screenshots/02-dashboard.png) |

| Detalhe do pedido | Notificações |
| --- | --- |
| ![Detalhe](docs/screenshots/03-pedido.png) | ![Notificações](docs/screenshots/04-notificacoes.png) |

| Equipe e acessos | Integrações assinadas |
| --- | --- |
| ![Equipe](docs/screenshots/05-equipe.png) | ![Integrações](docs/screenshots/06-integracoes.png) |

## Estrutura

```text
.
├── main.py                 # app FastAPI, middleware, serving do painel
├── config.py               # leitura de .env e configurações
├── security.py             # sessão, CSRF, scrypt, papéis
├── servicos.py             # assinatura, consolidação de eventos, notificações
├── equipe.py               # regras de usuários e lojas
├── routers/                # auth, lojas, pedidos, webhooks, notificacoes, usuarios, sistema
├── models.py / schemas.py  # SQLAlchemy e contratos Pydantic
├── alertas.py              # e-mail, Telegram, WhatsApp + retry/dead-letter
├── events.py               # hub SSE (memória/Redis)
├── ratelimit.py            # limite distribuído ou local
├── migrations.py           # preparação do banco no boot
├── alembic/                # migrações versionadas
├── tests/                  # suíte pytest
├── e2e/                    # Playwright: login, detalhe, notificações e SSE
├── frontend/               # painel React + Vite + Tailwind
├── docs/screenshots/       # prints usados neste README
├── Dockerfile
├── docker-compose.yml
├── render.yaml
└── .github/workflows/      # CI (pytest, lint/build, E2E) e deploy no Render
```

## Limitações conhecidas

- O hub SSE local atende um worker; para escalar horizontalmente use `REDIS_URL`.
- A fila de retentativa usa um lock em processo. Com vários workers, rode um worker dedicado ou troque o lock por Redis/advisory lock para não duplicar envios.
- Alertas WhatsApp dependem de template aprovado na Meta Cloud API.
- O expurgo remove logs de webhook e registros de envio, mas não pedidos: o histórico operacional é preservado.
- A demo no Render free usa SQLite em disco efêmero: reinícios limpam os dados e o primeiro acesso após hibernação pode levar cerca de um minuto.
- Não há integração OAuth pronta com marketplaces; a loja cadastra o endpoint e o segredo em **Integrações**.

## Licença

[MIT](LICENSE) © 2026 João Victor
