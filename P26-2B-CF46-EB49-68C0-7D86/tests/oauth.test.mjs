import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequest } from "../functions/api/[[route]].js";
import { callbackPath, mockDiscord, oauthEnvironment, oauthMigration, prepareOAuthDatabase, startPath } from "./support/oauth.mjs";

import { migration, seedSession } from "./support/database.mjs";

const origin = "https://example.test";
const first = { id: "123456789012345670", username: "fixture-owner", global_name: "Titular OAuth QA", avatar: "0123456789abcdef0123456789abcdef" };
const second = { id: "123456789012345671", username: "fixture-other", global_name: null, avatar: null };
const cookie = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + "="));
const cookiePair = value => value?.split(";", 1)[0];
const hash = value => createHash("sha256").update(value).digest("hex");
const sessionName = "__Host-p23_session";
const oauthName = "__Host-p23_oauth";

function makeHarness(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  prepareOAuthDatabase(db);
  const env = oauthEnvironment(db, origin);
  const request = async (path, { method = "GET", browserCookie, body, options = env, base = origin } = {}) => {
    const headers = { Origin: base };
    if (browserCookie) headers.Cookie = browserCookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return onRequest({ request: new Request(base + path, { method, headers, body: JSON.stringify(body) }), env: options });
  };
  const begin = async () => {
    const response = await request(startPath);
    assert.equal(response.status, 302);
    const destination = new URL(response.headers.get("Location"));
    assert.equal(destination.origin, "https://discord.com");
    assert.equal(destination.pathname, "/oauth2/authorize");
    assert.equal(destination.searchParams.get("response_type"), "code");
    assert.equal(destination.searchParams.get("scope"), "identify");
    assert.equal(destination.searchParams.get("redirect_uri"), env.DISCORD_REDIRECT_URI);
    assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
    const temporary = cookie(response, oauthName);
    assert.ok(temporary);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(temporary.includes(attribute));
    assert.doesNotMatch(temporary, /;\s*Domain=/i);
    return { state: destination.searchParams.get("state"), challenge: destination.searchParams.get("code_challenge"), temporary };
  };
  const complete = (attempt, params = { code: "fixture-authorization-code" }, session) =>
    request(callbackPath + "?" + new URLSearchParams({ state: attempt.state, iss: "https://discord.com", ...params }), {
      browserCookie: [cookiePair(attempt.temporary), session].filter(Boolean).join("; "),
    });
  return { db, env, request, begin, complete };
}

test("OAuth Discord: identidade, PKCE, sessão, isolamento e revogação", async (t) => {
  const qa = makeHarness(t);
  let identity = first;
  const outbound = mockDiscord(t, () => identity);
  const attempt = await qa.begin();
  const authorized = await qa.complete(attempt);
  assert.equal(authorized.status, 303);
  assert.equal(authorized.headers.get("Location"), "/");
  const session = cookie(authorized, sessionName);
  assert.ok(session);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(session.includes(attribute));
  assert.doesNotMatch(session, /;\s*Domain=/i);
  assert.match(cookie(authorized, oauthName), /Max-Age=0/i);
  assert.deepEqual(outbound.map(call => call.path), ["token", "identity"]);
  const form = outbound[0].form;
  assert.equal(outbound[0].method, "POST");
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("redirect_uri"), qa.env.DISCORD_REDIRECT_URI);
  assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), attempt.challenge);

  let browserCookie = cookiePair(session);
  const token = browserCookie.slice(sessionName.length + 1);
  const persisted = qa.db.prepare("SELECT token_hash FROM sessions").get();
  assert.equal(persisted.token_hash, hash(token));
  const savedDiscordUser = qa.db.prepare("SELECT discord_username FROM users WHERE discord_id = ?").get(first.id);
  assert.equal(savedDiscordUser.discord_username, first.username);
  const data = await (await qa.request("/api/session", { browserCookie })).json();
  assert.equal(data.user.displayName, first.global_name);
  assert.match(data.user.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/avatars\//);

  const saved = await qa.request("/api/projects", {
    browserCookie, method: "POST", body: { name: "Projeto OAuth QA", style: "abnt" },
  });
  assert.equal(saved.status, 201);
  const { project } = await saved.json();
  const replay = await qa.complete(attempt);
  assert.equal(replay.headers.get("Location"), "/?auth=invalid");
  assert.equal(cookie(replay, sessionName), undefined);
  assert.deepEqual(outbound.map(call => call.path), ["token", "identity"]);

  identity = { ...first, username: "fixture-renamed", global_name: "Titular renomeada" };
  const reentry = await qa.complete(await qa.begin(), undefined, browserCookie);
  const rotated = cookiePair(cookie(reentry, sessionName));
  assert.ok(rotated && rotated !== browserCookie);
  assert.deepEqual(await (await qa.request("/api/session", { browserCookie })).json(), { user: null });
  browserCookie = rotated;
  const updated = await (await qa.request("/api/session", { browserCookie })).json();
  assert.equal(updated.user.id, data.user.id);
  assert.equal(updated.user.displayName, identity.global_name);
  assert.equal(qa.db.prepare("SELECT discord_username FROM users WHERE id = ?").get(updated.user.id).discord_username, identity.username);
  assert.equal(qa.db.prepare("SELECT count(*) AS total FROM users").get().total, 1);
  assert.equal((await qa.request("/api/projects/" + project.id, { browserCookie })).status, 200);

  identity = second;
  const other = await qa.complete(await qa.begin());
  const otherCookie = cookiePair(cookie(other, sessionName));
  assert.ok(otherCookie);
  const otherProfile = await (await qa.request("/api/session", { browserCookie: otherCookie })).json();
  assert.equal(otherProfile.user.displayName, second.username);
  assert.match(otherProfile.user.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\//);
  assert.equal((await qa.request("/api/projects/" + project.id, { browserCookie: otherCookie })).status, 404);
  assert.equal((await qa.request("/api/auth/logout", { method: "POST", browserCookie })).status, 204);
  assert.equal((await qa.request("/api/projects", { browserCookie })).status, 401);
  qa.db.prepare("UPDATE sessions SET expires_at = 1").run();
  assert.deepEqual(await (await qa.request("/api/session", { browserCookie: otherCookie })).json(), { user: null });
});

