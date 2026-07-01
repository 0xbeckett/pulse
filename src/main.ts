/** Bootstrap: wire input, mute toggle, resize, and kick off the loop. */
import { Audio } from "./audio";
import { Game } from "./game";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const muteBtn = document.getElementById("mute") as HTMLButtonElement;

const audio = new Audio();
const game = new Game(canvas, audio);

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

game.start_loop();
