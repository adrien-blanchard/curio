import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  downloadMicrolinkThumbnail,
  downloadTrustedThumbnail,
  selectTrustedThumbnail,
} from "@/lib/images/thumbnails";

const liveDescribe = process.env.CURIO_LIVE_THUMBNAIL_TEST === "1" ? describe : describe.skip;

liveDescribe("Microlink thumbnail integration (opt-in)", () => {
  it("retrieves image bytes and produces Curio's bounded WebP", async () => {
    const thumbnail = await downloadMicrolinkThumbnail("https://microlink.io", {
      apiKey: process.env.MICROLINK_API_KEY,
    });
    const metadata = await sharp(thumbnail.buffer).metadata();

    expect(thumbnail).toMatchObject({
      contentType: "image/webp",
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    });
    expect(metadata).toMatchObject({
      format: "webp",
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    });
  }, 20_000);

  it("retrieves a GitHub Open Graph preview from the fixed trusted host", async () => {
    const selection = selectTrustedThumbnail("https://github.com/openai/openai-node");
    expect(selection?.provider).toBe("github");
    const thumbnail = await downloadTrustedThumbnail(selection!.url);
    const metadata = await sharp(thumbnail.buffer).metadata();

    expect(metadata).toMatchObject({
      format: "webp",
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    });
  }, 20_000);
});
