import { randomBytes, createHash } from "node:crypto";

const TOKEN_BYTES = 32;

export function createSessionToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token) {
  if (typeof token !== "string" || token.length < 40) {
    throw new Error("Invalid session token.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookie(token, maxAgeSeconds = 60 * 60 * 24 * 7, secure = true) {
  const attributes = [
    `mercora_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) attributes.splice(3, 0, "Secure");
  return attributes.join("; ");
}
