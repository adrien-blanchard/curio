/** A stable path makes a replayed workflow upload idempotent. */
export function getWorkflowThumbnailObjectPath(entryId: string, attemptId: string): string {
  return `${entryId}/workflow-${attemptId}.webp`;
}
