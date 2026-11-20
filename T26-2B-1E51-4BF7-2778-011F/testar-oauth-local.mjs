import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { onRequestGet as startLogin } from './functions/api/auth/discord.js';
import { onRequestGet as finishLogin } from './functions/api/auth/discord/callback.js';
import * as logoutRoute from './functions/api/auth/logout.js';
import { onRequest as status } from './functions/api/status.js';

const logout = logoutRoute.onRequest || logoutRoute.onRequestPost;
const origin = 'https://projeto0.test';
const callbackPath = '/api/auth/discord/callback';
const projectKey = 'T26-2B-1E51-4BF7-2778-011F';
const sessionCookieName = '__Host-discord_session';
const stateCookieName = '__Host-discord_oauth_state';
const alice = { id: '111111111111111111', username: 'alice-local', avatar: null };
const bob = { id: '222222222222222222', username: 'bob-local', avatar: null };
const originalFetch = globalThis.fetch;
const migrationsDir = new URL('./migrations/', import.meta.url);
let database;
let env;
let profiles;
let discordCalls;

function d1Statement(sql, values = []) {
  const statement = database.prepare(sql);
  function execute() {
    if (statement.columns().length) {
      return { success: true, results: statement.all(...values) };
    }
    const result = statement.run(...values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  return {
    execute,
    bind: (...parameters) => d1Statement(sql, parameters),
    first: async (column) => {
      const row = statement.get(...values);
      return column ? row?.[column] ?? null : row ?? null;
    },
    all: async () => execute(),
    run: async () => execute(),
  };
}

function applyMigrations(migrationNames) {
  for (const name of migrationNames) {
    database.exec(readFileSync(new URL(name, migrationsDir), 'utf8'));
  }
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  applyMigrations(readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort());
  env = {
    DB: {
      prepare: d1Statement,
      batch: async (statements) => {
        database.exec('BEGIN');
        try {
          const results = statements.map(statement => statement.execute());
          database.exec('COMMIT');
          return results;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
    DISCORD_CLIENT_ID: 'cliente-sintetico',
    DISCORD_CLIENT_SECRET: 'segredo-sintetico',
  };
  profiles = new Map([['codigo-a', alice], ['codigo-b', bob]]);
  discordCalls = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://discord.com');
    discordCalls.push(url.pathname);
    if (url.pathname === '/api/oauth2/token') {
      const body = new URLSearchParams(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('redirect_uri'), origin + callbackPath);
      const code = body.get('code');
      assert.ok(profiles.has(code));
      return Response.json({ access_token: code });
    }
    assert.match(url.pathname, /^\/api(?:\/v\d+)?\/users\/@me$/);
    const authorization = new Headers(options.headers).get('Authorization');
    const profile = profiles.get(authorization?.replace(/^Bearer /, ''));
    assert.ok(profile);
    return Response.json(profile);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  database.close();
});

function invoke(handler, path, { method = 'GET', cookie, body, requestOrigin } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  if (requestOrigin) headers.set('Origin', requestOrigin);
  if (body) headers.set('Content-Type', 'application/json');
  const request = new Request(origin + path, { method, headers, body: JSON.stringify(body) });
  return handler({ request, env });
}

function responseCookie(response, name) {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith(`${name}=`));
  assert.ok(cookie, `Cookie ${name} ausente`);
  return cookie;
}

function assertSecureCookie(cookie) {
  assert.match(cookie, /;\s*Secure(?:;|$)/i);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(cookie, /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i);
  assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
  assert.doesNotMatch(cookie, /;\s*Domain=/i);
}

async function initiateLogin() {
  const response = await invoke(startLogin, '/api/auth/discord');
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get('Location'));
  assert.equal(redirect.origin, 'https://discord.com');
  assert.equal(redirect.searchParams.get('scope'), 'identify');
  const state = redirect.searchParams.get('state');
  assert.match(state, /^[a-f0-9]{64}$/);
  const cookie = responseCookie(response, stateCookieName);
  assertSecureCookie(cookie);
  return { state, cookie: cookie.split(';')[0] };
}

function callback(state, cookie, code) {
  const params = new URLSearchParams({ code });
  if (state !== null) params.set('state', state);
  return invoke(finishLogin, `${callbackPath}?${params}`, { cookie });
}

async function login(code = 'codigo-a') {
  const initial = await initiateLogin();
  const response = await callback(initial.state, initial.cookie, code);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('Location'), origin).searchParams.get('login'), 'success');
  const cookie = responseCookie(response, sessionCookieName);
  assertSecureCookie(cookie);
  assert.match(cookie.split(';')[0].split('=')[1], /^[a-f0-9]{64}$/);
  return cookie.split(';')[0];
}

