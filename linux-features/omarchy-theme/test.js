#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  enabledLinuxFeatureIds,
  enabledLinuxFeatureInstallPlan,
  loadLinuxFeaturePatchDescriptors,
} = require("../../scripts/lib/linux-features.js");
const {
  RUNTIME_VERSION,
  STYLE_LINK_ID,
  THEME_CSS_ENDPOINT,
  applyOmarchyThemeLoader,
  omarchyThemeRuntimeSource,
} = require("./patch.js");

const FEATURE_DIR = __dirname;
const REPO_ROOT = path.resolve(FEATURE_DIR, "..", "..");

function commandPath(name) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      return candidate;
    } catch {}
  }
  throw new Error(`could not resolve executable from PATH: ${name}`);
}

const BASH = commandPath("bash");

function withFeatureConfig(enabled, fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-omarchy-theme-config-"));
  const originalConfig = process.env.CODEX_LINUX_FEATURES_CONFIG;
  const configPath = path.join(tempDir, "features.json");
  fs.writeFileSync(configPath, `${JSON.stringify({ enabled }, null, 2)}\n`);
  process.env.CODEX_LINUX_FEATURES_CONFIG = configPath;
  try {
    return fn(path.resolve(FEATURE_DIR, ".."));
  } finally {
    if (originalConfig == null) {
      delete process.env.CODEX_LINUX_FEATURES_CONFIG;
    } else {
      process.env.CODEX_LINUX_FEATURES_CONFIG = originalConfig;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: requestPath, timeout: 1000 },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("request timed out")));
  });
}

async function waitForServer(proc, port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      throw new Error(`webview server exited early with ${proc.exitCode}`);
    }
    try {
      await request(port, "/index.html");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("webview server did not start");
}

async function withWebviewServer(serverPath, cwd, env, fn) {
  const port = await getFreePort();
  const proc = spawn("python3", [serverPath, String(port), "--bind", "127.0.0.1"], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForServer(proc, port);
    return await fn(port);
  } finally {
    proc.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => proc.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (proc.exitCode == null) {
      proc.kill("SIGKILL");
    }
    assert.doesNotMatch(stderr, /Traceback|Exception/);
  }
}

test("omarchy-theme stays disabled until selected", () => {
  withFeatureConfig([], (featuresRoot) => {
    assert.deepEqual(enabledLinuxFeatureIds({ featuresRoot }), []);
    assert.deepEqual(loadLinuxFeaturePatchDescriptors({ featuresRoot }), []);
  });
});

test("omarchy-theme exposes optional patches, resources, and hooks when enabled", () => {
  withFeatureConfig(["omarchy-theme"], (featuresRoot) => {
    assert.deepEqual(enabledLinuxFeatureIds({ featuresRoot }), ["omarchy-theme"]);

    const descriptors = loadLinuxFeaturePatchDescriptors({ featuresRoot });
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0].id, "feature:omarchy-theme:omarchy-theme-css-loader");
    assert.equal(descriptors[0].ciPolicy, "optional");
    assert.match("index-main.js", descriptors[0].pattern);

    const plan = enabledLinuxFeatureInstallPlan({ featuresRoot });
    assert.deepEqual(
      plan.resources.map((resource) => [resource.id, resource.target, resource.mode]),
      [[
        "omarchy-theme",
        ".codex-linux/features/omarchy-theme/codex-desktop.css.tpl",
        0o644,
      ]],
    );
    assert.deepEqual(
      plan.runtimeHooks.map((hook) => [hook.id, hook.key, hook.target, hook.mode]),
      [
        [
          "omarchy-theme",
          "env",
          ".codex-linux/env.d/omarchy-theme-user-stylesheet.env",
          0o644,
        ],
        [
          "omarchy-theme",
          "prelaunch",
          ".codex-linux/prelaunch.d/omarchy-theme-install-template.sh",
          0o755,
        ],
      ],
    );
  });
});

