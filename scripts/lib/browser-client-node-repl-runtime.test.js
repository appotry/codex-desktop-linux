#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const runtimePath = process.env.CODEX_NODE_REPL_PATH;
const pluginsRoot = process.env.CODEX_STAGED_BUNDLED_PLUGINS_ROOT;

function runNodeReplImport(runtime, clients) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [], {
      env: {
        ...process.env,
        CODEX_BROWSER_USE_SOCKET_DIR: "/tmp/codex-browser-use-runtime-test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = readline.createInterface({ input: child.stdout });
    let stderr = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.close();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const code = `${clients
      .map((client) => `await import(${JSON.stringify(pathToFileURL(client).href)});`)
      .join("")}nodeRepl.write("imports-ok")`;
    const timer = setTimeout(
      () => finish(new Error(`node_repl import timed out: ${stderr}`)),
      20_000,
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (codeValue, signal) => {
      if (!settled) {
        finish(
          new Error(
            `node_repl exited before the import response (code=${codeValue}, signal=${signal}): ${stderr}`,
          ),
        );
      }
    });
    stdout.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "js",
            arguments: {
              code,
              timeout_ms: 10_000,
              title: "Import staged Browser clients",
            },
          },
        });
      }

      if (message.id === 2) {
        const text = message.result?.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("");
        if (message.result?.isError) {
          finish(new Error(`node_repl import failed: ${text || stderr}`));
        } else {
          finish(null, text);
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-browser-client-runtime-test", version: "1" },
      },
    });
  });
}

test("guards every Browser client nodeRepl env read", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-client-env-guard-"));
  const clientPath = path.join(fixtureRoot, "browser-client.mjs");
  const patcher = path.join(__dirname, "bundled-plugins.sh");
  const client = [
    'var Es="BROWSER_USE_SECURITY_MODE",Bl="BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED",Ai;',
    'function ye(){return globalThis.nodeRepl}',
    'function sT(e){if(Ai!=null)return()=>{};let t=Object.freeze({nodeRepl:e,createElicitation:e.createElicitation,env:e.env,securityMode:e.env[Es],enabled:e.env[Bl]==="1"});return Ai=t,()=>{Ai===t&&(Ai=void 0)}}',
    'function Bm(){let e=Ai;if(e==null)return!0;let t=ye();return t===e.nodeRepl&&t.env===e.env&&t.createElicitation===e.createElicitation&&t.env[Es]===e.securityMode&&t.env[Bl]==="1"===e.enabled}',
    'function Ou(e){let t=globalThis.nodeRepl?.env[e];return typeof t=="string"?t:void 0}',
  ].join("");

  try {
    fs.writeFileSync(clientPath, client, "utf8");
    const applyGuard = () =>
      spawnSync(
        "bash",
        [
          "-c",
          'source "$1"; patch_browser_use_node_repl_env_guard "$2"',
          "browser-client-env-guard",
          patcher,
          clientPath,
        ],
        { encoding: "utf8" },
      );

    const first = applyGuard();
    assert.equal(first.status, 0, first.stderr);
    const patched = fs.readFileSync(clientPath, "utf8");
    assert.match(patched, /codexLinuxBrowserUseNodeReplEnvGuard/);
    assert.match(patched, /globalThis\.nodeRepl\?\.env\?\.\[e\]/);
    assert.doesNotMatch(patched, /\b[A-Za-z_$][\w$]*\.env\[[^\]]+\]/);
    assert.equal((patched.match(/\.env\?\.\[/g) ?? []).length, 5);

    const second = applyGuard();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(clientPath, "utf8"), patched);

    const previousNodeRepl = globalThis.nodeRepl;
    try {
      globalThis.nodeRepl = {};
      const initializeSecurityState = new Function(
        `${patched};return {dispose:sT(globalThis.nodeRepl),valid:Bm()}`,
      );
      const securityState = initializeSecurityState();
      assert.equal(securityState.valid, true);
      assert.equal(typeof securityState.dispose, "function");
      securityState.dispose();
    } finally {
      globalThis.nodeRepl = previousNodeRepl;
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test(
  "staged Browser and Chrome clients import through the real node_repl runtime",
  { skip: !runtimePath || !pluginsRoot },
  async () => {
    const clients = ["browser", "chrome"].map((plugin) =>
      path.join(pluginsRoot, plugin, "scripts", "browser-client.mjs"),
    );
    assert.ok(fs.existsSync(runtimePath), `node_repl runtime not found: ${runtimePath}`);
    for (const client of clients) {
      assert.ok(fs.existsSync(client), `staged Browser client not found: ${client}`);
    }

    assert.equal(await runNodeReplImport(runtimePath, clients), "imports-ok");
  },
);
