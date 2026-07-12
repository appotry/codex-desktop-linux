"use strict";

const fs = require("node:fs");

const { requiredPatchNamesForProfile } = require("../patches/runner.js");
const {
  PATCH_STATUS_APPLIED,
  SUCCESS_STATUSES,
  criticalFailuresFromReport,
} = require("./patch-report.js");

function uniqueStrings(values) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.filter((value) => typeof value === "string" && value.length > 0))];
}

function readPatchReport(reportPath) {
  const raw = fs.readFileSync(reportPath, "utf8");
  const report = JSON.parse(raw);
  if (report == null || typeof report !== "object" || !Array.isArray(report.patches)) {
    throw new Error(`Invalid patch report: ${reportPath}`);
  }
  return report;
}

function validatePatchReport(report, profile, requirements = {}) {
  const requiredNames = requiredPatchNamesForProfile(profile);
  const patches = Array.isArray(report?.patches) ? report.patches : [];
  const patchesByName = new Map(patches.map((patch) => [patch.name, patch]));
  const enabledFeatures = new Set(Array.isArray(report.enabledFeatures) ? report.enabledFeatures : []);
  const requiredAppliedPatches = uniqueStrings(requirements.requiredAppliedPatches ?? []);
  const requiredEnabledFeatures = uniqueStrings(requirements.requiredEnabledFeatures ?? []);
  const requiredSuccessfulPatches = uniqueStrings(requirements.requiredSuccessfulPatches ?? []);
  const failures = [];

  // A required patch that never ran leaves no report entry, so report status
  // checks alone cannot detect it.
  for (const name of requiredNames) {
    if (!patchesByName.has(name)) {
      failures.push(`${name}: missing from patch report`);
    }
  }

  for (const failure of criticalFailuresFromReport(report)) {
    failures.push(`${failure.name}: ${failure.status}${failure.reason ? ` (${failure.reason})` : ""}`);
  }

  for (const featureId of requiredEnabledFeatures) {
    if (!enabledFeatures.has(featureId)) {
      failures.push(`feature ${featureId}: not enabled in patch report`);
    }
  }

  for (const name of requiredSuccessfulPatches) {
    const patch = patchesByName.get(name);
    if (patch == null) {
      failures.push(`${name}: missing from patch report`);
    } else if (!SUCCESS_STATUSES.has(patch.status)) {
      failures.push(`${name}: ${patch.status}${patch.reason ? ` (${patch.reason})` : ""}`);
    }
  }

  for (const name of requiredAppliedPatches) {
    const patch = patchesByName.get(name);
    if (patch == null) {
      failures.push(`${name}: missing from patch report`);
    } else if (patch.status !== PATCH_STATUS_APPLIED) {
      failures.push(`${name}: expected applied, got ${patch.status}${patch.reason ? ` (${patch.reason})` : ""}`);
    }
  }

  return [...new Set(failures)];
}

module.exports = {
  readPatchReport,
  uniqueStrings,
  validatePatchReport,
};
