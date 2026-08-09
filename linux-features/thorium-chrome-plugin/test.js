#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  enabledLinuxFeatureIds,
  enabledLinuxFeatureStageHooks,
  loadLinuxFeaturePatchDescriptors,
} = require("../../scripts/lib/linux-features.js");
const { applyThoriumChromeExtensionStatusPatch } = require("./patch.js");

const repoRoot = path.resolve(__dirname, "..", "..");

function withTempFeatureRoot(enabled, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-feature-root-"));
  try {
    fs.writeFileSync(path.join(root, "features.example.json"), JSON.stringify({ enabled: [] }, null, 2));
    fs.writeFileSync(path.join(root, "features.json"), JSON.stringify({ enabled }, null, 2));
    fs.cpSync(__dirname, path.join(root, "thorium-chrome-plugin"), { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFakeChromePlugin(pluginDir) {
  const scriptsDir = path.join(pluginDir, "scripts");
  const skillDir = path.join(pluginDir, "skills", "control-chrome");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "Do not inspect browser cookies, local storage, profiles, passwords, or session stores. Browser discovery must remain read-only.\n",
  );
  fs.writeFileSync(
    path.join(scriptsDir, "extension-ids.json"),
    `${JSON.stringify(
      {
        extensionHostName: "com.openai.codexextension",
        extensionIds: ["hehggadaopoacecdllhhajmbjkdcmajg"],
        browserDiagnostics: [
          {
            browserFamily: "chrome",
            displayName: "Google Chrome",
            shortDisplayName: "Chrome",
            extensionIds: [
              "hehggadaopoacecdllhhajmbjkdcmajg",
              "odlomjlbamekndcpllcnffbgeohgkmjh",
            ],
            extensionManagementUrl: "chrome://extensions",
            storeUrl:
              "https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg",
            linux: {
              commands: ["google-chrome", "google-chrome-stable"],
              configHomeEnvironmentVariables: ["CHROME_CONFIG_HOME", "XDG_CONFIG_HOME"],
              nativeMessagingManifestDirectories: [
                ".config/google-chrome/NativeMessagingHosts",
              ],
              processNames: ["chrome"],
              userDataDirectorySegments: [".config", "google-chrome"],
            },
            macos: {
              applicationNames: ["Google Chrome.app"],
              bundleId: "com.google.Chrome",
              nativeMessagingManifestDirectories: [
                "Library/Application Support/Google/Chrome/NativeMessagingHosts",
              ],
              processNames: ["Google Chrome"],
              userDataDirectorySegments: ["Library", "Application Support", "Google", "Chrome"],
            },
            windows: {
              commandNames: ["chrome.exe"],
              installPathSegments: ["Google", "Chrome", "Application", "chrome.exe"],
              processNames: ["chrome.exe"],
              userDataDirectorySegments: ["Google", "Chrome", "User Data"],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(scriptsDir, "browser-client.mjs"),
    'const browserPreference = {};\nfunction preferredWindowIdFor() {}\nfunction getForUrl() {}\n',
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test("Thorium Chrome plugin feature stays disabled until listed in features.json", () => {
  withTempFeatureRoot([], (root) => {
    assert.deepEqual(enabledLinuxFeatureIds({ featuresRoot: root }), []);
    assert.deepEqual(enabledLinuxFeatureStageHooks({ featuresRoot: root }), []);
    assert.deepEqual(loadLinuxFeaturePatchDescriptors({ featuresRoot: root }), []);
  });
});

test("Thorium Chrome plugin feature exposes its patch and stage hook when enabled", () => {
  withTempFeatureRoot(["thorium-chrome-plugin"], (root) => {
    assert.deepEqual(enabledLinuxFeatureIds({ featuresRoot: root }), ["thorium-chrome-plugin"]);
    assert.equal(enabledLinuxFeatureStageHooks({ featuresRoot: root }).length, 1);
    assert.equal(loadLinuxFeaturePatchDescriptors({ featuresRoot: root }).length, 1);
  });
});

test("Thorium settings patch extends the core Linux Chrome status helper", () => {
  const source =
    "function codexLinuxChromeProfileRoots({homeDir:e,platform:t}){return t===`linux`?[(0,p.join)(e,`.config`,`BraveSoftware`,`Brave-Browser`),(0,p.join)(e,`.config`,`google-chrome`),(0,p.join)(e,`.config`,`google-chrome-beta`),(0,p.join)(e,`.config`,`google-chrome-unstable`),(0,p.join)(e,`.config`,`chromium`)]:[]}function codexLinuxChromeCommand(){for(let t of[`brave-browser`,`brave`,`google-chrome`,`google-chrome-stable`,`google-chrome-beta`,`google-chrome-unstable`,`chromium-browser`,`chromium`]){}}throw Error(`Google Chrome, Brave, or Chromium is not installed`)";
  const patched = applyThoriumChromeExtensionStatusPatch(source);

  assert.match(patched, /`\.config`,`thorium`/);
  assert.match(patched, /`thorium-browser-avx2`/);
  assert.match(patched, /Google Chrome, Brave, Chromium, or Thorium is not installed/);
});

test("Thorium staging targets the current browser registry, not legacy script shapes", () => {
  const source = fs.readFileSync(path.join(__dirname, "patch-chrome-plugin.js"), "utf8");

  assert.match(source, /browserDiagnostics/);
  assert.match(source, /extension-ids\.json/);
  assert.doesNotMatch(source, /KNOWN_BROWSERS/);
  assert.doesNotMatch(source, /CHROME_PROCESS_NAMES_BY_PLATFORM/);
  assert.doesNotMatch(source, /linuxThoriumUserDataDirectory/);
});

test("Thorium stage hook upgrades a core Linux-patched Chrome plugin", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-stage-"));
  try {
    const installDir = path.join(workspace, "install");
    const workDir = path.join(workspace, "work");
    const chromePlugin = path.join(installDir, "resources", "plugins", "openai-bundled", "plugins", "chrome");
    const featuresConfig = path.join(workspace, "features.json");

    fs.mkdirSync(workDir, { recursive: true });
    writeFakeChromePlugin(chromePlugin);
    fs.writeFileSync(featuresConfig, JSON.stringify({ enabled: ["thorium-chrome-plugin"] }, null, 2));

    run("node", [path.join(repoRoot, "scripts", "lib", "patch-chrome-plugin.js"), chromePlugin]);
    const stageResult = run("bash", [
      "-lc",
      [
        "source \"$LINUX_FEATURES_RUNNER\"",
        "info(){ echo \"$*\" >&2; }",
        "warn(){ echo \"$*\" >&2; }",
        "SCRIPT_DIR=\"$REPO_ROOT\"",
        "INSTALL_DIR=\"$INSTALL_DIR\"",
        "WORK_DIR=\"$WORK_DIR\"",
        "ARCH=x86_64",
        "run_linux_feature_stage_hooks",
      ].join("\n"),
    ], {
      env: {
        ...process.env,
        CODEX_LINUX_FEATURES_CONFIG: featuresConfig,
        LINUX_FEATURES_RUNNER: path.join(repoRoot, "scripts", "lib", "linux-features.sh"),
        REPO_ROOT: repoRoot,
        INSTALL_DIR: installDir,
        WORK_DIR: workDir,
      },
    });
    assert.doesNotMatch(stageResult.stderr, /missing patch target/);

    const scriptsDir = path.join(chromePlugin, "scripts");
    const registry = JSON.parse(
      fs.readFileSync(path.join(scriptsDir, "extension-ids.json"), "utf8"),
    );
    const thorium = registry.browserDiagnostics.find(
      (browser) => browser.browserFamily === "thorium",
    );
    assert.ok(thorium, "expected a thorium entry in browserDiagnostics");
    assert.deepEqual(thorium.linux.commands, [
      "thorium-browser-avx2",
      "thorium-browser",
      "thorium",
    ]);
    assert.deepEqual(thorium.linux.processNames, [
      "thorium",
      "thorium-browser",
      "thorium-browser-avx2",
    ]);
    assert.deepEqual(thorium.linux.nativeMessagingManifestDirectories, [
      ".config/thorium/NativeMessagingHosts",
    ]);
    assert.deepEqual(thorium.linux.userDataDirectorySegments, [".config", "thorium"]);
    assert.deepEqual(
      thorium.extensionIds,
      registry.browserDiagnostics.find((browser) => browser.browserFamily === "chrome")
        .extensionIds,
    );
    assert.equal(
      fs.readFileSync(path.join(installDir, ".codex-linux", "chrome-native-host-manifest-paths"), "utf8").trim(),
      ".config/thorium/NativeMessagingHosts",
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("Thorium patcher leaves browser-client routing untouched", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-thorium-current-plugin-"));
  try {
    const chromePlugin = path.join(workspace, "chrome");
    const scriptsDir = path.join(chromePlugin, "scripts");
    writeFakeChromePlugin(chromePlugin);
    run("node", [path.join(repoRoot, "scripts", "lib", "patch-chrome-plugin.js"), chromePlugin]);
    fs.writeFileSync(
      path.join(scriptsDir, "browser-client.mjs"),
      'function qE(){return{extensionInstanceId:"instance",preferredWindowId:7}}var fp=class{constructor(e=null){this.browserPreference=e}browserPreference;async getForUrl(e){return e}preferredWindowIdFor(e){return this.browserPreference?.preferredWindowId}async get(e){return e}};\n',
    );
    const before = fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8");

    const result = run("node", [path.join(repoRoot, "linux-features", "thorium-chrome-plugin", "patch-chrome-plugin.js"), chromePlugin]);

    const patched = fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8");
    assert.equal(patched, before);
    assert.doesNotMatch(result.stderr, /missing patch target/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
