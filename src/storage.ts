/**
 * localStorage-backed persistence for high score, best combo, and the extra
 * state that also lives in the cloud save (currency, unlocks, settings).
 *
 * localStorage remains the source of truth for offline play; the cloud save is
 * merged in on load (see `hydrate`) and pushed back on run end (`snapshot`).
 */
const SCORE_KEY = "pulse.highScore";
const COMBO_KEY = "pulse.bestCombo";
const PLAYS_KEY = "pulse.plays";
const CURRENCY_KEY = "pulse.currency";
const UNLOCKS_KEY = "pulse.unlocks";
const SETTINGS_KEY = "pulse.settings";

function readInt(key: string): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? "0", 10);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function writeInt(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.floor(value)));
  } catch {
    /* private mode / storage full — degrade silently */
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface CloudState {
  highScore: number;
  currency: number;
  unlocks: unknown[];
  settings: Record<string, unknown>;
}

export class Storage {
  highScore = readInt(SCORE_KEY);
  bestCombo = readInt(COMBO_KEY);
  plays = readInt(PLAYS_KEY);
  currency = readInt(CURRENCY_KEY);
  unlocks: unknown[] = readJson<unknown[]>(UNLOCKS_KEY, []);
  settings: Record<string, unknown> = readJson<Record<string, unknown>>(SETTINGS_KEY, {});

  /** Returns true if this score is a new record. */
  submit(score: number, combo: number): boolean {
    const record = score > this.highScore;
    if (record) {
      this.highScore = Math.floor(score);
      writeInt(SCORE_KEY, this.highScore);
    }
    if (combo > this.bestCombo) {
      this.bestCombo = combo;
      writeInt(COMBO_KEY, this.bestCombo);
    }
    return record;
  }

  countPlay() {
    this.plays += 1;
    writeInt(PLAYS_KEY, this.plays);
  }

  setSetting(key: string, value: unknown) {
    this.settings = { ...this.settings, [key]: value };
    writeJson(SETTINGS_KEY, this.settings);
  }

  /**
   * Merge a cloud save into local state. High score takes the max of the two
   * (so a device with a better local run isn't clobbered by a stale cloud
   * value); currency/unlocks/settings prefer the cloud when it's non-empty.
   * Returns true if anything local changed (i.e. the cloud had more).
   */
  hydrate(cloud: CloudState): boolean {
    let changed = false;
    if (cloud.highScore > this.highScore) {
      this.highScore = cloud.highScore;
      writeInt(SCORE_KEY, this.highScore);
      changed = true;
    }
    if (cloud.currency > this.currency) {
      this.currency = cloud.currency;
      writeInt(CURRENCY_KEY, this.currency);
      changed = true;
    }
    if (Array.isArray(cloud.unlocks) && cloud.unlocks.length > this.unlocks.length) {
      this.unlocks = cloud.unlocks;
      writeJson(UNLOCKS_KEY, this.unlocks);
      changed = true;
    }
    if (
      cloud.settings &&
      typeof cloud.settings === "object" &&
      Object.keys(cloud.settings).length > 0
    ) {
      this.settings = { ...cloud.settings, ...this.settings };
      writeJson(SETTINGS_KEY, this.settings);
    }
    return changed;
  }

  /** The current state to push to the cloud. */
  snapshot(): CloudState {
    return {
      highScore: this.highScore,
      currency: this.currency,
      unlocks: this.unlocks,
      settings: this.settings,
    };
  }
}
