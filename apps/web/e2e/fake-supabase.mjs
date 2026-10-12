// A stand-in for Supabase used only by the browser tests.
//
// It speaks just enough of the Supabase protocol for the app (email one-time
// code sign-in, and /rest/v1/rpc/<function> calls), and runs the project's
// real migrations in PGlite, so the browser tests exercise the true schema,
// row-level security and server functions. Every one-time code is 123456.
// Never use it outside tests.

import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54329);
const CODE = '123456';
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

const db = new PGlite();
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));

// PGlite has one connection: run requests one at a time.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const userIdFor = (email) => {
  const h = createHash('sha256').update(email.toLowerCase()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function session(email) {
  const id = userIdFor(email);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  const access_token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp })}.test`;
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `refresh-${id}`, user };
}

function subFrom(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

async function rpc(fn, args, sub) {
  if (!/^[a-z_]+$/.test(fn)) throw Object.assign(new Error('Unknown function'), { status: 404 });
  return serial(async () => {
    await db.query('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
    await db.query(sub ? 'set role authenticated' : 'set role anon');
    try {
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      const values = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
      return (await db.query(sql, values)).rows[0].r;
    } finally {
      await db.query('reset role');
    }
  });
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;
    if (path === '/health') return send(res, 200, { ok: true });
    if (path === '/auth/v1/otp') return send(res, 200, {});
    if (path === '/auth/v1/verify') {
      const { email, token } = await readJson(req);
      if (token !== CODE) return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      const s = session(email);
      await serial(() => db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [s.user.id, email]));
      return send(res, 200, s);
    }
    if (path === '/auth/v1/token') {
      const { refresh_token } = await readJson(req);
      const id = String(refresh_token ?? '').replace(/^refresh-/, '');
      const row = await serial(() => db.query('select email from auth.users where id = $1', [id]));
      if (!row.rows[0]) return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, session(row.rows[0].email));
    }
    if (path === '/auth/v1/user') {
      const sub = subFrom(req);
      const row = sub ? await serial(() => db.query('select id, email from auth.users where id = $1', [sub])) : { rows: [] };
      return row.rows[0] ? send(res, 200, session(row.rows[0].email).user) : send(res, 401, { msg: 'not signed in' });
    }
    if (path === '/auth/v1/logout') return send(res, 204);
    const m = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m && req.method === 'POST') {
      try {
        return send(res, 200, await rpc(m[1], await readJson(req), subFrom(req)));
      } catch (err) {
        return send(res, err.status ?? 400, { code: err.code ?? 'P0001', message: err.message, details: null, hint: null });
      }
    }
    send(res, 404, { message: `Not found: ${path}` });
  } catch (err) {
    send(res, 500, { message: String(err?.message ?? err) });
  }
}).listen(PORT, () => console.log(`fake supabase on ${PORT}`));
