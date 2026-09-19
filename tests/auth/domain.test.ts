import { describe, expect, it } from "vitest";

import { emailDomain, isEmailAllowed, normalizeEmail } from "@/lib/auth/domain";

describe("email-domain policy", () => {
  it("normalizes surrounding whitespace and case", () => {
    expect(normalizeEmail("  Person@Example.TEST  ")).toBe("person@example.test");
    expect(emailDomain("  Person@Example.TEST  ")).toBe("example.test");
    expect(isEmailAllowed("  Person@Example.TEST  ", [" EXAMPLE.test "], [])).toBe(true);
  });

  it.each([
    ["person@sub.example.test", ["example.test"]],
    ["person@example.test.evil.invalid", ["example.test"]],
    ["person@notexample.test", ["example.test"]],
    ["person@example.test", ["sub.example.test"]],
  ])("does not treat %s as an implicit match for %j", (email, domains) => {
    expect(isEmailAllowed(email, domains, [])).toBe(false);
  });

  it("supports multiple independently exact domains", () => {
    const domains = ["example.test", "second.example.test"];
    expect(isEmailAllowed("one@example.test", domains, [])).toBe(true);
    expect(isEmailAllowed("two@SECOND.EXAMPLE.TEST", domains, [])).toBe(true);
    expect(isEmailAllowed("three@third.example.test", domains, [])).toBe(false);
  });

  it("allows a case-insensitive exact address without allowing its whole domain", () => {
    const addresses = [" Invited.Person@Example.test "];
    expect(isEmailAllowed("invited.person@EXAMPLE.TEST", [], addresses)).toBe(true);
    expect(isEmailAllowed("someone-else@example.test", [], addresses)).toBe(false);
  });

  it.each([null, undefined, "", "missing-at-sign", "@example.test", "person@"])(
    "rejects an absent or incomplete address: %s",
    (email) => {
      expect(emailDomain(email)).toBeNull();
      expect(isEmailAllowed(email, ["example.test"], ["person@example.test"])).toBe(false);
    },
  );
});
