import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** A friendly default display name for fresh guests, e.g. "Pulse-3F9A". */
export function defaultDisplayName(): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `Pulse-${suffix}`;
}
