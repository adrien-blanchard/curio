import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repositoryRoot, "scripts", "sync-configuration.mjs");

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ALLOWED_EMAIL_DOMAINS: "",
      ALLOWED_EMAIL_ADDRESSES: "",
      ...overrides,
    },
    encoding: "utf8",
  });
}

describe("configuration synchronization CLI", () => {
  it("validates a domain-only dry run without requiring privileged credentials", () => {
    const result = run({ ALLOWED_EMAIL_DOMAINS: "Example.Test,second.example.test" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry run: 2 allowed email domain(s) validated");
    expect(result.stdout).toContain("0 exact email address(es) validated");
    expect(result.stderr).toBe("");
  });

  it("accepts exact addresses when the domain list is absent", () => {
    const result = run({
      ALLOWED_EMAIL_ADDRESSES: " Person@Example.Test,person@example.test,other@example.test ",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 allowed email domain(s) validated");
    expect(result.stdout).toContain("2 exact email address(es) validated");
    expect(result.stderr).toBe("");
  });

  it("accepts a combined domain and exact-address allowlist", () => {
    const result = run({
      ALLOWED_EMAIL_DOMAINS: "members.example.test",
      ALLOWED_EMAIL_ADDRESSES: "contractor@outside.example.test",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 allowed email domain(s) validated");
    expect(result.stdout).toContain("1 exact email address(es) validated");
  });

  it.each(["@example.test", "localhost", "bad domain.example"])(
    "rejects an invalid domain allowlist: %s",
    (domains) => {
      const result = run({ ALLOWED_EMAIL_DOMAINS: domains });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("ALLOWED_EMAIL_DOMAINS");
    },
  );

  it.each(["not-an-email", "two@@example.test", ".leading@example.test", "user@localhost"])(
    "rejects an invalid exact-address allowlist: %s",
    (address) => {
      const result = run({ ALLOWED_EMAIL_ADDRESSES: address });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("ALLOWED_EMAIL_ADDRESSES");
    },
  );

  it("requires at least one domain or exact address", () => {
    const result = run();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "ALLOWED_EMAIL_DOMAINS or ALLOWED_EMAIL_ADDRESSES",
    );
  });

  it.each([
    ["ALLOWED_EMAIL_DOMAINS", "example.test"],
    ["ALLOWED_EMAIL_ADDRESSES", "person@example.test"],
  ])("rejects more than 100 unique %s values", (name, seed) => {
    const values = Array.from({ length: 101 }, (_, index) => {
      if (name === "ALLOWED_EMAIL_DOMAINS") return `${index}.${seed}`;
      return `${index}-${seed}`;
    });
    const result = run({ [name]: values.join(",") });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(name);
  });
});
