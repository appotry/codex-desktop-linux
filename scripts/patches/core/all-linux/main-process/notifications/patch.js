"use strict";

const { mainBundlePatch } = require("../../../../descriptor.js");
const {
  applyLinuxNotificationActionsPatch,
} = require("../../../../impl/main-process/notifications.js");

module.exports = mainBundlePatch({
  id: "linux-notification-actions",
  phase: "main-bundle",
  order: 205,
  ciPolicy: "optional",
  apply: applyLinuxNotificationActionsPatch,
});
