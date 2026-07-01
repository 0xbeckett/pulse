/**
 * Static build for Pulse.
 * Bundles the TS game into a single minified JS file and assembles the
 * offline-capable static site into ./dist.
 */
import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const pub = join(root, "public");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Bundle the game.
const result = await Bun.build({
  entrypoints: [join(root, "src", "main.ts")],
  outdir: dist,
  minify: true,
  target: "browser",
  naming: "bundle.[hash].js",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const jsFile = result.outputs.find((o) => o.path.endsWith(".js"));
if (!jsFile) {
  console.error("build produced no JS output");
  process.exit(1);
}
const bundleName = jsFile.path.split("/").pop()!;

// Copy static public assets (index.html, manifest, sw, icons).
if (existsSync(pub)) {
  cpSync(pub, dist, { recursive: true });
}

// Inject the hashed bundle name into index.html.
const indexPath = join(dist, "index.html");
const html = await Bun.file(indexPath).text();
await Bun.write(indexPath, html.replace("__BUNDLE__", bundleName));

// Inject the hashed bundle name into the service worker so it caches it.
const swPath = join(dist, "sw.js");
if (existsSync(swPath)) {
  const sw = await Bun.file(swPath).text();
  await Bun.write(swPath, sw.replace("__BUNDLE__", bundleName));
}

console.log(`Built dist/ with ${bundleName}`);
