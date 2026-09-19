import "server-only";

import { lookup } from "node:dns/promises";

import {
  PublicUrlError,
  canonicalizeUrl,
  getIpAddressFamily,
  isPublicIpAddress,
  normalizedHostname,
} from "./public-url-core";

export {
  PublicUrlError,
  canonicalizeUrl,
  getYouTubeVideoId,
  isPublicIpAddress,
} from "./public-url-core";

export type ResolvedAddress = { address: string; family: number };
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export async function resolvePublicUrl(
  input: string,
  resolver: HostResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<string> {
  const canonicalUrl = canonicalizeUrl(input);
  const hostname = normalizedHostname(new URL(canonicalUrl));
  if (getIpAddressFamily(hostname) !== 0) return canonicalUrl;

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new PublicUrlError("UNRESOLVABLE_HOST", "The URL hostname could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new PublicUrlError(
      "UNRESOLVABLE_HOST",
      "The URL hostname did not resolve to an address.",
    );
  }
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new PublicUrlError(
      "PRIVATE_HOST",
      "The URL hostname resolves to a private, local or reserved address.",
    );
  }
  return canonicalUrl;
}
