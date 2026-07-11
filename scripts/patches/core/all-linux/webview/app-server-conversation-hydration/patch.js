"use strict";

const {
  webviewAssetPatch,
} = require("../../../../descriptor.js");
const {
  applyLinuxAppServerConversationHydrationPatch,
} = require("../../../../impl/webview/index.js");

module.exports = [
  webviewAssetPatch({
    id: "linux-app-server-conversation-hydration",
    phase: "webview-asset",
    order: 1043,
    ciPolicy: "optional",
    pattern: /^app-initial~app-main~onboarding-page~hotkey-window-thread-page~quick-chat-window-page~chatg~[^.]+\.js$/,
    missingDescription: "app-server conversation manager bundle",
    skipDescription: "Linux app-server conversation hydration patch",
    apply: applyLinuxAppServerConversationHydrationPatch,
  }),
];
