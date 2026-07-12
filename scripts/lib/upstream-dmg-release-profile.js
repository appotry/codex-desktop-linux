"use strict";

const UPSTREAM_DMG_RELEASE_PROFILE = Object.freeze({
  id: "upstream-release",
  corePatchProfile: "upstream-build",
  rejectEnabledFeatureDrift: true,
});

module.exports = { UPSTREAM_DMG_RELEASE_PROFILE };
