/** Small hand-rolled validators — no schema library needed for this surface. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
}

export function isValidPassword(v: unknown): v is string {
  // Deliberately permissive on composition, strict on length bounds.
  return typeof v === "string" && v.length >= 8 && v.length <= 200;
}

export function isValidDisplayName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.length <= 40;
}

export function isValidDeviceId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 8 && v.length <= 200;
}

/** Coerce to a safe non-negative integer, or null if it isn't one. */
export function safeNonNegInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  if (v < 0 || v > Number.MAX_SAFE_INTEGER) return null;
  return v;
}

/** Cap the serialized size of an opaque JSON blob to prevent abuse. */
export function withinJsonSizeLimit(v: unknown, maxBytes = 16 * 1024): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(v ?? null)).length <= maxBytes;
  } catch {
    return false;
  }
}
