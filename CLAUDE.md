# MetaSplit

SaaS de **split test de tráfego** para infoprodutos. Gera um redirect HTML
que distribui visitantes entre múltiplas ofertas com pesos configuráveis,
captura cliques e cruza vendas (via webhook Payt) para mostrar qual
variação converte melhor.

URL de produção: <https://metasplit.online>

---

## Stack técnica

- **Runtime:** Node.js (≥ 22 — usa `node:sqlite` nativo) + Express 4
- **Banco:** SQLite via `node:sqlite` (módulo built-in, sem nativos C++)
- **Frontend:** Vanilla JS + CSS (sem framework, sem build step) servido
  estaticamente de `public/`
- **Hospedagem:** VPS Hostinger, deploy via `git pull` no servidor
- **Domínio:** `metasplit.online` (Cloudflare → Nginx → Node em :3000)

Dependências runtime: apenas `express` e `cors`. O parser SQLite é nativo
do Node 22 — não há `better-sqlite3`, `sqlite3` ou similares para evitar
problemas de build em hospedagem compartilhada.

---

## Arquitetura

```
splittrack/
├── server.js          # API Express + webhook + geração de redirect
├── database.js        # Schema SQLite + helper de transação
├── package.json
├── public/
│   ├── index.html     # SPA shell (sidebar + main)
│   ├── app.js         # Router por hash + todas as views
│   ├── style.css      # Tema claro/escuro
│   └── favicon.svg
└── splittrack.db      # SQLite (fica fora do repo via .gitignore)
```

O banco mora **um nível acima** do diretório do app por padrão
(`path.join(__dirname, '..', 'splittrack.db')`) — isso protege o banco
de ser sobrescrito por um `git pull --force`. Pode ser sobrescrito com a
env var `DB_PATH`.

---

## Fluxo do split test

1. Usuário cria uma campanha com **N destinos** (1–4), cada um com:
   - `url` da oferta
   - `src` (parâmetro UTM que identifica a variação, ex.: `src=pv3`)
   - `weight` (% do tráfego — total deve somar 100)

2. Usuário clica em **Gerar Redirect** → o servidor devolve um HTML
   estático ofuscado contendo a lógica:
   ```js
   wrand(D)  // sorteio ponderado entre os destinos
   ```
   O HTML faz `window.location.replace(url)` **antes** de chamar o
   tracking via `fetch(... , { keepalive: true })`. Isso elimina spinner
   e o usuário não percebe o split.

3. Esse `index.html` é hospedado no domínio do cliente (ex.:
   `bonus-x.com/index.html`). Quando alguém acessa, é redirecionado para
   uma das ofertas e o clique é registrado no MetaSplit.

4. Quando a venda é fechada, a Payt dispara o webhook `/webhook/payt` com
   o `src` capturado no checkout. O MetaSplit cruza esse `src` com o
   destino cadastrado e atribui a venda à variação correta.

### Algoritmo de distribuição

Sorteio ponderado simples no client: soma os pesos, gera `Math.random() *
total`, percorre os destinos subtraindo até zerar. Tem desvio para 50/50
em volumes baixos — é estatisticamente correto, não viciado.

---

## Integração Payt — webhook V1 Flat

A Payt envia POST em **dois formatos** que coexistem (depende do produto
e da versão do postback). O parser em `extractPaytFields()` aceita ambos.

### Formato V1 Flat (atual)

Todos os campos vêm na **raiz do JSON** com chaves contendo pontos
literais (não nested). Exemplo:

```json
{
  "transaction_id": "TXN-12345",
  "commission.1.amount": 14790,
  "product.price": 19700,
  "transaction.total_price": 22700,
  "status": "approved",
  "product.name": "Produto X",
  "link.sources.src": "pv3",
  "customer.email": "joao@email.com"
}
```

Campos relevantes:

| Chave Payt                | Significado                                                  |
|---------------------------|--------------------------------------------------------------|
| `transaction_id`          | ID externo (idempotência)                                    |
| `commission.1.amount`     | **Valor real** que entra para o produtor (centavos ÷ 100)    |
| `product.price`           | Fallback caso `commission.1.amount` não venha (centavos ÷100)|
| `transaction.total_price` | Total da transação **incluindo order bumps** — NÃO usar      |
| `status`                  | `approved` / `paid` / `refunded` / `chargeback` / `cancelled` / `canceled` / `expired` |
| `product.name`            | Nome do produto                                              |
| `link.sources.src`        | **Campo principal** com o `src`                              |
| `customer.email`          | E-mail do comprador                                          |

> ⚠ Em JS, acessar `body['commission.1.amount']` (com colchetes) — não
> funciona com notação ponto. O índice `.1` é da Payt (1-based), aponta
> para a comissão do produtor (`commission.1.type === "producer"`).
>
> ⚠ `transaction.total_price` foi a fonte do valor antes da fix de
> 2025: ele soma order bumps e infla o faturamento. Hoje serve só como
> referência informativa.

### Formato V1 Nested (legado)

```json
{
  "id": "TXN-12345",
  "total": 197.00,
  "status": "approved",
  "product": { "name": "Produto X" },
  "utm": { "src": "pv3" },
  "customer": { "email": "joao@email.com" }
}
```

### Mapa de status

Convertido em `STATUS_MAP` para um conjunto canônico. **Apenas vendas
cujo status normalizado seja `approved` (incluindo `paid`, que é
mapeado para `approved`) são gravadas.** Qualquer outro status faz o
webhook responder `{ action: 'skipped', reason: 'status_ignored:<x>' }`
sem tocar no banco — nada é inserido nem atualizado.

