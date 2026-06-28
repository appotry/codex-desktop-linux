"use strict";

const {
  applyLinuxComputerUseRendererAvailabilityPatch,
  applyLinuxComputerUseInstallFlowPatch,
} = require("../../../../computer-use.js");

module.exports = [
  {
    id: "linux-computer-use-ui-availability",
    phase: "webview-asset",
    order: 1100,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^(use-model-settings|apps|use-in-app-browser-use-availability|use-is-plugins-enabled|use-native-apps\.electron|app-initial~app-main~remote-conversation-page~pull-requests-page~onboarding-page~hotkey-win~).*\.js$/,
    missingDescription: "Computer Use availability bundle",
    skipDescription: "Linux Computer Use UI availability patch",
    apply: applyLinuxComputerUseRendererAvailabilityPatch,
  },
  {
    id: "linux-computer-use-install-flow",
    phase: "webview-asset",
    order: 1110,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~plug~.*\.js$/,
    missingDescription: "Computer Use install flow bundle",
    skipDescription: "Linux Computer Use install flow patch",
    apply: applyLinuxComputerUseInstallFlowPatch,
  },
];
