export const BUDDY_SALT = "friend-2026-401";

const FNV_OFFSET = 2166136261 >>> 0;
const FNV_PRIME = 16777619 >>> 0;

export type RuntimeMode = "auto" | "node" | "bun";

export function hashFNV1a(text: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function hashUserIdToSeed(
  userID: string,
  runtime: RuntimeMode,
  salt = BUDDY_SALT,
): number {
  if (runtime === "auto" || runtime === "node") {
    return hashFNV1a(userID + salt);
  }

  if (typeof Bun === "undefined") {
    throw new Error("Bun runtime hashing requires running this command under Bun.");
  }

  return Number(BigInt(Bun.hash(userID + salt)) & 0xffffffffn);
}
