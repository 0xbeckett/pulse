// One-off end-to-end check against the live public URL in a mobile viewport:
// confirms guest identity on load, cloud save wiring, and the leaderboard UI.
import { chromium } from "playwright-core";

const URL = process.env.PULSE_URL || "https://pulse.0xbeckett.me";
const errors = [];
const CH = "/home/beckett/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
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

await page.goto(URL, { waitUntil: "networkidle" });

// 1) Guest identity should resolve: account chip stops showing the placeholder.
await page.waitForFunction(
  () => {
    const b = document.getElementById("accountBtn");
    return b && b.textContent && !b.textContent.includes("…");
  },
  { timeout: 10000 },
);
const accountLabel = await page.$eval("#accountBtn", (b) => b.textContent.trim());
const token = await page.evaluate(() => localStorage.getItem("pulse.token"));
const deviceId = await page.evaluate(() => localStorage.getItem("pulse.deviceId"));

// 2) Play a quick run so a score gets submitted to the backend.
const cx = 195, cy = 420;
for (let i = 0; i < 8; i++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(260);
}
await page.waitForTimeout(1800); // allow crash -> run end -> score submit

// 3) Open the leaderboard and confirm entries + rank render.
await page.click("#lbBtn");
await page.waitForSelector("#lbList .lb-row", { timeout: 8000 });
const rows = await page.$$eval("#lbList .lb-row", (els) =>
  els.map((e) => e.querySelector(".lb-name")?.textContent?.trim()),
);
const rankText = await page.$eval("#lbRank", (n) => n.textContent.trim());
const mineHighlighted = await page.$$eval(".lb-row.mine", (e) => e.length);

// 4) Switch to daily tab.
await page.click("#tabDaily");
await page.waitForTimeout(1200);
const dailyRankText = await page.$eval("#lbRank", (n) => n.textContent.trim());

await page.screenshot({ path: "/home/beckett/Projects/pulse/dist/.e2e-lb.png" });

console.log("accountLabel:", JSON.stringify(accountLabel));
console.log("hasToken:", !!token, "hasDeviceId:", !!deviceId);
console.log("lbRows:", JSON.stringify(rows));
console.log("globalRank:", JSON.stringify(rankText));
console.log("dailyRank:", JSON.stringify(dailyRankText));
console.log("mineHighlighted:", mineHighlighted);

await browser.close();

const ok =
  accountLabel && !accountLabel.includes("…") &&
  !!token && !!deviceId &&
  rows.length > 0 && rankText.length > 0;
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
console.log(ok && errors.length === 0 ? "E2E_OK" : "E2E_FAIL");
process.exit(ok && errors.length === 0 ? 0 : 1);
