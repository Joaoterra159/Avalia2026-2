import { discordConfigured, findSessionUser, nowSeconds, sameOrigin, sessionTokenHash } from "../_discord-session.js";

const chave = "T26-2B-1E51-4BF7-2778-011F";
const projectId = 0;
const projectTitle = "Projeto 0 (Teste de Ambiente e Entrega — Sem Nota): Painel de Diagnóstico Cloudflare + D1 + Discord";

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function unauthorized() {
  return json({ ok: false, error: "Entre com Discord para registrar um ping." }, 401);
}

async function readStatus(request, env) {
  let d1Connected = false;
  let sessionUser = null;
  let totalRegistros = 0;
  let ultimosRegistros = [];

  if (env.DB) {
    try {
      const user = await findSessionUser(env.DB, await sessionTokenHash(request));
      if (user) {
        const [count, records] = await env.DB.batch([
          env.DB.prepare("SELECT COUNT(*) AS total FROM project_records WHERE chave_projeto = ? AND user_id = ?")
            .bind(chave, user.userId),
          env.DB.prepare(
            "SELECT id, user_id, username, conteudo, created_at FROM project_records " +
            "WHERE chave_projeto = ? AND user_id = ? ORDER BY id DESC LIMIT 10"
          ).bind(chave, user.userId),
        ]);
        totalRegistros = Number(count.results[0].total);
        ultimosRegistros = records.results;
        sessionUser = user;
      } else {
        await env.DB.prepare("SELECT 1 FROM project_records LIMIT 1").first();
      }
      d1Connected = true;
    } catch {
      // O diagnóstico permanece disponível mesmo quando o D1 falha.
    }
  }

  return json({
    ok: true,
    chave,
    projectId,
    projectTitle,
    d1Connected,
    discordOAuthConfigured: discordConfigured(env),
    sessionUser,
    totalRegistros,
    ultimosRegistros,
    serverTimestamp: new Date().toISOString(),
  });
}

async function savePing(request, env) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Origem inválida." }, 403);
  const tokenHash = await sessionTokenHash(request);
  if (!tokenHash) return unauthorized();

  try {
    if (!await findSessionUser(env.DB, tokenHash)) return unauthorized();

    const body = await request.json().catch(() => null);
    const conteudo = typeof body?.conteudo === "string" ? body.conteudo.trim() : "";
    if (!conteudo || conteudo.length > 500) {
      return json({ ok: false, error: "Informe um conteúdo de 1 a 500 caracteres." }, 400);
    }

    const inserted = await env.DB.prepare(
      "INSERT INTO project_records (user_id, username, chave_projeto, conteudo) " +
      "SELECT u.user_id, u.username, ?, ? FROM discord_sessions s " +
      "JOIN discord_users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
    ).bind(chave, conteudo, tokenHash, nowSeconds()).run();
    if (inserted.meta.changes !== 1) return unauthorized();
  } catch {
    return json({ ok: false, error: "Não foi possível registrar o ping no D1." }, 503);
  }

  return json({ ok: true, saved: true, chave, serverTimestamp: new Date().toISOString() }, 201);
}

export async function onRequest({ request, env }) {
  if (request.method === "GET") return readStatus(request, env);
  if (request.method === "POST") return savePing(request, env);
  return json({ ok: false, error: "Método não permitido." }, 405, { Allow: "GET, POST" });
}
