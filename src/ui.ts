/**
 * DOM chrome layered over the canvas: the account button/panel (guest identity,
 * signup/upgrade, login, logout) and the leaderboard panel (global + daily with
 * the player's own rank highlighted). Kept as plain DOM rather than canvas so
 * forms, scrolling and text input behave natively on mobile.
 *
 * All backend interaction goes through `Api`; every call degrades gracefully so
 * the game is fully playable offline — the chrome just shows a muted state.
 */
import type { Api, LeaderboardEntry, RankInfo } from "./api";
import { ApiError } from "./api";
import type { Game } from "./game";
import type { Storage } from "./storage";

type Scope = "global" | "daily";

function el<K extends keyof HTMLElementTagNameMap>(id: string): HTMLElementTagNameMap[K] {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as HTMLElementTagNameMap[K];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export class UI {
  private overlay = el<"div">("overlay");
  private sheetBody = el<"div">("sheetBody");
  private accountBtn = el<"button">("accountBtn");
  private lbBtn = el<"button">("lbBtn");
  private toast = el<"div">("toast");
  private toastTimer = 0;
  private lbScope: Scope = "global";

  constructor(
    private api: Api,
    private storage: Storage,
    private game: Game,
  ) {
    this.accountBtn.addEventListener("click", () => this.openAccount());
    this.lbBtn.addEventListener("click", () => this.openLeaderboard());
    el<"button">("closeBtn").addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    // Hide the bottom chrome while actively playing so it can't be mis-tapped.
    this.game.onStateChange = (s) =>
      document.body.classList.toggle("playing", s === "playing");
  }

  /** Establish identity and pull the cloud save on first load. */
  async boot() {
    try {
      await this.api.init();
    } catch (e) {
      // Device was upgraded to a real account elsewhere — prompt a login.
      if (e instanceof ApiError && e.status === 409) {
        this.showAccountLabel();
        this.openAccount();
        return;
      }
    }
    await this.syncFromCloud();
    this.showAccountLabel();
  }

  /** Pull the cloud save and merge it into local storage. */
  private async syncFromCloud() {
    const cloud = await this.api.getSave();
    if (cloud) {
      this.storage.hydrate(cloud);
      // If local was actually ahead, push it back so the cloud catches up.
      if (this.storage.highScore > cloud.highScore) {
        this.api.putSave(this.storage.snapshot());
      }
    }
  }

  /** Called by the game when a run ends: persist to cloud + submit the score. */
  async handleRunEnd(score: number, _combo: number) {
    this.api.putSave(this.storage.snapshot());
    const result = await this.api.submitScore(score);
    if (result) {
      // Refresh the rank line if the leaderboard is currently open.
      if (!this.overlay.hidden && this.currentView === "leaderboard") {
        this.renderLeaderboard();
      }
    }
  }

  // ---- account panel ---------------------------------------------------

  private currentView: "account" | "leaderboard" | null = null;

  private showAccountLabel() {
    const u = this.api.user;
    if (!u) {
      this.accountBtn.textContent = this.api.deviceUpgraded ? "● Log in" : "◐ Offline";
      return;
    }
    this.accountBtn.textContent = u.isGuest
      ? `◐ ${u.displayName}`
      : `● ${u.displayName}`;
  }

  private open() {
    this.overlay.hidden = false;
    document.body.classList.add("overlay-open");
  }

  close() {
    this.overlay.hidden = true;
    this.currentView = null;
    document.body.classList.remove("overlay-open");
  }

  private openAccount() {
    this.currentView = "account";
    this.open();
    this.renderAccount("upgrade");
  }

  private renderAccount(tab: "upgrade" | "login") {
    const u = this.api.user;

    if (u && !u.isGuest) {
      this.sheetBody.innerHTML = `
        <h2>Your account</h2>
        <p class="lead"><strong>${esc(u.displayName)}</strong><br>
          <span class="muted">${esc(u.email ?? "")}</span></p>
        <p class="muted">Your high score, currency and rank sync to this
          account on every device.</p>
        <button class="btn danger" id="logoutBtn">Log out</button>
      `;
      el<"button">("logoutBtn").addEventListener("click", () => this.doLogout());
      return;
    }

    if (!u) {
      if (this.api.deviceUpgraded) {
        // This device is linked to a real account but we have no live session
        // (logged out / token revoked). The only way forward is to log in.
        this.sheetBody.innerHTML = `
          <h2>Log in</h2>
          <p class="muted">This device is linked to a Pulse account. Log in to
            load your saved progress and leaderboard rank.</p>
          <form id="authForm" class="form" novalidate>
            <input id="fEmail" type="email" inputmode="email" autocomplete="email"
              placeholder="Email" required />
            <input id="fPass" type="password" autocomplete="current-password"
              placeholder="Password" required />
            <p class="err" id="authErr" hidden></p>
            <button class="btn primary" type="submit" id="authSubmit">Log in</button>
          </form>
        `;
        el<"form">("authForm").addEventListener("submit", (e) => {
          e.preventDefault();
          this.submitAuth("login");
        });
        return;
      }
      this.sheetBody.innerHTML = `
        <h2>Offline</h2>
        <p class="muted">Couldn't reach the Pulse servers. Your progress is
          saved on this device and will sync when you're back online.</p>
      `;
      return;
    }

    // Guest — offer upgrade (keeps the current save) or login.
    const guestName = esc(u.displayName);
    this.sheetBody.innerHTML = `
      <h2>Save your progress</h2>
      <p class="lead">Playing as <strong>${guestName}</strong>
        <span class="badge">guest</span></p>
      <p class="muted">Create a free account so your high score, unlocks and
        leaderboard rank follow you to any device — your current progress carries
        over.</p>
      <div class="tabs">
        <button class="tab ${tab === "upgrade" ? "on" : ""}" id="tabUpgrade">Create account</button>
        <button class="tab ${tab === "login" ? "on" : ""}" id="tabLogin">Log in</button>
      </div>
      <form id="authForm" class="form" novalidate>
        <input id="fEmail" type="email" inputmode="email" autocomplete="email"
          placeholder="Email" required />
        <input id="fPass" type="password"
          autocomplete="${tab === "upgrade" ? "new-password" : "current-password"}"
          placeholder="Password (8+ characters)" required />
        ${
          tab === "upgrade"
            ? `<input id="fName" type="text" maxlength="40" placeholder="Display name (optional)" />`
            : ""
        }
        <p class="err" id="authErr" hidden></p>
        <button class="btn primary" type="submit" id="authSubmit">
          ${tab === "upgrade" ? "Create account" : "Log in"}
        </button>
      </form>
      ${
        tab === "login"
          ? `<p class="muted small">Logging in loads that account's cloud save on this device.</p>`
          : ""
      }
    `;

    el<"button">("tabUpgrade").addEventListener("click", () => this.renderAccount("upgrade"));
    el<"button">("tabLogin").addEventListener("click", () => this.renderAccount("login"));
    el<"form">("authForm").addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitAuth(tab);
    });
  }

  private async submitAuth(tab: "upgrade" | "login") {
    const email = el<"input">("fEmail").value.trim();
    const pass = el<"input">("fPass").value;
    const name =
      tab === "upgrade" ? el<"input">("fName")?.value.trim() : undefined;
    const errEl = el<"p">("authErr");
    const btn = el<"button">("authSubmit");
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = tab === "upgrade" ? "Creating…" : "Logging in…";

    try {
      if (tab === "upgrade") {
        await this.api.upgrade(email, pass, name || undefined);
      } else {
        await this.api.login(email, pass);
      }
      await this.syncFromCloud();
      this.showAccountLabel();
      this.toastMsg(
        tab === "upgrade"
          ? "Account created — progress saved!"
          : `Welcome back, ${this.api.user?.displayName ?? ""}!`,
      );
      this.close();
    } catch (e) {
      errEl.textContent = this.authError(e, tab);
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = tab === "upgrade" ? "Create account" : "Log in";
    }
  }

  private authError(e: unknown, tab: "upgrade" | "login"): string {
    if (e instanceof ApiError) {
      switch (e.code) {
        case "email_taken":
          return "That email is already registered — try logging in.";
        case "invalid_email":
          return "Enter a valid email address.";
        case "invalid_password":
          return "Password must be 8–200 characters.";
        case "invalid_credentials":
          return "Wrong email or password.";
        case "rate_limited":
          return "Too many attempts — wait a minute and try again.";
        case "already_account":
          return "You're already signed in.";
      }
    }
    return tab === "upgrade"
      ? "Couldn't create the account. Check your connection and retry."
      : "Couldn't log in. Check your connection and retry.";
  }

  private async doLogout() {
    const btn = el<"button">("logoutBtn");
    btn.disabled = true;
    btn.textContent = "Logging out…";
    await this.api.logout();
    await this.syncFromCloud();
    this.showAccountLabel();
    this.toastMsg("Logged out — back to guest play.");
    this.renderAccount("upgrade");
  }

  // ---- leaderboard panel ----------------------------------------------

  private openLeaderboard() {
    this.currentView = "leaderboard";
    this.open();
    this.renderLeaderboard();
  }

  private async renderLeaderboard() {
    const scope = this.lbScope;
    this.sheetBody.innerHTML = `
      <h2>Leaderboard</h2>
      <div class="tabs">
        <button class="tab ${scope === "global" ? "on" : ""}" id="tabGlobal">All-time</button>
        <button class="tab ${scope === "daily" ? "on" : ""}" id="tabDaily">Today</button>
      </div>
      <div id="lbRank" class="lb-rank muted">Loading your rank…</div>
      <ol id="lbList" class="lb-list"><li class="muted lb-loading">Loading…</li></ol>
    `;
    el<"button">("tabGlobal").addEventListener("click", () => {
      this.lbScope = "global";
      this.renderLeaderboard();
    });
    el<"button">("tabDaily").addEventListener("click", () => {
      this.lbScope = "daily";
      this.renderLeaderboard();
    });

    const [entries, rank] = await Promise.all([
      this.api.leaderboard(scope, 25),
      this.api.myRank(scope),
    ]);
    // Guard against a scope switch mid-fetch.
    if (this.lbScope !== scope || this.currentView !== "leaderboard") return;

    this.paintRank(rank, scope);
    this.paintList(entries);
  }

  private paintRank(rank: RankInfo | null, scope: Scope) {
    const node = document.getElementById("lbRank");
    if (!node) return;
    const label = scope === "global" ? "All-time" : "Today";
    if (!rank || rank.rank === null) {
      node.innerHTML = `<span class="muted">${label}: no ranked run yet — play a round to get on the board.</span>`;
      return;
    }
    node.innerHTML = `You're <strong>#${rank.rank}</strong> of ${rank.total}
      <span class="muted">· ${label} best ${rank.score}</span>`;
  }

  private paintList(entries: LeaderboardEntry[]) {
    const list = document.getElementById("lbList");
    if (!list) return;
    if (!entries.length) {
      list.innerHTML = `<li class="muted">No scores yet — be the first!</li>`;
      return;
    }
    const meId = this.api.user?.id;
    list.innerHTML = entries
      .map((e) => {
        const mine = e.userId === meId ? " mine" : "";
        return `<li class="lb-row${mine}">
          <span class="lb-pos">${e.rank}</span>
          <span class="lb-name">${esc(e.displayName)}${e.userId === meId ? " <span class='badge'>you</span>" : ""}</span>
          <span class="lb-score">${e.score}</span>
        </li>`;
      })
      .join("");
  }

  // ---- toast -----------------------------------------------------------

  private toastMsg(msg: string) {
    this.toast.textContent = msg;
    this.toast.hidden = false;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("show");
      this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 300);
    }, 2600);
  }
}
