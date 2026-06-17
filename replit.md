# Workout App — Projeto

## Visão Geral

Monorepo pnpm com dois artefatos principais:

- **`artifacts/workout/`** — app web single-page (vanilla HTML/CSS/JS, `index.html`)
- **`artifacts/api-server/`** — proxy Express/TypeScript para GIFs de exercícios

---

## Stack

| Camada | Tecnologia |
|---|---|
| Monorepo | pnpm workspaces |
| Node.js | 24 |
| Package manager | pnpm |
| TypeScript | 5.9 |
| API framework | Express 5 |
| Build | esbuild |

## Comandos principais

```bash
pnpm --filter @workspace/api-server run dev   # inicia o servidor de API (porta 8080)
pnpm --filter @workspace/workout run dev      # inicia o app web
```

---

## App de Treino (`artifacts/workout/index.html`)

SPA vanilla JS com máquina de estado simples (`S.screen`). Todo o estado do usuário fica em `localStorage` — sem conta/servidor necessário.

### Telas (`S.screen`)

| Valor | Tela |
|---|---|
| `home` | Home com perfil, mini-calendário e check-in |
| `lib` | Lista de treinos prontos (WDB) |
| `setup` | Montagem de treino personalizado |
| `workout` | Execução de treino (blocos + séries) |
| `cal` | Calendário completo de check-ins |
| `legit` | Tela de curadoria de GIFs (Legitimar) |
| `profile` | Edição de perfil |

### Perfil e Check-in

- Perfil local: nome + foto base64 em `localStorage` (`wk_profile`)
- Check-in: salva data em `wk_ci`; o dia aparece no mini-calendário da home
- Calendar view: cada dia pode receber título e calorias; dias com entry são destacados

### Navegação

- Toda mudança de tela chama `navTo(s)` ou inclui `window.scrollTo(0,0)` explicitamente
- Ao voltar de um treino pronto (`S.isPre === true`), o ← retorna para `lib`; de treino montado, retorna para `home`

### Dados de exercícios

- **`WDB`** — array de 33 treinos prontos (definido inline em `index.html`, linha ~594)
- **`GEN`** — objeto com exercícios por modalidade: `musculacao`, `core`, `cardio`, `metabolico`, `funcional`, `crossfit`, `equilibrio` (linha ~472)
- Total: ~254 exercícios únicos não-cardio

---

## Servidor de API (`artifacts/api-server/`)

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/exercise-media?name=` | Busca GIF/imagem para um exercício |
| GET | `/api/exercise-media/gif/:id` | Proxy de GIF do WorkoutX (com fallback) |
| GET | `/api/exercise-media/candidates?q=` | Lista candidatos para curadoria |
| POST | `/api/exercise-media/override` | Define/limpa curadoria manual (override) |
| POST | `/api/exercise-media/custom-url` | Define/limpa URL personalizada |
| GET | `/api/exercise-media/_status` | Status do cache |

### Prioridade de resolução de GIF

```
1. Override manual (overrides.json)      → source: "override"
2. URL personalizada (custom-urls.json)  → source: "custom"
3. Cache auto (WorkoutX API)             → source: "auto"
4. Sem match                             → source: "miss"
```

> **Nota:** Ao salvar uma URL personalizada via UI ("Salvar URL" no Legitimar), o override existente é automaticamente removido para que a URL entre em vigor.

### Arquivos de dados (`artifacts/api-server/data/`)

| Arquivo | Descrição |
|---|---|
| `exercise-media-custom-urls.json` | 254 URLs do liftmanual.com (chaves normalizadas) |
| `exercise-media-overrides.json` | Curadoria manual via Legitimar (ID do exercício) |
| `exercise-media-cache.json` | Cache de resoluções automáticas (~183 entradas) |
| `exercise-translations.json` | 244 traduções PT→EN para melhorar o auto-match |
| `liftmanual-slugs.txt` | 2465 slugs disponíveis no liftmanual.com |

### Normalização de chaves (`normKey`)

Todos os arquivos de dados usam chaves normalizadas com a mesma função:

```typescript
s.toLowerCase()
 .normalize("NFD")
 .replace(/[\u0300-\u036f]/g, "")   // remove acentos
 .replace(/[^a-z0-9 ]/g, " ")       // /°() → espaço
 .replace(/\s+/g, " ")
 .trim()
```

**Importante:** qualquer chave adicionada manualmente aos arquivos `.json` deve seguir este formato.

### Fallback de GIFs (sem API key)

O proxy `/api/exercise-media/gif/:id` funciona assim quando `WORKOUTX_API_KEY` não está configurada:
1. Verifica disco (`gif-cache/`)
2. Verifica `fallbackUrl` no cache (URL liftmanual.com preservada para os 6 overrides iniciais)
3. Retorna 503

### Scripts utilitários (`scripts/src/`)

- **`fetch-liftmanual-gifs.mjs`** — scrape liftmanual.com para popular `exercise-media-custom-urls.json`. Usa `GET + Range: bytes=0-0` para verificar existência de imagem (Cloudflare bloqueia HEAD). Rate limit: ~29 req antes do 429 — aguardar alguns minutos entre execuções em lote.

---

## Tela de Curadoria (Legitimar)

Acessível via Home → "Legitimar GIFs". Lista todos os ~254 exercícios não-cardio com:

- **Badges de status:** Auto / Manual / URL / Sem match
- **Filtros:** All / Sem match / Auto / Manual / URL
- **Por exercício:** GIF atual, URL personalizada, busca por candidatos, pick manual
- **Salvar URL:** ao salvar uma URL, o override existente é automaticamente removido

---

## Variáveis de Ambiente

| Variável | Uso |
|---|---|
| `WORKOUTX_API_KEY` | Chave para WorkoutX API (busca automática de GIFs). Opcional — sem ela, apenas liftmanual.com e overrides com fallback funcionam. |
| `PORT` | Porta do servidor (padrão 8080) |

---

## User Preferences

- App language: Portuguese (PT) by default, toggleable to EN via top-right toggle.
- Orange accent: `#E8550A`. Background: `#171410`.
