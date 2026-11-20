import {
  authRedirect,
  CALLBACK_PATH,
  discordConfigured,
  hashToken,
  nowSeconds,
  randomToken,
  SESSION_COOKIE,
  SESSION_LIFETIME,
  sessionTokenHash,
  STATE_COOKIE,
  readToken,
  tokenCookie,
} from "../../../_discord-session.js";

export async function onRequestGet({ request, env }) {
  const { searchParams } = new URL(request.url);
  const state = readToken(request, STATE_COOKIE);
  const clearState = tokenCookie(STATE_COOKIE, "", 0);
  const fail = (reason) => authRedirect("/?auth_error=" + reason, [clearState]);

  if (!state || searchParams.getAll("state").length !== 1 || searchParams.get("state") !== state) {
    return authRedirect("/?auth_error=invalid_state");
  }
  if (!discordConfigured(env)) return fail("missing_credentials");
  if (!env.DB) return fail("session_unavailable");

  try {
    const consumed = await env.DB.prepare(
      "DELETE FROM discord_oauth_states WHERE state_hash = ? AND expires_at > ?"
    ).bind(await hashToken(state), nowSeconds()).run();
    if (consumed.meta.changes !== 1) return fail("invalid_state");
  } catch {
    return fail("session_unavailable");
  }

  if (searchParams.has("error")) return fail("discord_denied");
  const code = searchParams.get("code");
  if (!code || searchParams.getAll("code").length !== 1) return fail("missing_code");

  let userId;
  let username;
  let avatar;
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: new URL(CALLBACK_PATH, request.url).href,
      }),
    });
    if (!tokenRes.ok) return fail("token_exchange_failed");
    const { access_token: accessToken } = await tokenRes.json();
    if (typeof accessToken !== "string" || !accessToken) return fail("token_exchange_failed");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return fail("fetch_user_failed");

    const discordUser = await userRes.json();
    userId = discordUser.id;
    username = discordUser.global_name || discordUser.username;
    if (typeof userId !== "string" || !/^\d{1,20}$/.test(userId) ||
        typeof username !== "string" || !username.trim()) {
      return fail("fetch_user_failed");
    }
    avatar = typeof discordUser.avatar === "string" && /^(?:a_)?[0-9a-f]{32}$/.test(discordUser.avatar)
      ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.png`
      : "https://cdn.discordapp.com/embed/avatars/0.png";
  } catch {
    return fail("exception");
  }

  try {
    const token = randomToken();
    const now = nowSeconds();
    const previousTokenHash = await sessionTokenHash(request);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM discord_sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM discord_sessions WHERE token_hash = ?").bind(previousTokenHash),
      env.DB.prepare(
        "INSERT INTO discord_users (user_id, username, avatar) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, " +
        "updated_at = CURRENT_TIMESTAMP"
      ).bind(userId, username, avatar),
      env.DB.prepare("INSERT INTO discord_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(await hashToken(token), userId, now + SESSION_LIFETIME),
    ]);

    return authRedirect("/?login=success", [
      clearState,
      tokenCookie(SESSION_COOKIE, token, SESSION_LIFETIME),
    ]);
  } catch {
    return fail("session_unavailable");
  }
}
