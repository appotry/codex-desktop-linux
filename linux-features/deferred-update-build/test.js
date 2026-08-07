"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AUTO_BUILD_UPDATES_SETTING_KEY,
  applyDeferredUpdateBuildSettingsPatch,
  patchDeferredUpdateBuildSettingsAssets,
} = require("./patch.js");
const {
  enabledLinuxFeatureIds,
  loadLinuxFeaturePatchDescriptors,
} = require("../../scripts/lib/linux-features.js");

const featuresRoot = path.resolve(__dirname, "..");
const AUTO_INSTALL_TOGGLE =
  `$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,label:"Install updates when you close ChatGPT",description:"When on, a ready update waits for ChatGPT to close and then installs. When off, updates wait until you click Update."})`;

function settingsSource(children = `children:${AUTO_INSTALL_TOGGLE}`) {
  return `var KEYS={autoUpdateOnExit:"codex-linux-auto-update-on-exit"};function Settings(){return $.jsx(SettingsGroup,{${children}})}`;
}

function withTempFeatureConfig(enabled, fn) {
  const originalConfig = process.env.CODEX_LINUX_FEATURES_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-deferred-build-config-"));
  process.env.CODEX_LINUX_FEATURES_CONFIG = path.join(tempDir, "features.json");
  try {
    fs.writeFileSync(process.env.CODEX_LINUX_FEATURES_CONFIG, JSON.stringify({ enabled }, null, 2));
    return fn();
  } finally {
    if (originalConfig == null) delete process.env.CODEX_LINUX_FEATURES_CONFIG;
    else process.env.CODEX_LINUX_FEATURES_CONFIG = originalConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function withoutWarnings(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}

test("adds the automatic build key and toggle to core Linux settings", () => {
  const patched = applyDeferredUpdateBuildSettingsPatch(settingsSource());
  assert.match(patched, new RegExp(`autoBuildUpdates:"${AUTO_BUILD_UPDATES_SETTING_KEY}"`));
  assert.match(patched, /label:"Build updates automatically"/);
  assert.match(patched, /children:\[\$\.jsx\(LinuxToggle/);
  assert.equal(applyDeferredUpdateBuildSettingsPatch(patched), patched);
});

test("composes with another feature that already made the settings controls an array", () => {
  const existing =
    `${AUTO_INSTALL_TOGGLE},` +
    `$.jsx(LinuxToggle,{settingKey:KEYS.wrapperUpdates,label:"Wrapper updates"},"wrapperUpdates")`;
  const patched = applyDeferredUpdateBuildSettingsPatch(settingsSource(`children:[${existing}]`));
  assert.match(patched, /label:"Build updates automatically"/);
  assert.match(patched, /label:"Wrapper updates"/);
  assert.match(patched, /label:"Install updates when you close ChatGPT"/);
});

test("settings asset patch is fail-soft and leaves drifted content unchanged", () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-deferred-build-drift-"));
  const assetsDir = path.join(appDir, "webview", "assets");
  const settingsPath = path.join(assetsDir, "linux-desktop-settings-linux.js");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(settingsPath, "var KEYS={};function Settings(){return null}");
  try {
    assert.deepEqual(withoutWarnings(() => patchDeferredUpdateBuildSettingsAssets(appDir)), {
      matched: false,
      changed: 0,
      reason: "could not find Linux update settings key",
    });
    assert.equal(fs.readFileSync(settingsPath, "utf8"), "var KEYS={};function Settings(){return null}");
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("feature stays disabled until explicitly enabled", () => {
  withTempFeatureConfig([], () => {
    assert.deepEqual(enabledLinuxFeatureIds({ featuresRoot }), []);
    assert.deepEqual(
      loadLinuxFeaturePatchDescriptors({ featuresRoot }).filter((descriptor) =>
        descriptor.id.startsWith("feature:deferred-update-build:"),
      ),
      [],
    );
  });
});

test("enabled feature exposes one optional settings descriptor", () => {
  withTempFeatureConfig(["deferred-update-build"], () => {
    const descriptors = loadLinuxFeaturePatchDescriptors({ featuresRoot }).filter((descriptor) =>
      descriptor.id.startsWith("feature:deferred-update-build:"),
    );
    assert.deepEqual(
      descriptors.map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
      [["feature:deferred-update-build:settings-toggle", "extracted-app:post-webview", "optional"]],
    );
  });
});

test("feature-owned updater policy declares the feature-owned setting key", () => {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "updater-policy.json"), "utf8"));
  assert.deepEqual(policy, {
    schemaVersion: 1,
    autoBuildUpdatesSettingKey: AUTO_BUILD_UPDATES_SETTING_KEY,
  });
});