test("renderer patch is idempotent and installs one guarded runtime", () => {
  const source = "console.log('codex');";
  const patched = applyOmarchyThemeLoader(source);
  assert.notEqual(patched, source);
  assert.equal(applyOmarchyThemeLoader(patched), patched);
  assert.match(patched, new RegExp(RUNTIME_VERSION));
  assert.match(patched, new RegExp(STYLE_LINK_ID));
  assert.match(patched, new RegExp(THEME_CSS_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const links = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let intervalCount = 0;
  let clearIntervalCount = 0;
  let appendCount = 0;
  const sandbox = {
    Date: { now: () => 1234 },
    document: {
      readyState: "complete",
      hidden: false,
      head: {
        appendChild(link) {
          appendCount += 1;
          links.set(link.id, link);
        },
      },
      documentElement: null,
      getElementById(id) {
        return links.get(id) ?? null;
      },
      createElement(tag) {
        return { tag };
      },
      addEventListener(name, listener) {
        documentListeners.set(name, listener);
      },
      removeEventListener(name, listener) {
        if (documentListeners.get(name) === listener) documentListeners.delete(name);
      },
    },
    window: {
      addEventListener(name, listener) {
        windowListeners.set(name, listener);
      },
      removeEventListener(name, listener) {
        if (windowListeners.get(name) === listener) windowListeners.delete(name);
      },
    },
    setInterval() {
      intervalCount += 1;
      return 7;
    },
    clearInterval() {
      clearIntervalCount += 1;
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(omarchyThemeRuntimeSource(), sandbox);
  vm.runInContext(omarchyThemeRuntimeSource(), sandbox);

  assert.equal(appendCount, 1);
  assert.equal(intervalCount, 1);
  assert.equal(windowListeners.size, 1);
  assert.equal(documentListeners.size, 1);
  assert.equal(links.get(STYLE_LINK_ID).href, `${THEME_CSS_ENDPOINT}?t=1234`);

  sandbox.codexLinuxOmarchyThemeCleanup();
  assert.equal(clearIntervalCount, 1);
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
});

test("webview server safely serves default and overridden user stylesheets", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-omarchy-theme-server-"));
  try {
    const serverPath = path.join(REPO_ROOT, "launcher", "webview-server.py");
    const webviewDir = path.join(tempDir, "webview");
    const generatedCss = path.join(tempDir, "generated.css");
    const configuredDefaultLine = fs
      .readFileSync(path.join(FEATURE_DIR, "user-stylesheet.env"), "utf8")
      .split("\n")
      .find((line) => line.startsWith("CODEX_LINUX_WEBVIEW_USER_STYLESHEET_DEFAULT="));
    assert.ok(configuredDefaultLine);
    const configuredDefault = configuredDefaultLine.slice(configuredDefaultLine.indexOf("=") + 1);
    fs.mkdirSync(webviewDir, { recursive: true });
    fs.writeFileSync(path.join(webviewDir, "index.html"), "<!doctype html>");

    fs.writeFileSync(generatedCss, ":root{--accent:#fabd2f}");
    await withWebviewServer(
      serverPath,
      webviewDir,
      { CODEX_LINUX_WEBVIEW_USER_STYLESHEET_DEFAULT: generatedCss },
      async (port) => {
        const existing = await request(port, `${THEME_CSS_ENDPOINT}?t=123`);
        assert.equal(existing.status, 200);
        assert.equal(existing.headers["content-type"], "text/css; charset=utf-8");
        assert.equal(existing.body.toString(), ":root{--accent:#fabd2f}");

        fs.rmSync(generatedCss);
        const missing = await request(port, THEME_CSS_ENDPOINT);
        assert.equal(missing.status, 200);
        assert.equal(missing.body.length, 0);

        fs.writeFileSync(generatedCss, Buffer.alloc(262145, 97));
        const oversized = await request(port, THEME_CSS_ENDPOINT);
        assert.equal(oversized.status, 200);
        assert.equal(oversized.body.length, 0);
      },
    );

    const defaultHome = path.join(tempDir, "default-home");
    const defaultGeneratedCss = path.join(
      defaultHome,
      ".config",
      "omarchy",
      "current",
      "theme",
      "codex-desktop.css",
    );
    fs.mkdirSync(path.dirname(defaultGeneratedCss), { recursive: true });
    fs.writeFileSync(defaultGeneratedCss, "body{color:default-config}");
    await withWebviewServer(
      serverPath,
      webviewDir,
      {
        HOME: defaultHome,
        CODEX_LINUX_WEBVIEW_USER_STYLESHEET_DEFAULT: configuredDefault,
      },
      async (port) => {
        const defaultConfigured = await request(port, THEME_CSS_ENDPOINT);
        assert.equal(defaultConfigured.status, 200);
        assert.equal(defaultConfigured.body.toString(), "body{color:default-config}");
      },
    );

    const overrideCss = path.join(tempDir, "override.css");
    fs.writeFileSync(overrideCss, "body{color:papayawhip}");
    await withWebviewServer(
      serverPath,
      webviewDir,
      {
        CODEX_LINUX_WEBVIEW_USER_STYLESHEET_DEFAULT: generatedCss,
        CODEX_LINUX_WEBVIEW_USER_STYLESHEET: overrideCss,
      },
      async (port) => {
        const overridden = await request(port, THEME_CSS_ENDPOINT);
        assert.equal(overridden.status, 200);
        assert.equal(overridden.body.toString(), "body{color:papayawhip}");
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prelaunch hook installs the template, refreshes missing CSS, and preserves local edits", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-omarchy-template-install-"));
  try {
    const home = path.join(tempDir, "home");
    const featuresDir = path.join(tempDir, "features");
    const stagedDir = path.join(featuresDir, "omarchy-theme");
    const omarchyHome = path.join(home, ".config", "omarchy");
    const target = path.join(omarchyHome, "themed", "codex-desktop.css.tpl");
    const generated = path.join(omarchyHome, "current", "theme", "codex-desktop.css");
    const binDir = path.join(tempDir, "bin");
    const callLog = path.join(tempDir, "omarchy.log");
    fs.mkdirSync(stagedDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(path.join(FEATURE_DIR, "codex-desktop.css.tpl"), path.join(stagedDir, "codex-desktop.css.tpl"));
    const fakeOmarchy = path.join(binDir, "omarchy");
    fs.writeFileSync(
      fakeOmarchy,
      `#!${BASH}\nset -e\nprintf '%s\\n' "$*" >> "$OMARCHY_TEST_LOG"\nmkdir -p "$HOME/.config/omarchy/current/theme"\nprintf 'generated' > "$HOME/.config/omarchy/current/theme/codex-desktop.css"\n`,
    );
    fs.chmodSync(fakeOmarchy, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      CODEX_LINUX_FEATURES_DIR: featuresDir,
      OMARCHY_TEST_LOG: callLog,
    };
    const first = spawnSync(BASH, [path.join(FEATURE_DIR, "install-template.sh")], {
      env,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(path.join(FEATURE_DIR, "codex-desktop.css.tpl"), "utf8"));
    assert.equal(fs.readFileSync(generated, "utf8"), "generated");
    assert.equal(fs.readFileSync(callLog, "utf8"), "theme refresh\n");

    fs.writeFileSync(target, "/* local customization */\n");
    fs.rmSync(generated);
    const second = spawnSync(BASH, [path.join(FEATURE_DIR, "install-template.sh")], {
      env,
      encoding: "utf8",
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(target, "utf8"), "/* local customization */\n");
    assert.equal(fs.readFileSync(generated, "utf8"), "generated");
    assert.equal(fs.readFileSync(callLog, "utf8"), "theme refresh\ntheme refresh\n");
    assert.match(second.stderr, /leaving it untouched/);

    fs.rmSync(generated);
    fs.writeFileSync(
      fakeOmarchy,
      `#!${BASH}\nsleep 30\n`,
    );
    const startedAt = Date.now();
    const hanging = spawnSync(BASH, [path.join(FEATURE_DIR, "install-template.sh")], {
      env: {
        ...env,
        CODEX_OMARCHY_THEME_REFRESH_TIMEOUT_SECONDS: "1",
      },
      encoding: "utf8",
    });
    assert.equal(hanging.status, 0, hanging.stderr);
    assert.ok(Date.now() - startedAt < 5000, "prelaunch hook must not wait for a hung refresh");
    assert.match(hanging.stderr, /timed out or failed/);
    assert.equal(fs.existsSync(generated), false);

    const timeoutLog = path.join(tempDir, "timeout.log");
    fs.writeFileSync(
      path.join(binDir, "timeout"),
      `#!${BASH}\nprintf '%s\\n' "$*" > "$OMARCHY_TEST_TIMEOUT_LOG"\nexit 124\n`,
    );
    fs.chmodSync(path.join(binDir, "timeout"), 0o755);
    const oversizedTimeout = spawnSync(BASH, [path.join(FEATURE_DIR, "install-template.sh")], {
      env: {
        ...env,
        CODEX_OMARCHY_THEME_REFRESH_TIMEOUT_SECONDS: "999999999999999999999",
        OMARCHY_TEST_TIMEOUT_LOG: timeoutLog,
      },
      encoding: "utf8",
    });
    assert.equal(oversizedTimeout.status, 0, oversizedTimeout.stderr);
    assert.match(oversizedTimeout.stderr, /whole number between 1 and 60 seconds/);
    assert.equal(fs.readFileSync(timeoutLog, "utf8"), "--kill-after=2s 15s omarchy theme refresh\n");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
