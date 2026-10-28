import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for database tests (run `npm run test:db`).");
}

export const pool = new pg.Pool({ connectionString: url, max: 4 });

/**
 * Query results. Typed as a non-empty tuple so tests can destructure the first
 * row directly; a missing row then fails the test's own assertions.
 */
export type Rows<T> = [T, ...T[]];

let counter = Math.floor(Math.random() * 1_000_000);

/** A fresh, unique email address (reserved example.com domain). */
export function freshEmail(): string {
  counter += 1;
  return `user${counter}@example.com`;
}

export const GOOGLE_APP_METADATA = JSON.stringify({ provider: "google", providers: ["google"] });

/** Inserts an auth user the way Supabase Auth does after a Google sign-in. */
export function insertAuthUser(id: string, email: string, provider = "google", fullName = "Test User") {
  return asOwner(
    `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, now(), $3, $4)`,
    [id, email, JSON.stringify({ provider, providers: [provider] }), JSON.stringify({ full_name: fullName })],
  );
}

/** Runs SQL as the database owner (bypasses RLS) — test setup only. */
export async function asOwner<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const res = await pool.query(sql, params);
  return res.rows as Rows<T>;
}

/**
 * Runs SQL exactly as a PostgREST request from a signed-in user would:
 * role `authenticated` with the user's JWT claims. Commits on success.
 */
export async function asUser<T = Record<string, unknown>>(
  userId: string | null,
  sql: string,
  params: unknown[] = [],
  role: "authenticated" | "anon" | "service_role" = "authenticated",
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const claims = userId ? { sub: userId, role } : { role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as Rows<T>;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Adds a number to the allowlist and creates the auth user, as Supabase Auth would. */
export async function createUser(opts: { role?: "member" | "admin"; label?: string } = {}) {
  const email = freshEmail();
  await asOwner(
    "insert into public.authorized_emails (email, label, role) values ($1, $2, $3)",
    [email, opts.label ?? null, opts.role ?? "member"],
  );
  const id = randomUUID();
  await insertAuthUser(id, email);
  await asOwner("insert into auth.sessions (id, user_id) values (gen_random_uuid(), $1)", [id]);
  const [entry] = await asOwner<{ id: string }>(
    "select id from public.authorized_emails where email = $1",
    [email],
  );
  return { id, email, entryId: entry.id };
}

export async function directConversation(a: string, b: string): Promise<string> {
  const [row] = await asUser<{ id: string }>(
    a,
    "select public.get_or_create_direct_conversation($1) as id",
    [b],
  );
  return row.id;
}

export async function send(userId: string, conversationId: string, body: string, clientId = randomUUID()) {
  const [row] = await asUser<{ id: string; body: string }>(
    userId,
    "select * from public.send_message($1, $2, $3)",
    [conversationId, clientId, body],
  );
  return row;
}

export async function setSettings(values: Record<string, unknown>) {
  const keys = Object.keys(values);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await asOwner(`update public.app_settings set ${sets}`, Object.values(values));
}
