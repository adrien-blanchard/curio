import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl as canonicalizeWorkflowUrl,
  getIpAddressFamily,
  getYouTubeVideoId,
  isPublicIpAddress,
} from "@/lib/security/public-url-core";
import { canonicalizeUrl as canonicalizeServerUrl } from "@/lib/security/public-url";

describe("workflow-safe public URL core", () => {
  it.each([
    [
      "https://Example.com/repo/?utm_source=test&b=2&a=1#readme",
      "https://example.com/repo?a=1&b=2",
    ],
    ["https://example.com/path///?token=secret&id=7", "https://example.com/path?id=7"],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://[2606:4700:4700::1111]/path", "https://[2606:4700:4700::1111]/path"],
  ])("keeps server and workflow canonicalization in parity for %s", (input, expected) => {
    expect(canonicalizeWorkflowUrl(input)).toBe(expected);
    expect(canonicalizeServerUrl(input)).toBe(expected);
  });

  it.each([
    ["8.8.8.8", 4],
    ["93.184.216.34", 4],
    ["2606:4700:4700::1111", 6],
    ["[2001:4860:4860::8888]", 6],
  ] as const)("accepts the public IP address %s", (address, family) => {
    expect(getIpAddressFamily(address)).toBe(family);
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("rejects the private or reserved IP address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["1.2.3", "01.2.3.4", "999.1.1.1", "2001:db8:0:0:0:0:0:", "not-an-ip"])(
    "does not misclassify invalid IP syntax %s",
    (address) => {
      expect(getIpAddressFamily(address)).toBe(0);
      expect(isPublicIpAddress(address)).toBe(false);
    },
  );

  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.example/watch?v=dQw4w9WgXcQ", null],
    ["https://youtube.com/watch?v=too-short", null],
    ["not a URL", null],
  ])("extracts YouTube IDs safely from %s", (input, expected) => {
    expect(getYouTubeVideoId(input)).toBe(expected);
  });
});
