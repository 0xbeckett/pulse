/** Bootstrap: wire input, mute toggle, resize, and kick off the loop. */
import { Audio } from "./audio";
import { Game } from "./game";
import { Storage } from "./storage";
import { Api } from "./api";
import { UI } from "./ui";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const muteBtn = document.getElementById("mute") as HTMLButtonElement;

const audio = new Audio();
const storage = new Storage();
const game = new Game(canvas, audio, storage);
const api = new Api();
const ui = new UI(api, storage, game);

// Talk to the backend: guest identity + cloud-save pull on load, and push the
// save + submit the score on every run end. All of this is best-effort — the
// game stays fully playable if the backend is unreachable.
game.onRunEnd = (score, combo) => ui.handleRunEnd(score, combo);
ui.boot().then(() => {
  // Apply the muted preference from the (now-synced) cloud save.
  const m = storage.settings.muted;
  if (typeof m === "boolean" && m !== audio.muted) {
    audio.muted = m;
    reflectMute();
  }
});

function reflectMute() {
  muteBtn.textContent = audio.muted ? "🔇" : "♪";
  muteBtn.style.color = audio.muted ? "#ff6ea9" : "#7df9ff";
}
reflectMute();

// Pointer input on the canvas only, so the mute button stays independent.
canvas.addEventListener(
  "pointerdown",
  (e) => {
    e.preventDefault();
    game.press();
  },
  { passive: false }
);
const end = (e: Event) => {
  e.preventDefault();
  game.release();
};
canvas.addEventListener("pointerup", end, { passive: false });
canvas.addEventListener("pointercancel", end, { passive: false });
canvas.addEventListener("pointerleave", end, { passive: false });

// Keyboard for desktop testing.
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    game.press();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") game.release();
});

muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
muteBtn.addEventListener("click", (e) => {
  e.preventDefault();
  audio.unlock();
  audio.toggleMute();
  reflectMute();
  // Persist the preference to the cloud save alongside local storage.
  storage.setSetting("muted", audio.muted);
  api.putSave(storage.snapshot());
});

// Keep the canvas matched to the viewport (and safe-area) on rotate/resize.
let resizeRAF = 0;
function onResize() {
  cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => game.resize());
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onResize);
}

// Release thrust if the app is backgrounded mid-hold.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.release();
});

// Debug handle for headless smoke/verify tooling (invisible to players).
(window as unknown as { __pulse?: Game }).__pulse = game;

game.start_loop();
