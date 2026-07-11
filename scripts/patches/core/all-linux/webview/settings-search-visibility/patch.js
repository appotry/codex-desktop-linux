"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxSettingsSearchVisibilityPatch,
} = require("../../../../impl/webview/index.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-settings-search-visibility",
    phase: "webview-asset",
    order: 1044,
    ciPolicy: "optional",
    pattern: /^settings-page-.*\.js$/,
    missingDescription: "settings search bundle",
    skipDescription: "Linux settings search visibility patch",
    apply: applyLinuxSettingsSearchVisibilityPatch,
  }),
];
