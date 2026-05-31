# Security Fix Report

## Arquitetura Encontrada

- Frontend: Vite + React + TypeScript, publicado como SPA estatica na Vercel.
- Backend: Node.js + Express + TypeScript, separado do frontend e publicado no Render via Docker.
- API routes/serverless na Vercel: nao encontradas.
- Swagger/OpenAPI, GraphQL, admin e debug: nao encontrados como funcionalidades reais no codigo.

## Vulnerabilidades Corrigidas

| ID | Arquivos alterados | Como foi corrigida | Como testar |
| --- | --- | --- | --- |
| URL_002 | `vercel.json`, `backend/src/server.ts` | Vercel recebe HSTS em producao e o backend Express redireciona `x-forwarded-proto=http` para HTTPS sem afetar localhost. | `curl -I https://videouniversal.vercel.app/` e testar HTTP apos redeploy. |
| HEAD_002 | `vercel.json`, `backend/src/server.ts` | Adicionada Content-Security-Policy global. A CSP foi endurecida sem `unsafe-inline` e sem `unsafe-eval`, mantendo Google Fonts e backend oficial. | `curl -I https://videouniversal.vercel.app/` |
| HEAD_003 | `vercel.json`, `backend/src/server.ts` | Adicionado `X-Frame-Options: DENY` e `frame-ancestors 'none'`. | `curl -I https://videouniversal.vercel.app/` |
| HEAD_004 | `vercel.json`, `backend/src/server.ts` | Adicionado `X-Content-Type-Options: nosniff`. | `curl -I https://videouniversal.vercel.app/` |
| HEAD_005 | `vercel.json`, `backend/src/server.ts` | Adicionado `Referrer-Policy: strict-origin-when-cross-origin`. | `curl -I https://videouniversal.vercel.app/` |
| HEAD_008 | `vercel.json`, `backend/src/server.ts` | Adicionado `Permissions-Policy` bloqueando camera, microfone, geolocalizacao, pagamento, USB, Bluetooth e sensores. | `curl -I https://videouniversal.vercel.app/` |
| CORS_001 | `backend/src/server.ts`, `render.yaml` | Removida permissao ampla para previews Vercel. CORS agora usa `ALLOWED_ORIGINS`, permite localhost apenas fora de producao, limita metodos e headers, e nunca usa wildcard. | `curl -i -H "Origin: https://evil.example" https://videouniversal-backend.onrender.com/api/health` |
| API_001 | `vercel.json`, `backend/src/server.ts` | Rotas `/swagger`, `/api-docs`, `/docs`, `/openapi`, `/openapi.json` e `/swagger.json` retornam 404. | `curl -i https://videouniversal.vercel.app/swagger` |
| API_002 | `vercel.json`, `backend/src/server.ts` | `/graphql` retorna 404. Nao havia servidor GraphQL ou dependencias GraphQL no projeto. | `curl -i https://videouniversal.vercel.app/graphql` |
| AUTHZ_001 | `vercel.json`, `backend/src/server.ts` | Rotas administrativas reservadas no backend exigem Bearer token ou `X-Admin-Token`; sem token retorna 401 e token invalido retorna 403. Na Vercel, rotas admin da SPA retornam 403. | `curl -i https://videouniversal.vercel.app/admin` e `curl -i https://videouniversal-backend.onrender.com/admin` |
| API_003 | `vercel.json`, `backend/src/server.ts` | Rotas de debug/status/teste/diagnostico retornam 404. Healthcheck ficou minimo: `{ "ok": true }`. | `curl -i https://videouniversal-backend.onrender.com/api/health` |
| SECRET_004 | `.gitignore`, `backend/.dockerignore`, `backend/.env.example`, `frontend/.env.example`, `vercel.json`, `backend/src/server.ts` | Arquivos sensiveis foram adicionados ao ignore, exemplos de env ficaram sem valores reais, rotas de arquivos sensiveis retornam 404 antes do fallback da SPA e no backend. | `curl -i https://videouniversal.vercel.app/.env` |

## Outras Alteracoes

