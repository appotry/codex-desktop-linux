"use strict";

const {
  extractedAppPatch,
} = require("../../../../descriptor.js");
const {
  patchLinuxBootstrapFailureExit,
  patchLinuxMultiInstanceBootstrap,
} = require("../../../../impl/bootstrap.js");

module.exports = [
  extractedAppPatch({
    id: "linux-multi-instance-bootstrap-lock",
    phase: "extracted-app:pre-webview",
    order: 125,
    // On bundles where bootstrap.js owns the single-instance lock, this is the
    // only duplicate-instance protection Linux gets (the main-bundle patch
    // defers to it), so a drifted needle must fail the build, not warn.
    ciPolicy: "required-upstream",
    apply: patchLinuxMultiInstanceBootstrap,
  }),
  extractedAppPatch({
    id: "linux-bootstrap-failure-exit",
    phase: "extracted-app:pre-webview",
    order: 126,
    // This recovery keeps a failed Linux bootstrap from retaining the
    // single-instance lock, but drift should remain fail-soft so a changed
    // upstream failure path does not reject an otherwise usable app.
    ciPolicy: "optional",
    apply: patchLinuxBootstrapFailureExit,
  }),
];
