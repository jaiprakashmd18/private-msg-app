import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  apnsBody,
  type ApnsTransport,
  fcmMessage,
  readApnsConfig,
  readSecret,
  readServiceAccount,
  sendApns,
  sendFcm,
  signJwt,
} from "@/lib/native-push.server";
import type { PushPayload } from "@/lib/push.server";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsaPem = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ecPem = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const payload: PushPayload = { title: "Meenu", body: "Dinner tonight?", url: "/chat/abc", tag: "abc" };

function decode(jwt: string) {
  const [h, c, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h!, "base64url").toString()),
    claims: JSON.parse(Buffer.from(c!, "base64url").toString()),
    input: `${h}.${c}`,
    sig: Buffer.from(s!, "base64url"),
  };
}

describe("JWT signing for Google and Apple", () => {
  it("signs RS256 (Google) and ES256 (Apple) tokens that verify", () => {
    const g = decode(signJwt({ alg: "RS256", typ: "JWT" }, { iss: "x" }, rsaPem));
    expect(verify("sha256", Buffer.from(g.input), rsa.publicKey, g.sig)).toBe(true);
    const a = decode(signJwt({ alg: "ES256", kid: "ABC1234567" }, { iss: "TEAM123456" }, ecPem));
    expect(a.sig).toHaveLength(64); // raw r||s, as Apple requires
    expect(verify("sha256", Buffer.from(a.input), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, a.sig)).toBe(true);
  });

  it("reads secrets pasted as text, with \\n escapes, or base64", () => {
    expect(readSecret(undefined)).toBeNull();
    expect(readSecret("nonsense")).toBeNull();
    expect(readSecret(ecPem)).toBe(ecPem.trim());
    expect(readSecret(ecPem.trim().replace(/\n/g, "\\n"))).toBe(ecPem.trim());
    expect(readSecret(Buffer.from(ecPem).toString("base64"))).toBe(ecPem.trim());
    const account = { project_id: "ghostline-1", client_email: "push@ghostline-1.iam.gserviceaccount.com", private_key: rsaPem };
    expect(readServiceAccount(Buffer.from(JSON.stringify(account)).toString("base64"))).toEqual(account);
    expect(readServiceAccount('{"project_id":"x"}')).toBeNull();
  });
});

describe("Android (Firebase Cloud Messaging)", () => {
  const account = { project_id: "ghostline-1", client_email: "push@ghostline-1.iam.gserviceaccount.com", private_key: rsaPem };

  it("builds a high-priority message on the 'messages' channel with the chat link", () => {
    const m = fcmMessage("tok", { ...payload, vibrate: [120, 60, 240] }).message;
    expect(m).toMatchObject({
      token: "tok",
      notification: { title: "Meenu", body: "Dinner tonight?" },
      data: { url: "/chat/abc" },
      android: { priority: "HIGH", notification: { channel_id: "messages", vibrate_timings: ["0.120s", "0.060s", "0.240s"] } },
    });
  });

  it("gets an access token, sends, and reports uninstalled apps as expired", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    let sendStatus = 200;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      if (url.includes("oauth2")) return Response.json({ access_token: "ya29.token", expires_in: 3600 });
      if (sendStatus === 200) return Response.json({ name: "projects/ghostline-1/messages/1" });
      return Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
    }) as typeof fetch;

    expect(await sendFcm("tok", payload, fakeFetch, account)).toBe("sent");
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1]!.url).toBe("https://fcm.googleapis.com/v1/projects/ghostline-1/messages:send");
    expect(JSON.parse(calls[1]!.body).message.token).toBe("tok");

    sendStatus = 404;
    expect(await sendFcm("old", payload, fakeFetch, account)).toBe("expired");
    // The access token is reused.
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    expect(await sendFcm("tok", payload, fakeFetch, null)).toBe("not_configured");
  });
});

describe("iPhone (Apple Push Notification service)", () => {
  const env = { APNS_KEY_ID: "ABC1234567", APNS_TEAM_ID: "TEAM123456", APNS_PRIVATE_KEY: Buffer.from(ecPem).toString("base64") };

  it("needs a key id, team id and key", () => {
    expect(readApnsConfig({})).toBeNull();
    expect(readApnsConfig({ ...env, APNS_KEY_ID: "short" })).toBeNull();
    expect(readApnsConfig(env)).toMatchObject({ bundleId: "com.jaiprakash.ghostline", environment: "production" });
  });

  it("sends an alert with the chat link, and falls back to the test servers for Xcode builds", async () => {
    const config = readApnsConfig(env)!;
    const seen: Array<{ host: string; headers: Record<string, string> }> = [];
    let answer = [{ status: 200 }];
    const transport: ApnsTransport = async (host, _path, headers) => {
      seen.push({ host, headers });
      return answer.shift() ?? { status: 500 };
    };
    expect(await sendApns("ab12", payload, transport, config)).toBe("sent");
    expect(seen[0]).toMatchObject({
      host: "api.push.apple.com",
      headers: { "apns-topic": "com.jaiprakash.ghostline", "apns-push-type": "alert", "apns-priority": "10" },
    });
    const jwt = decode(seen[0]!.headers.authorization!.replace("bearer ", ""));
    expect(jwt.header).toEqual({ alg: "ES256", kid: "ABC1234567" });
    expect(jwt.claims.iss).toBe("TEAM123456");

    answer = [{ status: 400, reason: "BadDeviceToken" } as never, { status: 200 }];
    expect(await sendApns("dev1", payload, transport, config)).toBe("sent");
    expect(seen.at(-1)!.host).toBe("api.sandbox.push.apple.com");

    answer = [{ status: 410, reason: "Unregistered" } as never];
    expect(await sendApns("gone", payload, transport, config)).toBe("expired");
    expect(apnsBody(payload)).toEqual({
      aps: { alert: { title: "Meenu", body: "Dinner tonight?" }, sound: "default", "thread-id": "abc" },
      url: "/chat/abc",
      tag: "abc",
    });
  });
});
