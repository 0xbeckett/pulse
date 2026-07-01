import { chromium } from "playwright-core";
const CH = "/home/beckett/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const b = await chromium.launch({ executablePath: CH, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await p.waitForTimeout(300);
// Start and thread a couple gates by pulsing thrust to stay mid-screen.
await p.mouse.move(195, 420);
for (let i = 0; i < 10; i++) { await p.mouse.down(); await p.waitForTimeout(140); await p.mouse.up(); await p.waitForTimeout(120); }
await p.mouse.down();
await p.screenshot({ path: "/home/beckett/Projects/pulse/dist/.play.png" });
await p.mouse.up();
await b.close();
console.log("PLAY_SHOT_OK");
