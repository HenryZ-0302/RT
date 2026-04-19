import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiServerDir = path.resolve(__dirname, "..");
const distEntry = path.resolve(apiServerDir, "dist", "index.mjs");
const SERVICE_KEY = "smoke-service-key";

let backendServer;
let backendBaseUrl;
let appProcess;
let appBaseUrl;
let appLogs = "";

function collectStream(stream) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    appLogs += chunk;
  });
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function createFriendBackendServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [{ id: "gpt-5.2", object: "model", owned_by: "openai" }],
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      const body = await readJsonBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-smoke",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "gpt-5.2",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/images/generations") {
      const body = await readJsonBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "gpt-image-1",
        data: [{ b64_json: "aGVsbG8=", mime_type: "image/png" }],
      }));
      return;
    }

    if (req.method === "POST" && /\/api\/v1beta\/models\/.+:generateContent$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: "OK" }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 6,
          candidatesTokenCount: 2,
        },
      }));
      return;
    }

    if (req.method === "POST" && /\/api\/v1beta\/models\/.+:countTokens$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ totalTokens: 6 }));
      return;
    }

    if (req.method === "POST" && /\/api\/v1beta\/models\/.+:generateImages$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        generatedImages: [{
          image: {
            mimeType: "image/png",
            imageBytes: "aGVsbG8=",
          },
        }],
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Unhandled stub route ${req.method} ${url.pathname}` } }));
  });
}

async function waitForHealthy(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/service/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for app health. Logs:\n${appLogs}`);
}

async function authedFetch(pathname, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${SERVICE_KEY}`);
  return fetch(`${appBaseUrl}${pathname}`, { ...init, headers });
}

before(async () => {
  const backendPort = await getFreePort();
  backendServer = createFriendBackendServer();
  backendServer.listen(backendPort, "127.0.0.1");
  await once(backendServer, "listening");
  backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  const appPort = await getFreePort();
  appBaseUrl = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(process.execPath, ["--enable-source-maps", distEntry], {
    cwd: apiServerDir,
    env: {
      ...process.env,
      PORT: String(appPort),
      SERVICE_ACCESS_KEY: SERVICE_KEY,
      FRIEND_PROXY_URL: backendBaseUrl,
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  collectStream(appProcess.stdout);
  collectStream(appProcess.stderr);

  await waitForHealthy(appBaseUrl);
});

after(async () => {
  if (appProcess && !appProcess.killed) {
    appProcess.kill("SIGTERM");
  }
  if (backendServer) {
    await new Promise((resolve, reject) => {
      backendServer.close((err) => err ? reject(err) : resolve(undefined));
    });
  }
});

test("api server smoke suite", async () => {
  const catalogRes = await authedFetch("/api/v1/models");
  assert.equal(catalogRes.status, 200);
  const catalog = await catalogRes.json();
  assert.equal(catalog.object, "list");
  assert.ok(Array.isArray(catalog.data));
  assert.ok(catalog.data.some((model) => model.id === "gpt-5.2"));

  const chatRes = await authedFetch("/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(chatRes.status, 200, await chatRes.text());
  const chat = await chatRes.json();
  assert.equal(chat.choices?.[0]?.message?.content, "OK");

  const imageRes = await authedFetch("/api/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: "draw a square",
      response_format: "b64_json",
    }),
  });
  assert.equal(imageRes.status, 200, await imageRes.text());
  const image = await imageRes.json();
  assert.ok(Array.isArray(image.data));
  assert.equal(image.data[0]?.b64_json, "aGVsbG8=");

  const geminiRes = await authedFetch("/api/v1beta/models/gemini-2.5-pro:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    }),
  });
  assert.equal(geminiRes.status, 200, await geminiRes.text());
  const gemini = await geminiRes.json();
  assert.equal(gemini.candidates?.[0]?.content?.parts?.[0]?.text, "OK");

  const anthropicBadRes = await authedFetch("/api/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(anthropicBadRes.status, 400);
  const anthropicBad = await anthropicBadRes.json();
  assert.match(anthropicBad.error?.message ?? "", /Invalid request body/i);

  const adminModelsRes = await authedFetch("/api/service/models");
  assert.equal(adminModelsRes.status, 200);
  const adminModels = await adminModelsRes.json();
  assert.ok(Array.isArray(adminModels.models));

  const backendsRes = await authedFetch("/api/service/backends");
  assert.equal(backendsRes.status, 200);
  const backends = await backendsRes.json();
  assert.ok(Array.isArray(backends.env));
  assert.ok(backends.env.some((backend) => backend.label === "FRIEND"));

  const metricsRes = await authedFetch("/api/service/metrics");
  assert.equal(metricsRes.status, 200);
  const metrics = await metricsRes.json();
  assert.ok(metrics.stats);
  assert.ok(metrics.stats.FRIEND);
  assert.ok(metrics.stats.FRIEND.calls >= 3);
});
