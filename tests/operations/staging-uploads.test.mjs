import { describe, expect, it, vi } from "vitest";

import {
  collectStaleUploadPaths,
  removeStaleUploadPaths,
} from "../../src/lib/operations/staging-uploads.mjs";

const entryId = "00000000-0000-4000-8000-000000000401";
const oldUploadId = "00000000-0000-4000-8000-000000000402";
const freshUploadId = "00000000-0000-4000-8000-000000000403";

function bucketFixture() {
  const list = vi.fn(async (prefix) => {
    if (prefix === "") {
      return { data: [{ name: entryId }, { name: "untrusted-folder" }], error: null };
    }
    if (prefix === entryId) {
      return {
        data: [
          {
            name: `${oldUploadId}.upload`,
            created_at: "2026-08-14T00:00:00.000Z",
          },
          {
            name: `${freshUploadId}.upload`,
            created_at: "2026-08-14T01:50:00.000Z",
          },
          { name: "do-not-delete.txt", created_at: "2020-01-01T00:00:00.000Z" },
        ],
        error: null,
      };
    }
    throw new Error(`Unexpected prefix ${prefix}`);
  });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  return { list, remove };
}

describe("stale thumbnail upload reconciliation", () => {
  it("collects only validated private upload paths older than the threshold", async () => {
    const bucket = bucketFixture();
    const result = await collectStaleUploadPaths(bucket, {
      now: Date.parse("2026-08-14T02:00:00.000Z"),
      olderThanMs: 60 * 60 * 1000,
      limit: 100,
    });

    expect(result).toEqual({
      paths: [`${entryId}/${oldUploadId}.upload`],
      scanned: 2,
      skippedWithoutTimestamp: 0,
    });
  });

  it("removes only the precomputed bounded paths", async () => {
    const bucket = bucketFixture();
    const paths = Array.from({ length: 101 }, (_, index) => {
      const uploadId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
      return `${entryId}/${uploadId}.upload`;
    });
    await expect(removeStaleUploadPaths(bucket, paths)).resolves.toBe(101);
    expect(bucket.remove).toHaveBeenCalledTimes(2);
    expect(bucket.remove.mock.calls[0][0]).toHaveLength(100);
    expect(bucket.remove.mock.calls[1][0]).toHaveLength(1);
  });

  it("rejects unbounded cleanup parameters before accessing storage", async () => {
    const bucket = bucketFixture();
    await expect(collectStaleUploadPaths(bucket, { limit: 10_001 })).rejects.toThrow(
      "INVALID_STAGING_CLEANUP_LIMIT",
    );
    expect(bucket.list).not.toHaveBeenCalled();
  });
});
