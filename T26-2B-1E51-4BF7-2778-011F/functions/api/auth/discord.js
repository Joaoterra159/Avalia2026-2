import {
  authRedirect,
  CALLBACK_PATH,
  discordConfigured,
  hashToken,
  nowSeconds,
  randomToken,
  STATE_COOKIE,
  STATE_LIFETIME,
  tokenCookie,
} from "../../_discord-session.js";

export async function onRequestGet({ request, env }) {
  if (!discordConfigured(env)) {
    return authRedirect("/?auth_error=missing_credentials");
  }
  if (!env.DB) {
    return authRedirect("/?auth_error=session_unavailable");
  }

  const state = randomToken();
  const now = nowSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM discord_oauth_states WHERE expires_at <= ?").bind(now),
      env.DB.prepare("INSERT INTO discord_oauth_states (state_hash, expires_at) VALUES (?, ?)")
        .bind(await hashToken(state), now + STATE_LIFETIME),
    ]);
  } catch {
    return authRedirect("/?auth_error=session_unavailable");
  }

  const redirectUri = new URL(CALLBACK_PATH, request.url).href;
  const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify");

  authorizeUrl.searchParams.set("state", state);
  return authRedirect(authorizeUrl.href, [tokenCookie(STATE_COOKIE, state, STATE_LIFETIME)]);
}
