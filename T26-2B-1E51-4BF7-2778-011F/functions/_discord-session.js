export const SESSION_COOKIE = "__Host-discord_session";
export const STATE_COOKIE = "__Host-discord_oauth_state";
export const CALLBACK_PATH = "/api/auth/discord/callback";
export const SESSION_LIFETIME = 24 * 60 * 60;
export const STATE_LIFETIME = 10 * 60;

const tokenPattern = /^[0-9a-f]{64}$/;

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function readToken(request, name) {
  const cookies = (request.headers.get("Cookie") || "").split(";");
  const prefix = name + "=";
  const matches = cookies.map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(prefix));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(prefix.length);
  return tokenPattern.test(token) ? token : null;
}

export function tokenCookie(name, token, maxAge) {
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === null || origin === new URL(request.url).origin;
}

export function discordConfigured(env) {
  return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

export function authRedirect(location, cookies = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export async function sessionTokenHash(request) {
  const token = readToken(request, SESSION_COOKIE);
  return token ? hashToken(token) : null;
}

export async function findSessionUser(db, tokenHash) {
  if (!tokenHash) return null;
  return db.prepare(
    "SELECT u.user_id AS userId, u.username, u.avatar FROM discord_sessions s " +
    "JOIN discord_users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(tokenHash, nowSeconds()).first();
}
