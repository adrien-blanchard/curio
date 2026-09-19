import { describe, expect, it } from "vitest";

import { catalogAuthorEmailSchema } from "@/lib/auth/catalog-author";

describe("catalogAuthorEmailSchema", () => {
  it.each(["member@example.test", "a+b@sub.example.co", "first_last@example.com"])(
    "accepts a database-valid catalog author address: %s",
    (email) => {
      expect(catalogAuthorEmailSchema.parse(email)).toBe(email);
    },
  );

  it("normalizes surrounding whitespace and case", () => {
    expect(catalogAuthorEmailSchema.parse("  Member@Example.TEST ")).toBe("member@example.test");
  });

  it.each(["x@y", "x@y.z", "x@y.1", "x@y.c0", "a@b-.co", "a..b@example.com"])(
    "rejects an address outside the database/UI intersection: %s",
    (email) => {
      expect(catalogAuthorEmailSchema.safeParse(email).success).toBe(false);
    },
  );
});
