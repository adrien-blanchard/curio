import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import { synchronizeAllowedEmailAccess } from "@/lib/auth/domain-configuration";

describe("database email-access synchronization", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it("normalizes, deduplicates, and atomically replaces both allowlists", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(
      synchronizeAllowedEmailAccess(
        [" Second.Example.Test ", "example.test", "example.test"],
        [" Person@Example.Test ", "person@example.test"],
      ),
    ).resolves.toBeUndefined();
    await expect(
      synchronizeAllowedEmailAccess(
        ["example.test", "second.example.test"],
        ["person@example.test"],
      ),
    ).resolves.toBeUndefined();

    expect(mocks.rpc).toHaveBeenCalledWith("replace_allowed_email_access", {
      p_domains: ["example.test", "second.example.test"],
      p_addresses: ["person@example.test"],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed on database errors and retries the failed set", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    await expect(synchronizeAllowedEmailAccess([], ["invited@example.test"])).rejects.toThrow(
      "synchronization failed",
    );

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      synchronizeAllowedEmailAccess([], ["invited@example.test"]),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
