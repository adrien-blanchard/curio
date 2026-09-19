import { describe, expect, it } from "vitest";

import { demoEntries } from "@/lib/demo/data";
import {
  getSoftTagStyle,
  getSolidTagStyle,
  getTintedTagStyle,
  getWhiteTextTagStyle,
} from "@/lib/ui/tag-colors";

function relativeLuminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("tag colour styles", () => {
  it("keeps the stored colour for active tags and selects a contrasting label", () => {
    expect(getSolidTagStyle("#eab308")).toEqual({
      backgroundColor: "#eab308",
      borderColor: "#eab308",
      color: "#1b254b",
    });
    expect(getSolidTagStyle("#0075c9")).toEqual({
      backgroundColor: "#0075c9",
      borderColor: "#0075c9",
      color: "#ffffff",
    });
    expect(getSolidTagStyle("#777777")).toEqual({
      backgroundColor: "#777777",
      borderColor: "#777777",
      color: "#000000",
    });
  });

  it("falls back safely when given an unexpected colour", () => {
    expect(getSoftTagStyle("not-a-colour")).toEqual({
      backgroundColor: "#f0f1f3",
      borderColor: "#b9c0cb",
      color: "#1b254b",
    });
  });

  it("keeps every demo tint and invalid colours at readable contrast", () => {
    const demoPalette = new Set(demoEntries.flatMap((entry) => entry.tags.map((tag) => tag.color)));

    for (const color of [...demoPalette, "not-a-colour"]) {
      const style = getTintedTagStyle(color);
      const foreground = String(style.color);
      const background = String(style.backgroundColor);

      expect(foreground).toMatch(/^#[\da-f]{6}$/);
      expect(background).toMatch(/^#[\da-f]{6}$/);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens selected filter colours until white text meets WCAG AA", () => {
    const demoPalette = new Set(demoEntries.flatMap((entry) => entry.tags.map((tag) => tag.color)));

    for (const color of [...demoPalette, "#10b981", "#eab308", "not-a-colour"]) {
      const style = getWhiteTextTagStyle(color);
      const foreground = String(style.color);
      const background = String(style.backgroundColor);

      expect(foreground).toBe("#ffffff");
      expect(String(style.borderColor)).toBe(background);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
