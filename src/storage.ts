/** localStorage-backed persistence for high score and best combo. */
const SCORE_KEY = "pulse.highScore";
const COMBO_KEY = "pulse.bestCombo";
const PLAYS_KEY = "pulse.plays";

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

export class Storage {
  highScore = readInt(SCORE_KEY);
  bestCombo = readInt(COMBO_KEY);
  plays = readInt(PLAYS_KEY);

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
}
