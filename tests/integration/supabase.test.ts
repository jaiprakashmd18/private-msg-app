/**
 * End-to-end tests against a running Supabase stack (Auth + REST + Realtime +
 * Storage), using the same supabase-js client the app uses.
 *
 * Requirements (local):
 *   supabase start                 # applies migrations + supabase/seed.sql
 *   export SUPABASE_URL=http://127.0.0.1:54321
 *   export SUPABASE_ANON_KEY=...   # `supabase status -o env` → ANON_KEY
 *   export SUPABASE_SERVICE_ROLE_KEY=...  # → SERVICE_ROLE_KEY
 *   npm run test:integration
 *
 * Uses the test numbers from supabase/config.toml ([auth.sms.test_otp]) and
 * supabase/seed.sql, so no SMS is sent. NEVER point this at production.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const ADMIN = "+15550000001";
const ALICE = "+15550000002";
const BOB = "+15550000003";
const TEST_CODE = "123456";

function client(): SupabaseClient {
  return createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(phone: string): Promise<{ sb: SupabaseClient; userId: string }> {
  const sb = client();
  let { error: otpError } = await sb.auth.signInWithOtp({ phone });
  if (otpError?.status === 429) {
    // Supabase enforces a minimum interval between codes for the same number
    // (auth.sms.max_frequency); wait it out once when tests run back-to-back.
    await new Promise((r) => setTimeout(r, 6000));
    ({ error: otpError } = await sb.auth.signInWithOtp({ phone }));
  }
  if (otpError) throw otpError;
  const { data, error } = await sb.auth.verifyOtp({ phone, token: TEST_CODE, type: "sms" });
  if (error) throw error;
  return { sb, userId: data.user!.id };
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
  let service: SupabaseClient;
  let admin: { sb: SupabaseClient; userId: string };
  let alice: { sb: SupabaseClient; userId: string };
  let bob: { sb: SupabaseClient; userId: string };
  let conversationId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    // Make sure the seeded numbers are active (a previous run may have failed mid-way).
    await service.from("authorized_phone_numbers").update({ status: "active", disabled_at: null }).in("phone_e164", [ADMIN, ALICE, BOB]);
    admin = await signIn(ADMIN);
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
  }, 60_000);

  afterAll(async () => {
    await service?.from("authorized_phone_numbers").update({ status: "active", disabled_at: null }).eq("phone_e164", BOB);
    for (const c of [admin?.sb, alice?.sb, bob?.sb]) await c?.removeAllChannels();
  });

  it("rejects OTP sign-up for a number that is not on the allowlist (direct Auth API call)", async () => {
    const outsider = `+1555${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const { error } = await client().auth.signInWithOtp({ phone: outsider });
    expect(error).not.toBeNull();
    // No auth user was created.
    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(data.users.some((u) => u.phone === outsider.slice(1))).toBe(false);
  });

  it("rejects password sign-up as an allowlist bypass", async () => {
    const { error } = await client().auth.signUp({ phone: "+15559999999", password: "Sup3r-secret-pass" });
    expect(error).not.toBeNull();
  });

  it("signs in an approved number and reports active access", async () => {
    const { data, error } = await alice.sb.rpc("my_access").single<{ is_active: boolean; role: string }>();
    expect(error).toBeNull();
    expect(data?.is_active).toBe(true);
    expect(data?.role).toBe("member");
  });

  it("prevents self-promotion to admin and admin RPCs for members", async () => {
    const upd = await alice.sb.from("authorized_phone_numbers").update({ role: "admin" }).eq("phone_e164", ALICE).select();
    expect(upd.error ?? upd.data?.length === 0).toBeTruthy();
    const stats = await alice.sb.rpc("admin_stats");
    expect(stats.error?.message).toMatch(/Administrator privileges required/);
    const prof = await alice.sb.from("profiles").update({ authorized_phone_id: null }).eq("id", alice.userId);
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
      await alice.sb.rpc("send_message", {
        p_conversation_id: conversationId,
        p_client_id: randomUUID(),
        p_body: "warm-up",
      });
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

  it("keeps history across sign-out and a new sign-in", async () => {
    const before = await bob.sb.from("messages").select("id").eq("conversation_id", conversationId);
    await bob.sb.auth.signOut();
    bob = await signIn(BOB);
    const after = await bob.sb.from("messages").select("id").eq("conversation_id", conversationId);
    expect(after.data?.length).toBe(before.data?.length);
    expect(after.data!.length).toBeGreaterThan(0);
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
    const download = await fetch(forBob.data!.signedUrl);
    expect(download.status).toBe(200);

    const forAdmin = await admin.sb.storage.from("attachments").createSignedUrl(ownPath, 60);
    expect(forAdmin.error).not.toBeNull();
  });

  it("revoking access cuts off an existing session immediately", async () => {
    const { data: entries } = await admin.sb.rpc("admin_list_numbers");
    const bobEntry = (entries as { id: string; phone_e164: string }[]).find((e) => e.phone_e164 === BOB)!;
    const disabled = await admin.sb.rpc("admin_set_number_status", { p_id: bobEntry.id, p_status: "disabled" });
    expect(disabled.error).toBeNull();

    // Bob still holds a cryptographically valid access token…
    const reads = await bob.sb.from("messages").select("id").eq("conversation_id", conversationId);
    expect(reads.data).toEqual([]);
    const send = await bob.sb.rpc("send_message", { p_conversation_id: conversationId, p_client_id: randomUUID(), p_body: "x" });
    expect(send.error?.message).toMatch(/revoked/i);
    const access = await bob.sb.rpc("my_access").single<{ is_active: boolean }>();
    expect(access.data?.is_active).toBe(false);

    // …but his refresh token no longer works.
    const refreshed = await bob.sb.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();

    // Signing in again is refused: the access-token hook issues no token.
    await client().auth.signInWithOtp({ phone: BOB });
    const relogin = await client().auth.verifyOtp({ phone: BOB, token: TEST_CODE, type: "sms" });
    expect(relogin.error).not.toBeNull();
    expect(relogin.data.session).toBeNull();

    await admin.sb.rpc("admin_set_number_status", { p_id: bobEntry.id, p_status: "active" });
  });
});
