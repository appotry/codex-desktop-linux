"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxBrowserUseHiddenHostOwnershipPatch,
  applyLinuxBrowserUseWebviewHostRecoveryPatch,
  applyLinuxBrowserUseWebviewRemountStorePatch,
} = require("../../../../impl/webview/index.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-browser-use-webview-attach-recovery-store",
    phase: "webview-asset",
    order: 1094,
    ciPolicy: "optional",
    pattern:
      /^app-initial~artifact-tab-content\.electron~app-main~appgen-settings-page~page~pull-request-r~mxek7o2y-[^.]+\.js$/,
    missingDescription: "Browser sidebar retained-webview store bundle",
    skipDescription: "Linux Browser sidebar attachment recovery store patch",
    apply: applyLinuxBrowserUseWebviewRemountStorePatch,
  }),
  webviewAssetPatch({
    id: "linux-browser-use-webview-attach-recovery-host",
    phase: "webview-asset",
    order: 1095,
    ciPolicy: "optional",
    pattern:
      /^app-initial~app-main~pull-request-route~onboarding-page~hotkey-window-thread-page~quick-cha~mo2avlln-[^.]+\.js$/,
    missingDescription: "Browser sidebar retained-webview host bundle",
    skipDescription: "Linux Browser sidebar attachment recovery host patch",
    apply: applyLinuxBrowserUseWebviewHostRecoveryPatch,
  }),
  webviewAssetPatch({
    id: "linux-browser-use-hidden-host-ownership",
    phase: "webview-asset",
    order: 1096,
    ciPolicy: "optional",
    pattern: /^browser-sidebar-hidden-browser-use-webview-host-[^.]+\.js$/,
    missingDescription: "Browser Use hidden-webview host bundle",
    skipDescription: "Linux inactive-route Browser Use host ownership patch",
    apply: applyLinuxBrowserUseHiddenHostOwnershipPatch,
  }),
];
