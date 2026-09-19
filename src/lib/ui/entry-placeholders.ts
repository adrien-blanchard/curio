export const ENTRY_PLACEHOLDER_IMAGES = [
  "/demo/atlas.svg",
  "/demo/openrender.svg",
  "/demo/field-notes.svg",
  "/demo/relay.svg",
  "/demo/nimbus.svg",
  "/demo/materials.svg",
  "/demo/lattice.svg",
  "/demo/prism.svg",
  "/demo/vectordock.svg",
  "/demo/soundstage.svg",
  "/demo/cedar.svg",
  "/demo/patchwork.svg",
] as const;

/**
 * Selects a stable local preview for an entry. Keeping the choice deterministic
 * prevents cards from changing artwork between renders and lets every surface
 * show the same fallback.
 */
export function getEntryPlaceholderImage(key: string): string {
  let hash = 2166136261;

  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return ENTRY_PLACEHOLDER_IMAGES[(hash >>> 0) % ENTRY_PLACEHOLDER_IMAGES.length];
}
