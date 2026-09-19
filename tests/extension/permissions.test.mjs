import { describe, expect, it } from "vitest";
import { retainOnlyOriginPermission } from "../../extension/lib/permissions.mjs";

function fakePermissions(initialOrigins, { removable = true } = {}) {
  const origins = new Set(initialOrigins);
  const removals = [];
  return {
    origins,
    removals,
    async contains(request) {
      return request.origins.every((origin) => origins.has(origin));
    },
    async getAll() {
      return { origins: [...origins], permissions: ["activeTab", "storage"] };
    },
    async remove(request) {
      removals.push([...request.origins]);
      if (!removable) return false;
      for (const origin of request.origins) origins.delete(origin);
      return true;
    },
  };
}

describe("optional origin cleanup", () => {
  it("retains only the selected instance origin and removes restored legacy grants", async () => {
    const selected = "https://curio.example.test/*";
    const permissions = fakePermissions([
      "https://*/*",
      "https://old.example.test/*",
      "http://localhost/*",
      selected,
    ]);

    await expect(retainOnlyOriginPermission(permissions, selected)).resolves.toEqual([
      "https://*/*",
      "https://old.example.test/*",
      "http://localhost/*",
    ]);
    expect([...permissions.origins]).toEqual([selected]);
    await expect(retainOnlyOriginPermission(permissions, selected)).resolves.toEqual([]);
  });

  it("reports when Chrome refuses to remove obsolete origin access", async () => {
    const permissions = fakePermissions(
      ["https://old.example.test/*", "https://curio.example.test/*"],
      { removable: false },
    );

    await expect(
      retainOnlyOriginPermission(permissions, "https://curio.example.test/*"),
    ).rejects.toThrow(/obsolete site access/u);
  });
});
