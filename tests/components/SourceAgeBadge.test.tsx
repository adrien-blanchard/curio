import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SourceAgeBadge from "@/components/SourceAgeBadge";
import { getSourceAge, isValidSourceDate } from "@/lib/ui/source-age";

describe("source age", () => {
  it("uses calendar anniversaries, including month ends and UTC boundaries", () => {
    expect(getSourceAge("2026-01-31", new Date("2026-04-29T23:59:59Z"))).toBe("recent");
    expect(getSourceAge("2026-01-31", new Date("2026-04-30T00:00:00Z"))).toBe("established");
    expect(getSourceAge("2026-01-31", new Date("2026-07-30T23:59:59Z"))).toBe("established");
    expect(getSourceAge("2026-01-31", new Date("2026-07-31T00:00:00Z"))).toBe("older");
    expect(getSourceAge("2025-11-30", new Date("2026-02-28T00:00:00Z"))).toBe("established");
  });
  it.each([
    null,
    undefined,
    "",
    "2026-02-30",
    "2026-13-01",
    "1899-12-31",
    "2027-01-01",
    "not a date",
  ])("does not invent an age for %s", (date) => {
    expect(getSourceAge(date, new Date("2026-09-19T12:00:00Z"))).toBe("unknown");
  });
  it("recognizes leap days and rejects non-leap February 29", () => {
    expect(isValidSourceDate("2024-02-29")).toBe(true);
    expect(isValidSourceDate("2025-02-29")).toBe(false);
  });
  it("explains what date is measured without relying on colour", () => {
    render(<SourceAgeBadge date="2026-08-01" kind="released" now={new Date("2026-09-19")} />);
    expect(screen.getByLabelText(/Source age: < 3 months/)).toHaveAttribute(
      "title",
      expect.stringContaining("Release date: 2026-08-01"),
    );
  });
});