- `frontend/src/main.tsx`: o fluxo de download deixou de usar iframe oculto, evitando conflito com headers de frame mais restritivos.
- `frontend/src/main.tsx` e `frontend/src/styles.css`: mantidas as alteracoes visuais solicitadas antes, com logo maior acima do titulo.
- `README.md`: documentado `ALLOWED_ORIGINS`, `ADMIN_TOKEN` e o retorno minimo do healthcheck.
- `backend/src/server.ts`: adicionado handler JSON para 404 e erro generico em producao sem stack trace na resposta.
- `backend/src/server.ts`: `x-powered-by` desabilitado.

## Checklist Manual de Producao

Validar headers globais:

```bash
curl -I https://videouniversal.vercel.app/
```

Verificar se aparecem:

```text
content-security-policy
x-frame-options
x-content-type-options
referrer-policy
permissions-policy
strict-transport-security
```

Testar bloqueio de `.env`:

```bash
curl -i https://videouniversal.vercel.app/.env
curl -i https://videouniversal-backend.onrender.com/.env
```

Resultado esperado: 404 ou 403, nunca conteudo do arquivo.

Testar CORS na Vercel e no backend:

```bash
curl -i -H "Origin: https://evil.example" https://videouniversal.vercel.app/api/ALGUMA_ROTA
curl -i -H "Origin: https://evil.example" https://videouniversal-backend.onrender.com/api/health
curl -i -H "Origin: https://videouniversal.vercel.app" https://videouniversal-backend.onrender.com/api/health
```

Resultado esperado:

- Origem maliciosa nao deve receber `Access-Control-Allow-Origin: *`.
- Backend deve retornar 403 para origem maliciosa.
- Origem oficial deve receber `Access-Control-Allow-Origin: https://videouniversal.vercel.app`.

Testar docs:

```bash
curl -i https://videouniversal.vercel.app/swagger
curl -i https://videouniversal.vercel.app/api-docs
curl -i https://videouniversal.vercel.app/openapi.json
curl -i https://videouniversal-backend.onrender.com/swagger
curl -i https://videouniversal-backend.onrender.com/api-docs
curl -i https://videouniversal-backend.onrender.com/openapi.json
```

Resultado esperado em producao: 404.

Testar admin:

```bash
curl -i https://videouniversal.vercel.app/admin
curl -i https://videouniversal-backend.onrender.com/admin
curl -i -H "Authorization: Bearer token-invalido" https://videouniversal-backend.onrender.com/admin
```

Resultado esperado:

- Vercel: 403.
- Backend sem token: 401.
- Backend com token invalido ou sem `ADMIN_TOKEN` configurado: 403.

Testar healthcheck minimo:

```bash
curl -i https://videouniversal-backend.onrender.com/api/health
```

Resultado esperado:

```json
{ "ok": true }
```

## Validacao Local Executada

- `npm run build` em `backend`: passou.
- `npm run build` em `frontend`: passou.
- Teste runtime temporario do backend:
  - `/api/health` retornou `{"ok":true}`.
  - `/.env` retornou 404.
  - `/admin` retornou 401.
  - CORS com `Origin: https://evil.example` retornou 403.
  - CORS com `Origin: https://videouniversal.vercel.app` retornou origem oficial.

## Pendencias Manuais

- Fazer redeploy do frontend na Vercel para aplicar `vercel.json`.
- Fazer redeploy do backend no Render para aplicar os middlewares e `render.yaml`.
- Configurar no Render:
  - `ALLOWED_ORIGINS=https://videouniversal.vercel.app`
  - `ADMIN_TOKEN` com valor forte se alguma rota administrativa real for adicionada.
- Confirmar que qualquer dominio customizado e subdominios suportam HTTPS antes de manter HSTS com `includeSubDomains; preload`.
- Se houve algum segredo real commitado antes deste hardening, rotacionar fora do codigo e limpar historico do Git.

## Secrets Para Rotacionar

Nenhum segredo real rastreado foi identificado nos arquivos do projeto analisados. Arquivos locais ignorados, como `.vercel/.env.production.local`, nao foram impressos nem adicionados ao relatorio e devem permanecer fora do Git.
