import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const docsPath = "docs/MODEL_PROBING_PROMPT.md";
const portalPath = "artifacts/api-portal/src/lib/modelDiscoveryPrompt.ts";

function readText(path) {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

function extractDocsPrompt(markdown) {
  const match = markdown.match(/```text\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`${docsPath} does not contain a text code block.`);
  return match[1];
}

function extractPortalPrompt(source) {
  const match = source.match(/export const MODEL_DISCOVERY_PROMPT = `((?:\\`|[^`])*)`;/);
  if (!match) throw new Error(`${portalPath} does not export MODEL_DISCOVERY_PROMPT as a template literal.`);
  return match[1].replace(/\\`/g, "`").replace(/\\\$/g, "$");
}

try {
  const docsPrompt = extractDocsPrompt(readText(docsPath));
  const portalPrompt = extractPortalPrompt(readText(portalPath));

  if (docsPrompt !== portalPrompt) {
    console.error("Model discovery prompt drift detected.");
    console.error(`Source of truth: ${docsPath}`);
    console.error(`Mirrored copy: ${portalPath}`);
    exit(1);
  }

  console.log("Model discovery prompt mirror is in sync.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
