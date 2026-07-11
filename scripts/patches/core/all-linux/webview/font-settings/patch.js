"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const { applyLinuxSafeMonospaceFontStackPatch } = require("../../../../impl/webview/index.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-safe-monospace-font-stack",
    phase: "webview-asset",
    order: 1045,
    ciPolicy: "optional",
    pattern: /^app-initial~app-main~page-[^.]+\.js$/,
    missingDescription: "font settings bundle",
    skipDescription: "Linux monospace font stack patch",
    apply: applyLinuxSafeMonospaceFontStackPatch,
  }),
];
