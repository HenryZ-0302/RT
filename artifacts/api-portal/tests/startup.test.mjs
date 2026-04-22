import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalDir = path.resolve(__dirname, "..");

async function readPortalFile(...parts) {
  return readFile(path.join(portalDir, ...parts), "utf8");
}

test("portal scripts keep the expected build and serve flow", async () => {
  const pkg = JSON.parse(await readPortalFile("package.json"));

  assert.equal(pkg.scripts.build, "vite build --config vite.config.ts");
  assert.equal(pkg.scripts.serve, "vite preview --config vite.config.ts");
  assert.equal(pkg.scripts.dev, "vite --config vite.config.ts");
});

test("vite config keeps API Portal on port 3000 for dev and preview", async () => {
  const viteConfig = await readPortalFile("vite.config.ts");

  assert.match(viteConfig, /const rawPort = process\.env\.PORT \?\? "3000";/);
  assert.match(viteConfig, /server:\s*\{[\s\S]*?\bport,\s*[\s\S]*?host: true,\s*[\s\S]*?strictPort: true/);
  assert.match(viteConfig, /preview:\s*\{[\s\S]*?\bport,\s*[\s\S]*?host: true,\s*[\s\S]*?strictPort: true/);
});

test("portal artifact keeps the current workflow name and port contract", async () => {
  const artifactToml = await readPortalFile(".replit-artifact", "artifact.toml");

  assert.match(artifactToml, /title = "API Portal"/);
  assert.match(artifactToml, /\[\[services\]\][\s\S]*?name = "API Portal"/);
  assert.match(artifactToml, /localPort = 3000/);
  assert.match(artifactToml, /\[services\.env\][\s\S]*?PORT = "3000"/);
});

test("compatibility settings wait for an unlocked session before loading", async () => {
  const appSource = await readPortalFile("src", "App.tsx");

  assert.doesNotMatch(appSource, /useEffect\(\(\) => \{ fetchSTMode\(\); \}, \[fetchSTMode\]\);/);
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(!gateUnlocked \|\| !apiKey\) return;\s*void fetchSTMode\(apiKey\);\s*\}, \[apiKey, fetchSTMode, gateUnlocked\]\);/s,
  );
});
