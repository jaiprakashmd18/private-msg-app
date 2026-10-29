/**
 * End-to-end tests against a running LOCAL Supabase stack (Auth + REST +
 * Realtime + Storage), using the same supabase-js client the app uses.
 *
 * Google sign-in can't be automated, so users are created the way Supabase
 * Auth creates them after a Google login (auth.users row with provider
 * "google"), and their access tokens are signed with the local JWT secret —
 * exactly what Auth would issue. Everything after sign-in is the real stack.
 *
 *   supabase start
 *   eval "$(npx supabase status -o env)"   # ANON_KEY, SERVICE_ROLE_KEY, JWT_SECRET, API_URL, DB_URL
 *   SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
 *   SUPABASE_JWT_SECRET=$JWT_SECRET DATABASE_URL=$DB_URL npm run test:integration
 *
 * NEVER point this at production.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;
const dbUrl = process.env.DATABASE_URL;
const enabled = Boolean(url && anonKey && serviceKey && jwtSecret && dbUrl);

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

function mintToken(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: userId, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 }),
  );
  const sig = createHmac("sha256", jwtSecret!).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

interface TestUser {
  sb: SupabaseClient;
  userId: string;
  email: string;
}

function waitFor<T>(fn: () => T | undefined, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = fn();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

describe.skipIf(!enabled)("Supabase end-to-end", () => {
  let db: pg.Pool;
  let service: SupabaseClient;
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let conversationId: string;

  /** Approves an email and creates the user as a Google sign-in would. */
  async function googleUser(role: "admin" | "member"): Promise<TestUser> {
    const email = `it-${randomUUID().slice(0, 8)}@example.com`;
    await db.query("insert into public.authorized_emails (email, role) values ($1, $2)", [email, role]);
    const userId = randomUUID();
    await db.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
               '{"provider":"google","providers":["google"]}', '{"full_name":"Integration User"}', now(), now())`,
      [userId, email],
    );
    const token = mintToken(userId, email);
    const sb = createClient(url!, anonKey!, { accessToken: async () => token });
    return { sb, userId, email };
  }

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: dbUrl });
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    admin = await googleUser("admin");
    alice = await googleUser("member");
    bob = await googleUser("member");
  });

  afterAll(async () => {
    for (const c of [admin?.sb, alice?.sb, bob?.sb]) await c?.removeAllChannels();
    await db?.end();
  });

  it("refuses email/password sign-up, even for an approved email", async () => {
    const email = `it-${randomUUID().slice(0, 8)}@example.com`;
    await db.query("insert into public.authorized_emails (email) values ($1)", [email]);
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.auth.signUp({ email, password: "Sup3r-secret-pass!" });
    expect(error).not.toBeNull();
    const { rows } = await db.query("select 1 from auth.users where email = $1", [email]);
    expect(rows).toHaveLength(0);
  });

  it("refuses non-Google accounts even when created with the service-role admin API", async () => {
    const email = `it-${randomUUID().slice(0, 8)}@example.com`;
    await db.query("insert into public.authorized_emails (email) values ($1)", [email]);
    const { error } = await service.auth.admin.createUser({ email, email_confirm: true });
    expect(error).not.toBeNull();
    // The hook received the provider from Supabase Auth and logged the refusal.
    const { rows } = await db.query(
      "select metadata from public.audit_logs where action = 'auth.signup_rejected' order by id desc limit 1",
    );
    expect(rows[0]?.metadata.provider).toBe("email");
  });

  it("gives an approved Google account active access", async () => {
    const { data, error } = await alice.sb
      .rpc("my_access")
      .single<{ is_active: boolean; role: string; display_name: string }>();
    expect(error).toBeNull();
    expect(data?.is_active).toBe(true);
    expect(data?.role).toBe("member");
    expect(data?.display_name).toBe("Integration User");
  });

  it("prevents self-promotion to admin and admin RPCs for members", async () => {
    const upd = await alice.sb.from("authorized_emails").update({ role: "admin" }).eq("email", alice.email).select();
    expect(upd.error ?? upd.data?.length === 0).toBeTruthy();
    const stats = await alice.sb.rpc("admin_stats");
    expect(stats.error?.message).toMatch(/Administrator privileges required/);
    const prof = await alice.sb.from("profiles").update({ authorized_email_id: null }).eq("id", alice.userId);
    expect(prof.error).not.toBeNull();
  });

  it("delivers messages in real time to the other member", { timeout: 40_000 }, async () => {
    const { data: convId, error } = await alice.sb.rpc("get_or_create_direct_conversation", {
      p_other_user_id: bob.userId,
    });
    expect(error).toBeNull();
    conversationId = convId as string;

    const received: { id: string; body: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      bob.sb
        .channel(`test-${randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          received.push(payload.new as { id: string; body: string });
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
        });
    });
    // On a cold stack, Realtime may report SUBSCRIBED before its replication
    // stream is attached. Send warm-up messages until one arrives.
    const deadline = Date.now() + 20_000;
    while (received.length === 0 && Date.now() < deadline) {
      await alice.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: randomUUID(), p_body: "warm-up" });
      await new Promise((r) => setTimeout(r, 2000));
    }

    const body = `realtime ${randomUUID()}`;
    const sent = await alice.sb.rpc("send_message", {
      p_conversation_id: conversationId,
      p_client_id: randomUUID(),
      p_body: body,
    });
    expect(sent.error).toBeNull();
    const got = await waitFor(() => received.find((m) => m.body === body));
    expect(got.id).toBe((sent.data as { id: string }).id);
  });

  it("does not deliver realtime events or REST reads to outsiders", async () => {
    const leaked: unknown[] = [];
    await new Promise<void>((resolve) => {
      admin.sb
        .channel(`outsider-${randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => leaked.push(p))
        .subscribe((status) => status === "SUBSCRIBED" && resolve());
    });
    await new Promise((r) => setTimeout(r, 1500));
    await alice.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: randomUUID(), p_body: "not for admin" });
    await new Promise((r) => setTimeout(r, 2500));
    expect(leaked).toHaveLength(0);
    const { data } = await admin.sb.from("messages").select("id").eq("conversation_id", conversationId);
    expect(data).toEqual([]);
  });

  it("deduplicates retried sends", async () => {
    const clientId = randomUUID();
    const a = await alice.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: clientId, p_body: "retry me" });
    const b = await alice.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: clientId, p_body: "retry me" });
    expect((a.data as { id: string }).id).toBe((b.data as { id: string }).id);
  });

  it("enforces attachment storage policies", async () => {
    const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
    const ownPath = `${conversationId}/${alice.userId}/${randomUUID()}-pic.png`;
    const ok = await alice.sb.storage.from("attachments").upload(ownPath, file, { contentType: "image/png" });
    expect(ok.error).toBeNull();

    const spoof = await alice.sb.storage
      .from("attachments")
      .upload(`${conversationId}/${bob.userId}/${randomUUID()}-spoof.png`, file, { contentType: "image/png" });
    expect(spoof.error).not.toBeNull();

    const intrude = await admin.sb.storage
      .from("attachments")
      .upload(`${conversationId}/${admin.userId}/${randomUUID()}-x.png`, file, { contentType: "image/png" });
    expect(intrude.error).not.toBeNull();

    const badType = await alice.sb.storage
      .from("attachments")
      .upload(`${conversationId}/${alice.userId}/${randomUUID()}-x.html`, new Blob(["<b>x</b>"], { type: "text/html" }), {
        contentType: "text/html",
      });
    expect(badType.error).not.toBeNull();

    const sent = await alice.sb.rpc("send_message", {
      p_conversation_id: conversationId,
      p_client_id: randomUUID(),
      p_body: "",
      p_attachments: [{ path: ownPath, name: "pic.png" }],
    });
    expect(sent.error).toBeNull();

    const forBob = await bob.sb.storage.from("attachments").createSignedUrl(ownPath, 60);
    expect(forBob.error).toBeNull();
    expect((await fetch(forBob.data!.signedUrl)).status).toBe(200);

    const forAdmin = await admin.sb.storage.from("attachments").createSignedUrl(ownPath, 60);
    expect(forAdmin.error).not.toBeNull();
  });

  it("typing signals on a private conversation channel reach members only", { timeout: 30_000 }, async () => {
    const topic = `conv:${conversationId}`;
    const join = (u: TestUser) =>
      new Promise<{ ch: ReturnType<SupabaseClient["channel"]>; status: string }>((resolve) => {
        const ch = u.sb.channel(topic, { config: { private: true } });
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve({ ch, status });
        });
      });
    const got: unknown[] = [];
    const bobJoin = await join(bob);
    expect(bobJoin.status).toBe("SUBSCRIBED");
    bobJoin.ch.on("broadcast", { event: "typing" }, (msg) => got.push(msg.payload));
    const aliceJoin = await join(alice);
    expect(aliceJoin.status).toBe("SUBSCRIBED");
    // The outsider (admin isn't in Alice & Bob's chat) is refused by the channel policy.
    const outsider = await join(admin);
    expect(outsider.status).not.toBe("SUBSCRIBED");

    const deadline = Date.now() + 15_000;
    while (got.length === 0 && Date.now() < deadline) {
      await aliceJoin.ch.send({ type: "broadcast", event: "typing", payload: { user_id: alice.userId } });
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(got[0]).toEqual({ user_id: alice.userId });
  });

  it("online presence is shared between active members", { timeout: 30_000 }, async () => {
    const online = (u: TestUser) => {
      const ch = u.sb.channel("online", { config: { private: true, presence: { key: u.userId } } });
      return new Promise<typeof ch>((resolve) =>
        ch.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await ch.track({ at: Date.now() });
            resolve(ch);
          }
        }),
      );
    };
    const aliceCh = await online(alice);
    await online(bob);
    const seen = await waitFor(() => (Object.keys(aliceCh.presenceState()).includes(bob.userId) ? true : undefined), 15_000);
    expect(seen).toBe(true);
  });

  it("reactions arrive in real time", { timeout: 30_000 }, async () => {
    const got: { emoji: string | null }[] = [];
    await new Promise<void>((resolve) => {
      alice.sb
        .channel(`reactions-${randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (p) =>
          got.push(p.new as { emoji: string | null }),
        )
        .subscribe((status) => status === "SUBSCRIBED" && resolve());
    });
    const { data: m } = await alice.sb.rpc("send_message", {
      p_conversation_id: conversationId,
      p_client_id: randomUUID(),
      p_body: "react please",
    });
    const deadline = Date.now() + 15_000;
    while (got.length === 0 && Date.now() < deadline) {
      await bob.sb.rpc("toggle_reaction", { p_message_id: (m as { id: string }).id, p_emoji: "👍" });
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(got.some((r) => r.emoji === "👍" || r.emoji === null)).toBe(true);
  });

  it("revoking access cuts off an existing session immediately", async () => {
    const { data: entries } = await admin.sb.rpc("admin_list_allowlist");
    const bobEntry = (entries as { id: string; email: string }[]).find((e) => e.email === bob.email)!;
    const disabled = await admin.sb.rpc("admin_set_access_status", { p_id: bobEntry.id, p_status: "disabled" });
    expect(disabled.error).toBeNull();

    // Bob still holds a cryptographically valid access token, but:
    const reads = await bob.sb.from("messages").select("id").eq("conversation_id", conversationId);
    expect(reads.data).toEqual([]);
    const send = await bob.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: randomUUID(), p_body: "x" });
    expect(send.error?.message).toMatch(/revoked/i);
    const access = await bob.sb.rpc("my_access").single<{ is_active: boolean }>();
    expect(access.data?.is_active).toBe(false);

    await admin.sb.rpc("admin_set_access_status", { p_id: bobEntry.id, p_status: "active" });
    const restored = await bob.sb.from("messages").select("id").eq("conversation_id", conversationId);
    expect(restored.data!.length).toBeGreaterThan(0);
  });
});
