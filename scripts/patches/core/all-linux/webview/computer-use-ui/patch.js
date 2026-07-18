"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxComputerUseHostPlatformPatch,
  applyLinuxComputerUseRendererAvailabilityPatch,
  applyLinuxComputerUseInstallFlowPatch,
} = require("../../../../impl/computer-use.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-computer-use-ui-availability",
    phase: "webview-asset",
    order: 1100,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^computer-use-settings-[^.]+\.js$/,
    missingDescription: "Computer Use availability bundle",
    skipDescription: "Linux Computer Use UI availability patch",
    apply: applyLinuxComputerUseRendererAvailabilityPatch,
  }),
  webviewAssetPatch({
    id: "linux-computer-use-host-platform",
    phase: "webview-asset",
    order: 1105,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^app-initial~artifact-tab-content\.electron~notebook-preview-panel~app-main~settings-command-~ekwfx4j1-[^.]+\.js$/,
    missingDescription: "current Computer Use host-platform bundle",
    skipDescription: "Linux Computer Use host-platform patch",
    apply: applyLinuxComputerUseHostPlatformPatch,
  }),
  webviewAssetPatch({
    id: "linux-computer-use-install-flow",
    phase: "webview-asset",
    order: 1110,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^app-initial~avatarOverlayCompositionSurface~artifact-tab-content\.electron~notebook-preview-~iaq4jiqv-[^.]+\.js$/,
    missingDescription: "current Computer Use install flow bundle",
    skipDescription: "Linux Computer Use install flow patch",
    apply: applyLinuxComputerUseInstallFlowPatch,
  }),
];