| Recebido                                | Normalizado  | Gravado? |
|-----------------------------------------|--------------|:--------:|
| `approved` / `paid` / `aprovada` / `finalizada` / `complete` / `sale.approved` | `approved`   | ✅ |
| `refunded` / `reembolsada` / `sale.refunded`                                   | `refunded`   | ❌ |
| `chargeback` / `sale.chargeback`                                               | `chargeback` | ❌ |
| `cancelled` / `canceled` / `cancelada` / `sale.cancelled`                      | `cancelled`  | ❌ |
| `expired` / `expirada` / `sale.expired`                                        | `expired`    | ❌ |

Constante única em `server.js`:

```js
const APPROVED_STATUSES = ['approved', 'paid'];
```

Usada como porta de entrada do webhook **e** em todas as queries de
agregação. Status fora dessa lista nem chega ao banco.

### Idempotência

Cada venda é deduplicada por `external_id` (transaction_id). Se chega um
segundo evento com o mesmo ID **e** ele também é approved/paid, o
registro existente é atualizado com os novos valores de status e amount.
Eventos de cancelamento/expiração para um external_id já gravado são
descartados (a venda permanece aprovada — gerenciamento de chargeback é
responsabilidade da Payt).

### Filtro de bots no tracking

`/api/track/:id` rejeita silenciosamente requisições cujo User-Agent:
- está vazio ou tem menos de 15 caracteres
- não começa com `Mozilla/`
- bate com `BOT_UA_REGEX` (Googlebot, curl, axios, headless, etc.)

A função é `isLikelyBot(ua)` em `server.js`. Bot detectado retorna
`{ ignored: 'bot' }` sem inserir o clique.

---

## Banco SQLite

Schema em `database.js`. Cinco tabelas:

```sql
campaigns       -- nome, domain_url, utmify_dashboard_id
destinations    -- campaign_id, url, src, weight, sort_order
clicks          -- campaign_id, destination_id, params, ip, user_agent, referrer, created_at
sales           -- campaign_id, destination_id, external_id, status, amount, src, ...
settings        -- key/value (utmify_token, etc.)
```

PRAGMA usados: `journal_mode = WAL` (concorrência leitura/escrita) e
`foreign_keys = ON` (ON DELETE CASCADE de campaigns → destinations/clicks).

**Importante:** o app usa `db.exec('BEGIN/COMMIT/ROLLBACK')` manualmente
porque `node:sqlite` não tem o helper `db.transaction(fn)` do
better-sqlite3. O wrapper está em `transaction(fn)` em `database.js`.

---

## Endpoints principais

| Método | Path                            | Descrição                                |
|--------|---------------------------------|------------------------------------------|
| GET    | `/api/campaigns`                | Lista (com totais agregados)             |
| POST   | `/api/campaigns`                | Cria campanha                            |
| GET    | `/api/campaigns/:id`            | Detalhe + destinations                   |
| PUT    | `/api/campaigns/:id`            | Atualiza                                 |
| DELETE | `/api/campaigns/:id`            | Deleta (CASCADE)                         |
| DELETE | `/api/campaigns/:id/reset`      | Zera clicks + sales (mantém config)      |
| GET    | `/api/campaigns/:id/generate`   | Baixa o `index.html` redirect            |
| GET    | `/api/campaigns/:id/stats`      | Stats (período, destinos, vendas, …)     |
| POST   | `/api/track/:id`                | Tracking de cliques (filtro de bot)      |
| POST   | `/webhook/payt`                 | Webhook Payt V1 Flat / Nested            |
| GET/POST | `/api/settings`               | Config (Utmify token, etc.)              |

---

## Deploy Hostinger via GitHub

1. **Push** local → `origin/main` no GitHub
   (`https://github.com/contatometadrive-sudo/metasplit`).

2. **Servidor (Hostinger VPS):**
   ```bash
   cd ~/metasplit-deploy/splittrack
   git pull origin main
   npm install --production    # se package.json mudou
   pm2 restart metasplit       # ou systemd
   ```

3. **Estrutura no servidor:**
   ```
   ~/metasplit-deploy/
   ├── splittrack/         # working tree do git
   └── splittrack.db       # banco persistente, FORA do repo
   ```
   O `DB_PATH` aponta para `../splittrack.db` por padrão — não é
   sobrescrito por `git pull`.

4. **Nginx** faz reverse proxy de `metasplit.online:443` → `localhost:3000`.

5. **Cloudflare** na frente para SSL e cache.

> Nunca rode `npm install` em prod sem `--production` (instala dev deps
> sem necessidade). E nunca rode migrations destrutivas — o schema é
> idempotente (`CREATE TABLE IF NOT EXISTS`).

---

## Convenções

- **Sem comentários óbvios.** O código fala. Comentário só para *por quê*
  não trivial (workaround, invariante escondido).
- **Sem build step.** Frontend é vanilla — qualquer mudança em
  `public/app.js` é puro JS, recarrega na hora.
- **Sem TypeScript.** Não vale a pena para o tamanho do projeto.
- **Tema escuro** persiste em `localStorage.theme`.
- **Datas** sempre em formato `pt-BR` no UI, ISO no banco.
- **Valores monetários** sempre em `BRL` formatados via `Intl.NumberFormat`.
