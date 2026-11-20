import { sameOrigin, SESSION_COOKIE, sessionTokenHash, tokenCookie } from "../../_discord-session.js";

export async function onRequest({ request, env }) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Método não permitido." }, {
      status: 405,
      headers: { ...headers, Allow: "POST" },
    });
  }
  if (!sameOrigin(request)) {
    return Response.json({ ok: false, error: "Origem inválida." }, { status: 403, headers });
  }

  const tokenHash = await sessionTokenHash(request);
  if (tokenHash) {
    try {
      await env.DB.prepare("DELETE FROM discord_sessions WHERE token_hash = ?").bind(tokenHash).run();
    } catch {
      return Response.json({ ok: false, error: "Sessão indisponível. Tente novamente." }, { status: 503, headers });
    }
  }
  headers["Set-Cookie"] = tokenCookie(SESSION_COOKIE, "", 0);
  return new Response(null, { status: 204, headers });
}
