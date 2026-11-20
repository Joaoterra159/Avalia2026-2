# Validação local do Discord OAuth2 no Projeto 0

O agente `testes` executou a suíte em 20 de novembro de 2026, no harness Codex, com o skill [teste-validacao](skills/teste-validacao/SKILL.md). A suíte chama os handlers reais de Cloudflare Pages Functions. Ela aplica as migrações SQL em SQLite em memória, usa um adaptador da interface D1 e simula as respostas HTTPS do Discord com dois perfis fictícios.

```powershell
node --test testar-oauth-local.mjs
```

Execução com Node.js `v26.13.1`, código de saída `0`. O executor relatou 9 testes aprovados, 0 falhas e 0 ignorados.

| Teste | Evidência observada |
| --- | --- |
| Login OAuth2 | Redirecionamento com `state`, callback com sessão, perfil recuperado no diagnóstico e hash SHA-256 do token salvo no SQLite. Os cookies testados usam `__Host-`, `Secure`, `HttpOnly`, `SameSite` e `Path=/`. |
| Validação de `state` | Valores ausentes, divergentes, expirados ou reutilizados foram recusados antes de uma troca de código com o Discord simulado. |
| Cookie de sessão inválido | Token alterado, malformado ou ausente não retornou perfil nem registros. `POST /api/status` devolveu `401` sem gravação. |
| Expiração da sessão | Após ajustar `expires_at` no banco local, o perfil deixou de ser exibido e o registro de ping retornou `401`. |
| Logout | `POST /api/auth/logout` devolveu `204`, limpou o cookie com `Max-Age=0` e revogou a sessão no banco. A repetição devolveu `204`, e a sessão do outro perfil continuou ativa. |
| Isolamento e pings | Os dois perfis receberam listas e contagens próprias. A consulta sem sessão retornou lista vazia. A identidade gravada veio da sessão apesar dos campos adicionais do cliente, e um ping com conteúdo vazio retornou `400`. |
| Origem externa | Os dois endpoints de escrita devolveram `403` ao receber `Origin` externo. A sessão continuou ativa e nenhum ping foi inserido. |
| Métodos HTTP | `PUT`, `PATCH` e `DELETE` de status e `GET` de logout devolveram `405` com o cabeçalho `Allow`. |
| Migração incremental | O registro criado com o esquema `0001` permaneceu idêntico após aplicação da migração `0002`. |

A execução cobriu o fluxo com dados sintéticos. A autenticação com uma conta real do Discord e o banco remoto Cloudflare D1 ficaram fora desta execução local.

## Verificações adicionais

- O comando `node validar-local.mjs T26-2B-1E51-4BF7-2778-011F`, executado na raiz do repositório, marcou os oito critérios locais como OK. O item 9, deploy online, ficou pendente.
- O Wrangler `4.165.0` aplicou `0001_init.sql` e `0002_discord_sessions.sql` com `wrangler d1 migrations apply DB --local`.
- O agente principal executou as Functions pelo `wrangler pages dev` com o mesmo D1 local. `GET /api/status` confirmou a conexão e retornou zero registros para o visitante. `POST /api/status` retornou `401` sem sessão, e `POST /api/auth/logout` retornou `204`.
- O agente Frontend verificou três fluxos com DOM e `fetch` simulados no Node: erro no callback, perfil com ping e logout, e sessão expirada.
