#!/usr/bin/env node
"use strict";

const {
  SUCCESS_STATUSES,
  optionalDriftFromReport,
} = require("../lib/patch-report.js");
const {
  readPatchReport,
  uniqueStrings,
  validatePatchReport,
} = require("../lib/patch-validation.js");

function usage() {
  return [
    "Usage: validate-patch-report.js <patch-report.json> [--profile upstream-build]",
    "       [--require-enabled-feature FEATURE_ID] [--require-success PATCH_NAME]",
    "       [--require-applied PATCH_NAME]",
  ].join("\n");
}

function parseArgs(argv) {
  let profile = "upstream-build";
  const requiredEnabledFeatures = [];
  const requiredAppliedPatches = [];
  const requiredSuccessfulPatches = [];
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      profile = argv[index + 1];
      if (!profile) {
        throw new Error(usage());
      }
      index += 1;
    } else if (arg === "--require-enabled-feature") {
      const featureId = argv[index + 1];
      if (!featureId) {
        throw new Error(usage());
      }
      requiredEnabledFeatures.push(featureId);
      index += 1;
    } else if (arg === "--require-success") {
      const patchName = argv[index + 1];
      if (!patchName) {
        throw new Error(usage());
      }
      requiredSuccessfulPatches.push(patchName);
      index += 1;
    } else if (arg === "--require-applied") {
      const patchName = argv[index + 1];
      if (!patchName) {
        throw new Error(usage());
      }
      requiredAppliedPatches.push(patchName);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}\n${usage()}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    throw new Error(usage());
  }

  return {
    profile,
    reportPath: positional[0],
    requirements: {
      requiredAppliedPatches: uniqueStrings(requiredAppliedPatches),
      requiredEnabledFeatures: uniqueStrings(requiredEnabledFeatures),
      requiredSuccessfulPatches: uniqueStrings(requiredSuccessfulPatches),
    },
  };
}

const readReport = readPatchReport;
const validateReport = validatePatchReport;

function printOptionalDrift(report) {
  const drift = optionalDriftFromReport(report);
  if (drift.length === 0) {
    return;
  }
  console.warn(`Optional patch drift (${drift.length}, non-failing):`);
  for (const item of drift) {
    console.warn(`- ${item.name}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`);
  }
}

function main() {
  try {
    const { profile, reportPath, requirements } = parseArgs(process.argv.slice(2));
    const report = readReport(reportPath);
    printOptionalDrift(report);
    const failures = validateReport(report, profile, requirements);
    if (failures.length > 0) {
      console.error(`Required patch validation failed for profile ${profile}:`);
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exit(1);
    }
    console.log(`Required patch validation passed for profile ${profile}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  SUCCESS_STATUSES,
  readReport,
  validateReport,
};
