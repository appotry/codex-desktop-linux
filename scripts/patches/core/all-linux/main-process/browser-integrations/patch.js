"use strict";

const { patchStatusFromChange } = require("../../../../../lib/patch-report.js");
const {
  applyBrowserUseNodeReplApprovalAssets,
  applyLinuxBrowserUseRouteLivenessPatch,
  applyLinuxChromeExtensionStatusPatch,
} = require("../../../../main-process.js");
const { applyLinuxChromePluginAutoInstallPatch } = require("../../../../chrome-plugin.js");

module.exports = [
  {
    id: "linux-chrome-plugin-auto-install",
    phase: "main-bundle",
    order: 150,
    ciPolicy: "optional",
    apply: applyLinuxChromePluginAutoInstallPatch,
  },
  {
    id: "browser-use-node-repl-approval",
    phase: "extracted-app",
    order: 160,
    ciPolicy: "optional",
    apply: applyBrowserUseNodeReplApprovalAssets,
    status: (result, warnings) => ({
      status:
        result?.matched === 0
          ? "skipped-optional"
          : patchStatusFromChange(Boolean(result?.changed), warnings, "optional"),
      reason:
        result?.matched === 0
          ? "Browser Use node_repl mcp config bundle not found"
          : warnings[0] ?? null,
    }),
  },
  {
    id: "linux-browser-use-route-liveness",
    phase: "main-bundle",
    order: 170,
    ciPolicy: "optional",
    apply: applyLinuxBrowserUseRouteLivenessPatch,
  },
  {
    id: "linux-chrome-extension-status",
    phase: "main-bundle",
    order: 180,
    ciPolicy: "optional",
    apply: applyLinuxChromeExtensionStatusPatch,
  },
];
