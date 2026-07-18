#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const {
  applyLinuxBrowserUseSocketDirectoryPatch,
} = require("../patches/impl/main-process/browser.js");

const patcher = path.join(__dirname, "patch-browser-client-iab-socket-scope.js");

test("main-process producer and staged Browser client resolve the same Linux socket directory", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-socket-alignment-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
  const clientFixture =
    'var kE=t=>t==="win32"?"\\\\\\\\.\\\\pipe\\\\codex-browser-use":"/tmp/codex-browser-use";globalThis.clientSocketDirectory=kE("linux");';
  const producerFixture =
    '"use strict";' +
    'var zt=e=>e===`win32`?`\\\\\\\\.\\\\pipe\\\\codex-browser-use`:`/tmp/codex-browser-use`;' +
    'var Sd=class{server;pipePath;async start(){await new Promise((e,t)=>{this.server.once(`error`,t),this.server.listen(this.pipePath,()=>{this.server.off(`error`,t),e()})})}};' +
    'globalThis.producerSocketDirectory=zt(`linux`);';

  try {
    fs.writeFileSync(clientPath, clientFixture, "utf8");
    const clientPatch = spawnSync(
      process.execPath,
      [patcher, clientPath, "--socket-dir-only"],
      { encoding: "utf8" },
    );
    assert.equal(clientPatch.status, 0, clientPatch.stderr);

    globalThis.nodeRepl = { env: {} };
    await import(`${pathToFileURL(clientPath).href}?alignment=1`);

    const uid = os.userInfo().uid;
    const producerContext = {
      globalThis: {},
      process: { env: {}, getuid: () => uid, platform: "linux" },
      require: () => ({
        mkdirSync() {},
        lstatSync: () => ({
          isDirectory: () => true,
          isSymbolicLink: () => false,
          uid,
        }),
        chmodSync() {},
      }),
    };
    vm.runInNewContext(
      applyLinuxBrowserUseSocketDirectoryPatch(producerFixture),
      producerContext,
    );

    assert.equal(
      producerContext.globalThis.producerSocketDirectory,
      globalThis.clientSocketDirectory,
    );
  } finally {
    delete globalThis.nodeRepl;
    delete globalThis.clientSocketDirectory;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Linux socket discovery uses the bridge override then a deterministic UID path", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-user-socket-dir-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
  const fixture =
    'var kE=t=>t==="win32"?"\\\\\\\\.\\\\pipe\\\\codex-browser-use":"/tmp/codex-browser-use";globalThis.result=kE("linux");';

  try {
    fs.writeFileSync(clientPath, fixture, "utf8");
    const firstPatch = spawnSync(process.execPath, [patcher, clientPath, "--socket-dir-only"], {
      encoding: "utf8",
    });
    assert.equal(firstPatch.status, 0, firstPatch.stderr);
    const patched = fs.readFileSync(clientPath, "utf8");
    assert.match(patched, /codexLinuxPerUserBrowserSocketDir/);
    assert.doesNotMatch(patched, /\bprocess\./);

    let importIndex = 0;
    const resolve = async (env) => {
      globalThis.nodeRepl = { env };
      delete globalThis.result;
      await import(`${pathToFileURL(clientPath).href}?socket-case=${importIndex++}`);
      return globalThis.result;
    };
    assert.equal(
      await resolve({ CODEX_BROWSER_USE_SOCKET_DIR: "/custom/browser-sockets" }),
      "/custom/browser-sockets",
    );
    const expectedDefault = `/tmp/codex-browser-use-${os.userInfo().uid}`;
    assert.equal(
      await resolve({ XDG_RUNTIME_DIR: "/run/user/1000/" }),
      expectedDefault,
    );
    assert.equal(
      await resolve({ XDG_RUNTIME_DIR: `/run/user/1000/${"x".repeat(200)}` }),
      expectedDefault,
    );
    assert.equal(await resolve({}), expectedDefault);

    const secondPatch = spawnSync(process.execPath, [patcher, clientPath, "--socket-dir-only"], {
      encoding: "utf8",
    });
    assert.equal(secondPatch.status, 0, secondPatch.stderr);
    assert.equal(fs.readFileSync(clientPath, "utf8"), patched);
  } finally {
    delete globalThis.nodeRepl;
    delete globalThis.result;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("keeps the per-user socket patch when IAB discovery cannot be identified", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-user-socket-only-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
  const fixture =
    'var kE=t=>t==="win32"?"\\\\\\\\.\\\\pipe\\\\codex-browser-use":"/tmp/codex-browser-use";';

  try {
    fs.writeFileSync(clientPath, fixture, "utf8");
    const result = spawnSync(process.execPath, [patcher, clientPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(clientPath, "utf8"), /codexLinuxPerUserBrowserSocketDir/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("IAB discovery excludes extension sockets before connecting", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-iab-socket-scope-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
const fixture = `
const Cb="/tmp/codex-browser-use";
const entries=["extension-123.sock","iab-session.sock","extension-stale.sock"];
const yP=async()=>entries;
const wP={resolve:(root,entry)=>root+"/"+entry};
const _P=()=>"linux";
export const EV=()=>_P()==="win32"?TV():CV(),CV=async()=>(await yP(Cb)).map(e=>wP.resolve(Cb,e)),TV=async()=>[];
`;

  try {
    fs.writeFileSync(clientPath, fixture, "utf8");
    const firstPatch = spawnSync(process.execPath, [patcher, clientPath], { encoding: "utf8" });
    assert.equal(firstPatch.status, 0, firstPatch.stderr);
    const patched = fs.readFileSync(clientPath, "utf8");
    assert.match(patched, /codexLinuxIabSocketScope/);

    const secondPatch = spawnSync(process.execPath, [patcher, clientPath], { encoding: "utf8" });
    assert.equal(secondPatch.status, 0, secondPatch.stderr);
    assert.equal(fs.readFileSync(clientPath, "utf8"), patched);

    const module = await import(`${pathToFileURL(clientPath).href}?patched=1`);
    assert.deepEqual(await module.CV(), ["/tmp/codex-browser-use/iab-session.sock"]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("leaves an unrelated socket-directory map unchanged", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-iab-unrelated-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
  const fixture =
    'const Cb="/tmp/codex-browser-use";const CV=async()=>(await yP(Cb)).map(e=>wP.resolve(Cb,e));';

  try {
    fs.writeFileSync(clientPath, fixture, "utf8");
    const result = spawnSync(process.execPath, [patcher, clientPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const actual = fs.readFileSync(clientPath, "utf8");
    assert.equal(actual, fixture);
    assert.doesNotMatch(actual, /codexLinuxIabSocketScope/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("leaves ambiguous IAB discovery chains unchanged", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-iab-ambiguous-"));
  const clientPath = path.join(workspace, "browser-client.mjs");
  const chain = (suffix) =>
    `EV${suffix}=()=>P${suffix}()==="win32"?TV${suffix}():CV${suffix}(),` +
    `CV${suffix}=async()=>(await Y${suffix}(C${suffix})).map(e=>W${suffix}.resolve(C${suffix},e)),` +
    `TV${suffix}=async()=>[]`;
  const fixture = `const root="/tmp/codex-browser-use";${chain("A")};${chain("B")};`;

  try {
    fs.writeFileSync(clientPath, fixture, "utf8");
    const result = spawnSync(process.execPath, [patcher, clientPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(clientPath, "utf8"), fixture);
    assert.match(result.stderr, /found 2/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
