#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyWebviewAssetPatchDescriptors,
  normalizePatchDescriptors,
} = require("../../scripts/patches/engine.js");
const {
  loadLinuxFeaturePatchDescriptors,
} = require("../../scripts/lib/linux-features.js");
const {
  applyApiKeyModelVisibilityPatch,
  descriptors,
} = require("./patch.js");

function applyPatchTwice(patchFn, source) {
  const once = patchFn(source);
  assert.notEqual(once, source);
  assert.equal(patchFn(once), once);
  return once;
}

function modelVisibilityHelperFixture() {
  return "function q$r({additionalAvailableModels:e,authMethod:t,availableModels:n,model:r,useHiddenModels:i}){return e?.has(r.model)===!0||(i&&t!==`amazonBedrock`?n.has(r.model):!r.hidden)}";
}

function modelCatalogFixture() {
  // Current upstream shape (refactored): catalog filter delegates per-model
  // visibility to a q$r-style helper that owns the allowlist gate.
  return "function vbe({additionalAvailableModels:e,authMethod:t,availableModels:n,defaultModel:r,enabledReasoningEfforts:i,includeUltraReasoningEffort:a,models:o,useHiddenModels:s}){let c=[],l=null;return o.forEach(r=>{if(q$r({additionalAvailableModels:e,authMethod:t,availableModels:n,model:r,useHiddenModels:s})){c.push(r),r.isDefault&&(l=r)}}),l??=c.find(e=>e.model===r)??null,{models:c,defaultModel:l}}" + modelVisibilityHelperFixture();
}

function evaluateCatalog(source, authMethod, useHiddenModels = true) {
  const catalog = Function(`${source};return vbe;`)();
  return catalog({
    authMethod,
    availableModels: new Set(["gpt-5.5"]),
    defaultModel: "gpt-5.5",
    enabledReasoningEfforts: new Set(),
    includeUltraReasoningEffort: true,
    models: [
      { model: "gpt-5.6-sol", hidden: false, isDefault: true },
      { model: "gpt-5.6-terra", hidden: false, isDefault: false },
      { model: "gpt-5.6-luna", hidden: false, isDefault: false },
      { model: "gpt-5.5", hidden: false, isDefault: false },
      { model: "codex-auto-review", hidden: true, isDefault: false },
    ],
    useHiddenModels,
  });
}

function modelNames(catalog) {
  return catalog.models.map((model) => model.model);
}

function withTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-key-model-visibility-"));
  try {
    return callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function withFeatureConfig(enabled, callback) {
  const originalConfig = process.env.CODEX_LINUX_FEATURES_CONFIG;
  return withTempDir((tempDir) => {
    const configPath = path.join(tempDir, "features.json");
    fs.writeFileSync(configPath, `${JSON.stringify({ enabled })}\n`);
    process.env.CODEX_LINUX_FEATURES_CONFIG = configPath;
    try {
      return callback(path.resolve(__dirname, ".."));
    } finally {
      if (originalConfig == null) {
        delete process.env.CODEX_LINUX_FEATURES_CONFIG;
      } else {
        process.env.CODEX_LINUX_FEATURES_CONFIG = originalConfig;
      }
    }
  });
}

test("api-key-model-visibility stays disabled until listed in features.json", () => {
  withFeatureConfig([], (featuresRoot) => {
    assert.deepEqual(loadLinuxFeaturePatchDescriptors({ featuresRoot }), []);
  });

  withFeatureConfig(["api-key-model-visibility"], (featuresRoot) => {
    const loaded = loadLinuxFeaturePatchDescriptors({ featuresRoot });
    assert.deepEqual(
      loaded.map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
      [["feature:api-key-model-visibility:api-key-model-visibility-ui", "webview-asset", "optional"]],
    );
  });
});

test("descriptor is optional and targets app main webview chunks", () => {
  assert.deepEqual(
    descriptors.map((descriptor) => [descriptor.id, descriptor.phase, descriptor.ciPolicy]),
    [["api-key-model-visibility-ui", "webview-asset", "optional"]],
  );
  assert.equal(descriptors[0].pattern.test("app-initial~app-main~onboarding-page-abc.js"), false);
  assert.equal(descriptors[0].pattern.test("app-initial-CKNQDTeE.js"), true);
  assert.equal(descriptors[0].pattern.test("settings-page-abc.js"), false);
});

test("API-key hosts use visible CLI models instead of the desktop allowlist", () => {
  const patched = applyPatchTwice(applyApiKeyModelVisibilityPatch, modelCatalogFixture());
  const catalog = evaluateCatalog(patched, "apikey");

  assert.match(patched, /!==`apikey`\/\*codexLinuxApiKeyModelVisibility\*\//);
  assert.deepEqual(modelNames(catalog), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
  assert.equal(catalog.defaultModel.model, "gpt-5.6-sol");
});

test("API-key hosts still exclude models marked hidden by the CLI", () => {
  const patched = applyApiKeyModelVisibilityPatch(modelCatalogFixture());

  assert.equal(modelNames(evaluateCatalog(patched, "apikey")).includes("codex-auto-review"), false);
});

test("ChatGPT and existing no-allowlist paths keep their upstream behavior", () => {
  const patched = applyApiKeyModelVisibilityPatch(modelCatalogFixture());

  assert.deepEqual(modelNames(evaluateCatalog(patched, "chatgpt")), ["gpt-5.5"]);
  assert.deepEqual(modelNames(evaluateCatalog(patched, "copilot")), ["gpt-5.5"]);
  assert.deepEqual(modelNames(evaluateCatalog(patched, "chatgpt", false)), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
  assert.deepEqual(modelNames(evaluateCatalog(patched, "amazonBedrock")), [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ]);
});

test("drifted model visibility helpers fail soft and stay byte-identical", () => {
  const helper = modelVisibilityHelperFixture();
  const driftedHelpers = [
    "function q$r({additionalAvailableModels:e,authMethod:t,availableModels:n,model:r,useHiddenModels:i}){return i&&t!==`amazonBedrock`;}",
    "function q$r({additionalAvailableModels:e,authMethod:t,availableModels:n,model:r,useHiddenModels:i}){return i&&t!==`amazonBedrock`,n.has(r.model)}",
    helper.replace(
      "?n.has(r.model):!r.hidden",
      "?featureGate&&n.has(r.model):!r.hidden",
    ),
    helper.replace(
      "?n.has(r.model):!r.hidden",
      "?n.has(r.model):featureGate&&!r.hidden",
    ),
  ];

  for (const source of driftedHelpers) {
    assert.equal(applyApiKeyModelVisibilityPatch(source), source);
  }
});

test("enabled descriptor patches a matching extracted webview asset", () => {
  withFeatureConfig(["api-key-model-visibility"], (featuresRoot) => {
    withTempDir((extractedDir) => {
      const assetsDir = path.join(extractedDir, "webview", "assets");
      const assetPath = path.join(assetsDir, "app-initial-CKNQDTeE.js");
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(assetPath, modelCatalogFixture());

      const normalized = normalizePatchDescriptors(
        loadLinuxFeaturePatchDescriptors({ featuresRoot }),
      );
      applyWebviewAssetPatchDescriptors(extractedDir, normalized, {}, null);

      assert.match(fs.readFileSync(assetPath, "utf8"), /codexLinuxApiKeyModelVisibility/);
    });
  });
});
