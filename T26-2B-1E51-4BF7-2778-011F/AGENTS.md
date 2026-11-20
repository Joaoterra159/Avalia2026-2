# Documentação de Engenharia de Agentes e Harness (T26-2B-1E51-4BF7-2778-011F)

> **Requisito da Rubrica (25 pontos):** Uso obrigatório de no mínimo **3 agentes diferentes** (sendo obrigatoriamente **1 agente dedicado a teste e validação**), documentando em qual *harness* operaram e relacionando as *skills* na pasta `skills/`.

## 1. Ambiente de Orquestração (Harness Utilizado)

- **Harness Principal:** Codex com três subagentes em um workspace compartilhado.
- **Modelo(s) Base:** GPT-6 no agente principal. Os três subagentes herdaram o modelo e a configuração da sessão.
- **Estratégia de Coordenação:** O agente principal delegou Backend, Frontend e Testes em turnos independentes. Os agentes compartilharam o contrato das rotas de sessão e diagnóstico dentro da subpasta do Projeto 0.

---

## 2. Agentes Criados e Responsabilidades (Mínimo de 3 Agentes)

### Agente 1: Backend (`/root/backend`)
- **Papel:** Implementação da sessão no Cloudflare D1, do fluxo Discord OAuth2 e das validações nas Pages Functions.
- **Skill Utilizada:** [`skills/serverless-d1-discord/SKILL.md`](./skills/serverless-d1-discord/SKILL.md)
- **Entregas Realizadas:**
  - Implementação do `state` de uso único, da sessão com expiração e revogação e da migração `0002_discord_sessions.sql`.
  - Associação dos pings à identidade da sessão e consulta por usuário e projeto.

### Agente 2: Frontend (`/root/frontend`)
- **Papel:** Construção da interface responsiva e acessível utilizando exclusivamente HTML5 semântico, CSS3 moderno (sem sombras em fontes) e JavaScript puro (Vanilla JS), consumindo as rotas serverless via `fetch`.
- **Skill Utilizada:** [`skills/vanilla-dom-ui/SKILL.md`](./skills/vanilla-dom-ui/SKILL.md)
- **Entregas Realizadas:**
  - Integração do login, perfil, logout e pings autenticados em `public/index.html`, `public/styles.css` e `public/app.js`.
  - Verificação de três fluxos de interface com DOM e `fetch` simulados.

### Agente 3: Agente de Teste, Auditoria de Segurança e Validação (`/root/testes`)
- **Papel:** Validação independente do contrato HTTP, das migrações e do isolamento entre usuários.
- **Skill Utilizada:** [`skills/teste-validacao/SKILL.md`](./skills/teste-validacao/SKILL.md)
- **Entregas Realizadas:**
  - Suíte de regressão em `testar-oauth-local.mjs` com as Functions reais, SQLite e respostas simuladas do Discord.
  - Evidências e limites da validação em [TESTES.md](./TESTES.md).
