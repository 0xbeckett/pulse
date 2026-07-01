import type { Save, User } from "../db/store.ts";

/** Public shape of a user — never leaks the password hash. */
export function publicUser(u: User) {
  return {
    id: u.id,
    isGuest: u.isGuest,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt,
  };
}

/** Public shape of a cloud save. */
export function publicSave(s: Save) {
  return {
    highScore: s.highScore,
    currency: s.currency,
    unlocks: s.unlocks,
    settings: s.settings,
    updatedAt: s.updatedAt,
  };
}

/** The default empty save returned before a player has written anything. */
export function emptySave() {
  return {
    highScore: 0,
    currency: 0,
    unlocks: [] as unknown[],
    settings: {} as Record<string, unknown>,
    updatedAt: 0,
  };
}