test("callback rejeita cancelamento, estado expirado e ausência do cookie de vínculo", async (t) => {
  const qa = makeHarness(t);
  const outbound = mockDiscord(t, () => first);
  const cancelledAttempt = await qa.begin();
  const cancelled = await qa.complete(cancelledAttempt, { error: "access_denied" });
  assert.equal(cancelled.status, 303);
  assert.equal(cancelled.headers.get("Location"), "/?auth=cancelled");
  assert.equal(cookie(cancelled, sessionName), undefined);
  assert.equal((await qa.complete(cancelledAttempt)).headers.get("Location"), "/?auth=invalid");

  const unrelatedAttempt = await qa.begin();
  const noCookie = await qa.request(callbackPath + "?" + new URLSearchParams({
    state: unrelatedAttempt.state, code: "fixture-authorization-code",
  }));
  assert.equal(noCookie.headers.get("Location"), "/?auth=invalid");
  assert.equal(cookie(noCookie, sessionName), undefined);

  const expiredAttempt = await qa.begin();
  qa.db.prepare("UPDATE oauth_attempts SET expires_at = 1").run();
  const expired = await qa.complete(expiredAttempt);
  assert.equal(expired.headers.get("Location"), "/?auth=invalid");
  assert.equal(cookie(expired, sessionName), undefined);
  assert.deepEqual(outbound, []);
  assert.equal(qa.db.prepare("SELECT count(*) AS total FROM sessions").get().total, 0);
});

test("falta de configuração e falha do Discord ficam sem sessão", async (t) => {
  const qa = makeHarness(t);
  const outbound = mockDiscord(t, () => first, { tokenStatus: 503 });
  const disabled = [
    { options: { ...qa.env, DISCORD_CLIENT_SECRET: "" } },
    { options: { ...qa.env, DISCORD_REDIRECT_URI: "https://wrong.example.test" + callbackPath } },
    { base: "http://example.test" },
  ];
  for (const options of disabled) {
    const response = await qa.request(startPath, options);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/?auth=unavailable");
    assert.equal(cookie(response, oauthName), undefined);
  }
  assert.equal(qa.db.prepare("SELECT count(*) AS total FROM oauth_attempts").get().total, 0);
  const attempt = await qa.begin();
  const failure = await qa.complete(attempt);
  assert.equal(failure.status, 303);
  assert.equal(failure.headers.get("Location"), "/?auth=failed");
  assert.equal(cookie(failure, sessionName), undefined);
  assert.deepEqual(outbound.map(call => call.path), ["token"]);
  assert.equal(qa.db.prepare("SELECT count(*) AS total FROM sessions").get().total, 0);
});

test("migração OAuth preserva uma sessão e um usuário preexistentes", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(migration);
  const priorToken = seedSession(db, "Conta anterior");
  db.exec(oauthMigration);
  assert.equal(db.prepare("SELECT discord_username FROM users").get().discord_username, null);
  const response = await onRequest({
    request: new Request(origin + "/api/session", { headers: { Cookie: sessionName + "=" + priorToken } }),
    env: oauthEnvironment(db, origin),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.displayName, "Conta anterior");
});
