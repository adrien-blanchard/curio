import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { getAuthEnv } from "@/lib/env/server";

export const API_TOKEN_PREFIX = "curio_pat_";
const TOKEN_BYTES = 32;

export type GeneratedApiToken = {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
};

export function hashApiToken(rawToken: string) {
  const pepper = getAuthEnv().API_TOKEN_PEPPER;
  return createHmac("sha256", pepper).update(rawToken, "utf8").digest("hex");
}

export function generateApiToken(): GeneratedApiToken {
  const rawToken = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return {
    rawToken,
    tokenHash: hashApiToken(rawToken),
    tokenPrefix: rawToken.slice(0, API_TOKEN_PREFIX.length + 8),
  };
}

export function isApiToken(value: string) {
  return (
    value.startsWith(API_TOKEN_PREFIX) &&
    value.length >= API_TOKEN_PREFIX.length + 32 &&
    value.length <= API_TOKEN_PREFIX.length + 128
  );
}
