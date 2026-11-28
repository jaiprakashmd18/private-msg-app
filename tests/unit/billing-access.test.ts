import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireBillingMember } from "@/lib/billing-access.server";

const { getClaims, maybeSingle } = vi.hoisted(() => ({ getClaims: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getClaims },
    rpc: () => ({ maybeSingle }),
  }),
}));

const request = () => new Request("https://example.test/api/billing/checkout", {
  method: "POST",
  headers: { origin: "https://example.test", host: "example.test" },
});

describe("billing member access", () => {
  beforeEach(() => {
    getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "member" } } });
    maybeSingle.mockReset().mockResolvedValue({ data: { user_id: "member", is_active: true } });
  });

  it("permits an active member to start checkout", async () => {
    await expect(requireBillingMember(request(), true)).resolves.toMatchObject({ user_id: "member" });
  });

  it("rejects signed-out and disabled accounts", async () => {
    maybeSingle.mockResolvedValue({ data: { is_active: false } });
    await expect(requireBillingMember(request())).rejects.toMatchObject({ status: 403 });
    getClaims.mockResolvedValue({ data: null });
    await expect(requireBillingMember(request())).rejects.toMatchObject({ status: 401 });
  });

  it("does not start another checkout for an account with Plus", async () => {
    maybeSingle.mockResolvedValue({ data: { is_active: true, is_plus: true } });
    await expect(requireBillingMember(request(), true)).rejects.toMatchObject({ status: 409 });
    await expect(requireBillingMember(request())).resolves.toMatchObject({ is_plus: true });
  });
});
