import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run the real Supabase migrations in PGlite. The shim reproduces the parts
 * of Supabase the migrations rely on: the auth schema, auth.users,
 * auth.uid() (read from the request JWT claim, as Supabase does) and the
 * anon / authenticated roles.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

const SUPABASE_SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

export async function createUser(db: PGlite, id: string, email = `${id.slice(0, 8)}@example.org`) {
  await db.query('reset role');
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
}

/** Act as a signed-in user for subsequent queries (RLS applies). */
export async function actAs(db: PGlite, userId: string | null) {
  await db.query('reset role');
  if (userId === null) {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query('set role anon');
    return;
  }
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.query('set role authenticated');
}

export async function asAdmin(db: PGlite) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}

export async function rpc<T>(db: PGlite, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const res = await db.query<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
  return res.rows[0]!.r;
}
