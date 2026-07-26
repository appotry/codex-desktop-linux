"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

const {
  extractedAppPatch,
  webviewAssetPatch,
} = require("../../scripts/patches/descriptor.js");

const CODEX_MICRO_GATE_ID = "3207467860";
const CODEX_MICRO_ROUTE = "/settings/codex-micro";
const CODEX_MICRO_GATE_MARKER = "codexLinuxCodexMicroGateOverride";
const FEATURE_GATE_WARNING = "useFeatureGate hook failed to find a valid StatsigClient";
const JS_IDENT = "[A-Za-z_$][\\w$]*";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportedFeatureGateHook(source) {
  const exportStart = source.lastIndexOf("export{");
  const exportEnd = exportStart < 0 ? -1 : source.indexOf("}", exportStart);
  if (exportStart < 0 || exportEnd < 0) {
    return null;
  }

  const exportBlock = source.slice(exportStart, exportEnd + 1);
  const candidates = new RegExp(
    `function (${JS_IDENT})\\((${JS_IDENT})\\)\\{return ` +
      `(${JS_IDENT})\\(\\),(${JS_IDENT})\\((${JS_IDENT}),\\2\\)\\}`,
    "g",
  );
  const exportedCandidates = [];
  for (const match of source.matchAll(candidates)) {
    const hookName = match[1];
    const exportedAsGateHook = new RegExp(
      `(?:\\{|,)${escapeRegExp(hookName)} as ${JS_IDENT}(?:,|\\})`,
    );
    if (exportedAsGateHook.test(exportBlock)) {
      exportedCandidates.push({
        source: match[0],
        hookName,
        argumentName: match[2],
        contextHookName: match[3],
        atomReadName: match[4],
        gateAtomName: match[5],
      });
    }
  }
  return exportedCandidates.length === 1 ? exportedCandidates[0] : null;
}

function hasCodexMicroCallsite(source, hookName) {
  if (typeof source !== "string" || typeof hookName !== "string") {
    return false;
  }
  const gateCall = new RegExp(
    `(?:^|[^A-Za-z0-9_$.])${escapeRegExp(hookName)}\\(\`${CODEX_MICRO_GATE_ID}\`\\)`,
  );
  return gateCall.test(source)
    && source.includes(`\`${CODEX_MICRO_ROUTE}\``);
}

function matchesCodexMicroFeatureGateContract(source) {
  if (typeof source !== "string") {
    return false;
  }
  if (source.includes(CODEX_MICRO_GATE_MARKER)) {
    return true;
  }
  const hook = exportedFeatureGateHook(source);
  return source.includes(FEATURE_GATE_WARNING)
    && hook != null
    && hasCodexMicroCallsite(source, hook.hookName);
}

function applyCodexMicroFeatureGatePatch(source) {
  if (typeof source !== "string" || source.includes(CODEX_MICRO_GATE_MARKER)) {
    return source;
  }

  const hook = exportedFeatureGateHook(source);
  if (hook == null) {
    if (source.includes(FEATURE_GATE_WARNING)) {
      console.warn(
        "WARN: Could not find the current exported feature-gate hook - " +
          "skipping Codex Micro gate override",
      );
    }
    return source;
  }
  if (!hasCodexMicroCallsite(source, hook.hookName)) {
    return source;
  }

  const replacement =
    `function ${hook.hookName}(${hook.argumentName}){return ` +
    `${hook.contextHookName}(),${hook.atomReadName}(${hook.gateAtomName},${hook.argumentName})||` +
    `${hook.argumentName}===\`${CODEX_MICRO_GATE_ID}\`/*${CODEX_MICRO_GATE_MARKER}*/}`;
  return source.replace(hook.source, replacement);
}

function stageNativeBinding(extractedDir) {
  const helper = path.join(__dirname, "native-binding.js");
  const output = childProcess.execFileSync(process.execPath, [helper, "--stage", extractedDir], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(output);
}

module.exports = {
  CODEX_MICRO_GATE_ID,
  CODEX_MICRO_GATE_MARKER,
  CODEX_MICRO_ROUTE,
  applyCodexMicroFeatureGatePatch,
  exportedFeatureGateHook,
  hasCodexMicroCallsite,
  matchesCodexMicroFeatureGateContract,
  descriptors: [
    webviewAssetPatch({
      id: "webview-feature-gate",
      order: 28_990,
      ciPolicy: "opt-in",
      pattern: /^app-initial-[A-Za-z0-9_-]+\.js$/,
      assetMatch: matchesCodexMicroFeatureGateContract,
      missingDescription: "current Codex Micro feature-gate webview bundle",
      skipDescription: "Codex Micro feature-gate override",
      apply: applyCodexMicroFeatureGatePatch,
    }),
    extractedAppPatch({
      id: "linux-node-hid-binding",
      phase: "extracted-app:post-webview",
      order: 29_000,
      ciPolicy: "opt-in",
      targetSummary: "current Work Louder nested node-hid 3.3.0 dependency",
      apply: (extractedDir) => stageNativeBinding(extractedDir),
      status: (result) => ({
        status: result?.changed
          ? "applied"
          : result?.alreadyApplied
            ? "already-applied"
            : "skipped-optional",
        reason: result == null
          ? "node-hid binding staging returned no result"
          : `${result.source} node-hid ${result.version}`,
      }),
    }),
  ],
};
