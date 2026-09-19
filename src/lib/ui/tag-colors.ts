import type { CSSProperties } from "react";

type Rgb = {
  red: number;
  green: number;
  blue: number;
};

const FALLBACK_TAG_COLOR = "#64748b";
const DARK_TEXT = "#1b254b";
const LIGHT_TEXT = "#ffffff";
const MAXIMUM_CONTRAST_DARK_TEXT = "#000000";
const MINIMUM_TEXT_CONTRAST = 4.5;

function parseHexColor(color: string): Rgb {
  const normalized = /^#[\dA-Fa-f]{6}$/.test(color) ? color : FALLBACK_TAG_COLOR;
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixWithWhite(color: string, colorWeight: number): string {
  const source = parseHexColor(color);
  return toHex({
    red: source.red * colorWeight + 255 * (1 - colorWeight),
    green: source.green * colorWeight + 255 * (1 - colorWeight),
    blue: source.blue * colorWeight + 255 * (1 - colorWeight),
  });
}

function mixWithBlack(color: string, colorWeight: number): string {
  const source = parseHexColor(color);
  return toHex({
    red: source.red * colorWeight,
    green: source.green * colorWeight,
    blue: source.blue * colorWeight,
  });
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const { red, green, blue } = parseHexColor(color);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

function contrastRatio(first: string, second: string): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Uses the stored taxonomy colour without changing it, while keeping chip text
 * readable against the softly tinted background.
 */
export function getSoftTagStyle(color: string): CSSProperties {
  const normalized = /^#[\dA-Fa-f]{6}$/.test(color) ? color : FALLBACK_TAG_COLOR;
  const backgroundColor = mixWithWhite(normalized, 0.1);

  return {
    backgroundColor,
    borderColor: mixWithWhite(normalized, 0.45),
    color: DARK_TEXT,
  };
}

/** A borderless, taxonomy-coloured chip matching the public catalogue cards. */
export function getTintedTagStyle(color: string): CSSProperties {
  const normalized = /^#[\dA-Fa-f]{6}$/.test(color) ? color.toLowerCase() : FALLBACK_TAG_COLOR;
  const backgroundColor = mixWithWhite(normalized, 0.12);
  let textColor = normalized;

  for (let weight = 0.95; contrastRatio(textColor, backgroundColor) < MINIMUM_TEXT_CONTRAST;) {
    textColor = mixWithBlack(normalized, weight);
    weight -= 0.05;
  }

  return {
    backgroundColor,
    color: textColor,
  };
}

/** Choose the higher-contrast label for a chip filled with the stored colour. */
export function getSolidTagStyle(color: string): CSSProperties {
  const normalized = /^#[\dA-Fa-f]{6}$/.test(color) ? color : FALLBACK_TAG_COLOR;
  const darkContrast = contrastRatio(normalized, DARK_TEXT);
  const lightContrast = contrastRatio(normalized, LIGHT_TEXT);
  const foregroundColor =
    darkContrast >= MINIMUM_TEXT_CONTRAST
      ? DARK_TEXT
      : lightContrast >= MINIMUM_TEXT_CONTRAST
        ? LIGHT_TEXT
        : MAXIMUM_CONTRAST_DARK_TEXT;

  return {
    backgroundColor: normalized,
    borderColor: normalized,
    color: foregroundColor,
  };
}

/**
 * Fill a selected filter chip with its taxonomy colour and always use white
 * text. Light colours are progressively darkened until they meet WCAG AA for
 * normal text (4.5:1), while preserving the original hue.
 */
export function getWhiteTextTagStyle(color: string): CSSProperties {
  const normalized = /^#[\dA-Fa-f]{6}$/.test(color) ? color.toLowerCase() : FALLBACK_TAG_COLOR;
  let backgroundColor = normalized;

  for (
    let colorWeight = 95;
    contrastRatio(backgroundColor, LIGHT_TEXT) < MINIMUM_TEXT_CONTRAST;
    colorWeight -= 5
  ) {
    backgroundColor = mixWithBlack(normalized, Math.max(0, colorWeight) / 100);
  }

  return {
    backgroundColor,
    borderColor: backgroundColor,
    color: LIGHT_TEXT,
  };
}

export function getTagAccentColor(color: string): string {
  return /^#[\dA-Fa-f]{6}$/.test(color) ? color : FALLBACK_TAG_COLOR;
}