async function readStatus(cookie) {
  const response = await invoke(status, '/api/status', { cookie });
  assert.equal(response.status, 200);
  return response.json();
}

function writePing(cookie, body, requestOrigin = origin) {
  return invoke(status, '/api/status', { method: 'POST', cookie, body, requestOrigin });
}

function endSession(cookie, requestOrigin = origin) {
  return invoke(logout, '/api/auth/logout', { method: 'POST', cookie, requestOrigin });
}

test('OAuth2 cria uma sessão opaca e persiste o perfil recebido do Discord', async () => {
  const cookie = await login();
  const info = await readStatus(cookie);
  assert.equal(discordCalls.length, 2);
  assert.equal(info.d1Connected, true);
  assert.equal(info.discordOAuthConfigured, true);
  assert.equal(info.sessionUser.userId, alice.id);
  assert.equal(info.sessionUser.username, alice.username);
  assert.match(info.sessionUser.avatar, /^https:\/\/cdn\.discordapp\.com\//);
  const stored = database.prepare('SELECT token_hash, user_id, expires_at FROM discord_sessions').get();
  const token = cookie.split('=')[1];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  assert.equal(stored.token_hash, Buffer.from(digest).toString('hex'));
  assert.equal(stored.user_id, alice.id);
  assert.ok(stored.expires_at > Math.floor(Date.now() / 1000));
});

test('OAuth2 rejeita state ausente, divergente, expirado e já utilizado', async () => {
  const first = await initiateLogin();
  const second = await initiateLogin();
  assert.notEqual(first.state, second.state);
  const requests = [[null, first.cookie], [second.state, first.cookie], [first.state, undefined]];
  for (const [state, cookie] of requests) {
    const response = await callback(state, cookie, 'codigo-a');
    const destination = new URL(response.headers.get('Location'), origin);
    assert.equal(destination.searchParams.get('auth_error'), 'invalid_state');
  }
  assert.equal(discordCalls.length, 0);
  database.exec('UPDATE discord_oauth_states SET expires_at = 0');
  const expired = await callback(first.state, first.cookie, 'codigo-a');
  assert.equal(new URL(expired.headers.get('Location'), origin).searchParams.get('auth_error'), 'invalid_state');
  assert.equal(discordCalls.length, 0);

  const fresh = await initiateLogin();
  const success = await callback(fresh.state, fresh.cookie, 'codigo-a');
  assert.ok(responseCookie(success, sessionCookieName));
  const reused = await callback(fresh.state, fresh.cookie, 'codigo-a');
  assert.equal(new URL(reused.headers.get('Location'), origin).searchParams.get('auth_error'), 'invalid_state');
  assert.equal(discordCalls.length, 2);
});

test('status rejeita sessão com token alterado, malformado ou ausente', async () => {
  const cookie = await login();
  const last = cookie.at(-1);
  const modified = cookie.slice(0, -1) + (last === '0' ? '1' : '0');
  for (const invalidCookie of [modified, `${sessionCookieName}=valor-invalido`, undefined]) {
    const diagnostics = await readStatus(invalidCookie);
    assert.equal(diagnostics.sessionUser, null);
    assert.equal(diagnostics.d1Connected, true);
    assert.deepEqual(diagnostics.ultimosRegistros, []);
    assert.equal((await writePing(invalidCookie, { conteudo: 'ping sintético' })).status, 401);
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_records').get().count, 0);
});

test('sessão expirada perde acesso ao perfil e ao registro de pings', async () => {
  const cookie = await login();
  assert.equal((await readStatus(cookie)).sessionUser.userId, alice.id);
  database.exec('UPDATE discord_sessions SET expires_at = 0');
  assert.equal((await readStatus(cookie)).sessionUser, null);
  assert.equal((await writePing(cookie, { conteudo: 'ping sintético' })).status, 401);
});

test('logout revoga a sessão no banco e limpa o cookie', async () => {
  const cookie = await login();
  const otherCookie = await login('codigo-b');
  const response = await endSession(cookie);
  assert.equal(response.status, 204);
  assert.match(responseCookie(response, sessionCookieName), /;\s*Max-Age=0(?:;|$)/i);
  const remaining = database.prepare('SELECT user_id FROM discord_sessions').all();
  assert.deepEqual(remaining.map(session => session.user_id), [bob.id]);
  assert.equal((await readStatus(cookie)).sessionUser, null);
  assert.equal((await writePing(cookie, { conteudo: 'ping sintético' })).status, 401);
  assert.equal((await endSession(cookie)).status, 204);
  assert.equal((await readStatus(otherCookie)).sessionUser.userId, bob.id);
});

test('pings preservam a identidade da sessão e isolam os registros por usuário', async () => {
  const cookieA = await login('codigo-a');
  const cookieB = await login('codigo-b');
  assert.notEqual(cookieA, cookieB);
  database.prepare('INSERT INTO project_records (user_id, username, chave_projeto, conteudo) VALUES (?, ?, ?, ?)')
    .run(alice.id, alice.username, projectKey, 'ping existente');
  assert.equal((await writePing(cookieA, { conteudo: '   ' })).status, 400);
  assert.equal((await writePing(cookieA, { conteudo: '  ping A  ', userId: bob.id, username: bob.username })).status, 201);
  assert.equal((await writePing(cookieB, { conteudo: 'ping B' })).status, 201);
  const responseA = await readStatus(cookieA);
  const responseB = await readStatus(cookieB);
  const anonymous = await readStatus();
  assert.equal(responseA.totalRegistros, 2);
  assert.equal(responseB.totalRegistros, 1);
  assert.equal(anonymous.totalRegistros, 0);
  assert.deepEqual(responseA.ultimosRegistros.map(record => record.conteudo), ['ping A', 'ping existente']);
  assert.deepEqual(responseB.ultimosRegistros.map(record => record.conteudo), ['ping B']);
  assert.deepEqual(anonymous.ultimosRegistros, []);
  const saved = database.prepare('SELECT user_id, username, chave_projeto FROM project_records WHERE conteudo = ?').get('ping A');
  assert.deepEqual({ ...saved }, { user_id: alice.id, username: alice.username, chave_projeto: projectKey });
});

test('rotas de escrita rejeitam requisições com Origin de outro site', async () => {
  const cookie = await login();
  assert.equal((await writePing(cookie, { conteudo: 'ping sintético' }, 'https://outro.test')).status, 403);
  assert.equal((await endSession(cookie, 'https://outro.test')).status, 403);
  assert.equal((await readStatus(cookie)).sessionUser.userId, alice.id);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_records').get().count, 0);
});

test('status e logout recusam métodos incompatíveis', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await invoke(status, '/api/status', { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, POST');
  }
  const response = await invoke(logout, '/api/auth/logout');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
});

test('migração de sessões preserva registros do esquema original', () => {
  database.close();
  database = new DatabaseSync(':memory:');
  applyMigrations(['0001_init.sql']);
  database.prepare('INSERT INTO project_records (user_id, username, chave_projeto, conteudo) VALUES (?, ?, ?, ?)')
    .run(alice.id, alice.username, projectKey, 'ping anterior à migração');
  const before = database.prepare('SELECT * FROM project_records').get();
  applyMigrations(['0002_discord_sessions.sql']);
  const after = database.prepare('SELECT * FROM project_records').get();
  assert.deepEqual(after, before);
});
