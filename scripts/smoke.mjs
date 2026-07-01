// Headless smoke test: load the game, simulate play, capture errors + a shot.
import { chromium } from "playwright-core";

const CH = "/home/beckett/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

const errors = [];
const browser = await chromium.launch({ executablePath: CH, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});

await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Confirm the game object mounted and canvas is sized.
const info = await page.evaluate(() => {
  const c = document.getElementById("canvas");
  return { w: c?.width, h: c?.height, hasCtx: !!c?.getContext("2d") };
});
console.log("canvas:", JSON.stringify(info));

// Start playing: tap to start, then hold/release a few cycles.
const cx = 195, cy = 420;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.waitForTimeout(500);
await page.mouse.up();
await page.waitForTimeout(400);
for (let i = 0; i < 6; i++) {
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1500); // let it likely crash -> game over

await page.screenshot({ path: "/home/beckett/Projects/pulse/dist/.smoke.png" });

// Verify localStorage got written (play counted / score persisted path).
const ls = await page.evaluate(() => ({
  plays: localStorage.getItem("pulse.plays"),
  high: localStorage.getItem("pulse.highScore"),
}));
console.log("localStorage:", JSON.stringify(ls));

await browser.close();

if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("SMOKE_OK");
