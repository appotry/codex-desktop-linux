#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
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
