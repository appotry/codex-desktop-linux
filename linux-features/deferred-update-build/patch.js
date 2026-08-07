"use strict";

const fs = require("node:fs");
const path = require("node:path");

const AUTO_BUILD_UPDATES_SETTING_KEY = "codex-linux-auto-build-updates";
const LINUX_DESKTOP_SETTINGS_ASSET = "linux-desktop-settings-linux.js";

const AUTO_INSTALL_TOGGLE =
  `$.jsx(LinuxToggle,{settingKey:KEYS.autoUpdateOnExit,` +
  `label:"Install updates when you close ChatGPT",` +
  `description:"When on, a ready update waits for ChatGPT to close and then installs. ` +
  `When off, updates wait until you click Update."})`;

const AUTO_BUILD_TOGGLE =
  `$.jsx(LinuxToggle,{settingKey:KEYS.autoBuildUpdates,` +
  `label:"Build updates automatically",` +
  `description:"When on, background checks build detected updates. When off, they only notify you; ` +
  `Check for updates starts the build."},"autoBuildUpdates")`;

function applyDeferredUpdateBuildSettingsPatch(source) {
  if (source.includes(`autoBuildUpdates:${JSON.stringify(AUTO_BUILD_UPDATES_SETTING_KEY)}`)) {
    return source;
  }

  const keyNeedle = `autoUpdateOnExit:"codex-linux-auto-update-on-exit"`;
  if (!source.includes(keyNeedle)) {
    throw new Error("could not find Linux update settings key");
  }
  if (!source.includes(AUTO_INSTALL_TOGGLE)) {
    throw new Error("could not find Linux update settings control");
  }

  let next = source.replace(
    keyNeedle,
    `autoBuildUpdates:${JSON.stringify(AUTO_BUILD_UPDATES_SETTING_KEY)},${keyNeedle}`,
  );
  const singleControl = `children:${AUTO_INSTALL_TOGGLE}`;
  next = next.includes(singleControl)
    ? next.replace(singleControl, `children:[${AUTO_BUILD_TOGGLE},${AUTO_INSTALL_TOGGLE}]`)
    : next.replace(AUTO_INSTALL_TOGGLE, `${AUTO_BUILD_TOGGLE},${AUTO_INSTALL_TOGGLE}`);
  return next;
}

function patchDeferredUpdateBuildSettingsAssets(extractedDir) {
  try {
    const assetsDir = path.join(extractedDir, "webview", "assets");
    if (!fs.existsSync(assetsDir)) {
      return { matched: false, changed: 0, reason: `missing webview assets directory ${assetsDir}` };
    }

    const settingsPath = path.join(assetsDir, LINUX_DESKTOP_SETTINGS_ASSET);
    if (!fs.existsSync(settingsPath)) {
      return { matched: false, changed: 0, reason: `${LINUX_DESKTOP_SETTINGS_ASSET} is not present` };
    }

    const current = fs.readFileSync(settingsPath, "utf8");
    const patched = applyDeferredUpdateBuildSettingsPatch(current);
    if (patched === current) {
      return { matched: true, changed: 0 };
    }
    fs.writeFileSync(settingsPath, patched, "utf8");
    return { matched: true, changed: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`WARN: Deferred update build settings patch skipped: ${message}`);
    return { matched: false, changed: 0, reason: message };
  }
}

module.exports = {
  AUTO_BUILD_UPDATES_SETTING_KEY,
  applyDeferredUpdateBuildSettingsPatch,
  patchDeferredUpdateBuildSettingsAssets,
  descriptors: [
    {
      id: "settings-toggle",
      phase: "extracted-app:post-webview",
      order: 20_910,
      ciPolicy: "optional",
      apply: (extractedDir) => patchDeferredUpdateBuildSettingsAssets(extractedDir),
      status: (result, warnings) => {
        if (result?.matched === false) {
          return { status: "skipped-optional", reason: result.reason ?? warnings[0] ?? null };
        }
        return (result?.changed ?? 0) > 0 ? "applied" : "already-applied";
      },
    },
  ],
};
