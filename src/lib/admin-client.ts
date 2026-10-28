"use client";

/** Calls an admin API route (service-role operations) and throws on failure. */
export async function adminRequest<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "DELETE",
): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" } });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } } & T;
  if (!res.ok || !json.ok) {
    throw Object.assign(new Error(json.error?.message ?? "Request failed"), { code: "22023" });
  }
  return json;
}
