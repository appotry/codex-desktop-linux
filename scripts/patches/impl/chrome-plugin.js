"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  findMatchingBrace,
  requireName,
} = require("../lib/minified-js.js");
const {
  readDirectoryNames,
} = require("../lib/assets.js");

function applyLinuxChromePluginAutoInstallPatch(currentSource) {
  const gateRegex =
    /\{([^{}]*?)(installWhenMissing:!0,)?name:([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*),([^{}]*?syncInstallStateWithChromeExtension:!0,isAvailable:\(\{buildFlavor:([A-Za-z_$][\w$]*),features:([A-Za-z_$][\w$]*)\}\)=>)((?:process\.platform===`linux`\|\|\()?\6\.externalBrowserUseAllowed&&[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(\5\)\)?)\}/g;

  let sawChromeGate = false;
  const patched = currentSource.replace(
    gateRegex,
    (
      gateSource,
      prefix,
      installWhenMissing,
      nameExpr,
      middleFields,
      _buildFlavorVar,
      _featuresVar,
      expression,
    ) => {
      sawChromeGate = true;
      const hasInstallWhenMissing = installWhenMissing != null ||
        prefix.includes("installWhenMissing:!0");
      const hasLinuxAvailability = expression.startsWith("process.platform===`linux`||(");
      if (hasInstallWhenMissing && hasLinuxAvailability) {
        return gateSource;
      }

      const installWhenMissingField = hasInstallWhenMissing ? (installWhenMissing ?? "") : "installWhenMissing:!0,";
      const availabilityExpression = hasLinuxAvailability
        ? expression
        : `process.platform===\`linux\`||(${expression})`;
      return `{${prefix}${installWhenMissingField}name:${nameExpr},${middleFields}${availabilityExpression}}`;
    },
  );

  if (sawChromeGate) {
    return patched;
  }

  if (currentSource.includes("externalBrowserUseAllowed")) {
    throw new Error("Required Linux Chrome plugin auto-install patch failed: could not enable bundled Chrome auto-install");
  }

  console.warn(
    "WARN: Could not find Chrome plugin auto-install gate — skipping Linux Chrome plugin auto-install patch",
  );
  return currentSource;
}

function applyLinuxChromeNativeHostRuntimePatch(currentSource) {
  if (
    currentSource.includes("codexLinuxChromePluginAppServerSourcePath") &&
    currentSource.includes("codexLinuxChromeNativeHostRuntimeFile")
  ) {
    return currentSource;
  }

  let helper = "";
  if (!currentSource.includes("codexLinuxChromeNativeHostRuntimeFile")) {
    const fsVar = requireName(currentSource, "node:fs");
    const pathVar = requireName(currentSource, "node:path");
    if (fsVar == null || pathVar == null) {
      console.warn(
        "WARN: Could not find fs/path aliases — skipping Linux Chrome native host runtime patch",
      );
      return currentSource;
    }

    helper =
      `function codexLinuxChromeNativeHostRuntimeFile(e,t){if(process.platform!==\`linux\`||e==null)return null;for(let n of t){let t=(0,${pathVar}.join)(e,...n);try{if((0,${fsVar}.statSync)(t).isFile())return t}catch{}}return null}function codexLinuxChromeNativeHostRuntimeEnv(e){if(process.platform!==\`linux\`)return null;let t=process.env[e];if(t==null||t.length===0)return null;try{return(0,${fsVar}.statSync)(t).isFile()?t:null}catch{return null}}function codexLinuxChromeNativeHostRuntimePath(e){if(process.platform!==\`linux\`)return null;for(let t of(process.env.PATH??\`\`).split(\`:\`)){if(t.length===0)continue;let n=(0,${pathVar}.join)(t,e);try{if((0,${fsVar}.statSync)(n).isFile())return n}catch{}}return null}function codexLinuxChromeNativeHostRuntimeEntry(e,t){return e==null?null:{path:e,source:t}}`;
  }

  let patchedSource = currentSource;
  let changed = false;
  const takePatch = (nextSource) => {
    if (nextSource == null || nextSource === patchedSource) {
      return false;
    }
    patchedSource = nextSource;
    helper = "";
    changed = true;
    return true;
  };

  const sourcePathPatched = applyLinuxChromePluginAppServerSourcePathPatch(patchedSource);
  if (sourcePathPatched !== patchedSource) {
    patchedSource = sourcePathPatched;
    changed = true;
  }
  takePatch(applyModernChromeNativeHostRuntimePatch(patchedSource, helper));
  takePatch(applyChromePluginCodexAppServerRuntimePatch(patchedSource, helper));
  takePatch(applyChromePluginAppServerRuntimePatch(patchedSource, helper));
  if (changed) {
    return patchedSource;
  }

  const missingRuntimeMessage =
    "Missing bundled Electron runtime required to sync Chrome native host resources";
  if (
    !currentSource.includes(missingRuntimeMessage) &&
    !currentSource.includes("Missing bundled Electron Codex runtime required to sync Chrome plugin app server")
  ) {
    console.warn(
      "WARN: Could not find Chrome native host runtime resolver — skipping Linux runtime path patch",
    );
    return currentSource;
  }

  const appServerRuntimePatch = applyChromePluginAppServerRuntimePatch(
    currentSource,
    helper,
  );
  if (appServerRuntimePatch != null) {
    return appServerRuntimePatch;
  }

  const runtimeResolverRegex =
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?([A-Za-z_$][\w$]*)\(\2\.devRuntimeRepoRoot,\[`extension`,`bin`,process\.platform===`win32`\?`codex\.exe`:`codex`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?\5\(\2\.devRuntimeRepoRoot,\[`electron`,`bin`,process\.platform===`win32`\?`node\.exe`:`node`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?\5\(\2\.devRuntimeRepoRoot,\[`electron`,`bin`,process\.platform===`win32`\?`node_repl\.exe`:`node_repl`\]\),/;
  const match = currentSource.match(runtimeResolverRegex);
  if (match != null) {
    const [
      originalPrefix,
      resolverName,
      configVar,
      codexVar,
      codexResourceFn,
      devRuntimeFn,
      nodeVar,
      nodeResourceFn,
      nodeReplVar,
      nodeReplResourceFn,
    ] = match;
    const replacement =
      `${helper}function ${resolverName}(${configVar}){let ${codexVar}=${codexResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`)??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`extension\`,\`bin\`,process.platform===\`win32\`?\`codex.exe\`:\`codex\`]),${nodeVar}=${nodeResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_BROWSER_USE_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeEnv(\`NODE_REPL_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[\`node-runtime\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]),${nodeReplVar}=${nodeReplResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_NODE_REPL_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]),`;

    return currentSource.replace(originalPrefix, replacement);
  }

  const currentRuntimeResolverRegex =
    /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?([A-Za-z_$][\w$]*)\(\2\.devRuntimeRepoRoot,\[`extension`,`bin`,process\.platform===`win32`\?`codex\.exe`:`codex`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),/;
  const currentMatch = currentSource.match(currentRuntimeResolverRegex);
  if (currentMatch == null) {
    console.warn(
      "WARN: Could not identify Chrome native host runtime resolver shape — skipping Linux runtime path patch",
    );
    return currentSource;
  }

  const [
    originalPrefix,
    resolverName,
    configVar,
    codexVar,
    codexResourceFn,
    devRuntimeFn,
    nodeVar,
    nodeResourceFn,
    nodeReplVar,
    nodeReplResourceFn,
  ] = currentMatch;
  const replacement =
    `${helper}function ${resolverName}(${configVar}){let ${codexVar}=${codexResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`)??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`extension\`,\`bin\`,process.platform===\`win32\`?\`codex.exe\`:\`codex\`]),${nodeVar}=${nodeResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_BROWSER_USE_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeEnv(\`NODE_REPL_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[\`node-runtime\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]),${nodeReplVar}=${nodeReplResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_NODE_REPL_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]),`;

  return currentSource.replace(originalPrefix, replacement);
}

function applyLinuxChromePluginAppServerSourcePathPatch(currentSource) {
  const marker = "codexLinuxChromePluginAppServerSourcePath";
  const isolationRoot = currentSource.indexOf(".plugin-appserver");
  if (currentSource.includes(marker) || isolationRoot === -1) {
    return currentSource;
  }

  const isolationSource = currentSource.slice(isolationRoot, isolationRoot + 12_000);
  const syncFunctionRegex =
    /async function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{(?=let [A-Za-z_$][\w$]*=\2\.nativeHostName===)/;
  const match = isolationSource.match(syncFunctionRegex);
  if (match == null) {
    console.warn(
      "WARN: Could not find Chrome plugin app-server isolation function — Linux CLI path may not be relocatable",
    );
    return currentSource;
  }

  const [functionStart, , configVar] = match;
  const helper = `function ${marker}(e){return e.codexCliPath}`;
  const functionIndex = isolationRoot + match.index;
  return currentSource.slice(0, functionIndex) +
    `${helper}${functionStart}if(process.platform===\`linux\`)return ${marker}(${configVar});` +
    currentSource.slice(functionIndex + functionStart.length);
}

function applyChromePluginCodexAppServerRuntimePatch(currentSource, helper) {
  if (!currentSource.includes("Missing bundled Electron Codex runtime required to sync Chrome plugin app server")) {
    return null;
  }

  const appServerCodexRuntimeRegex =
    /async function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\);if\(\3==null\)throw Error\(`Missing bundled Electron Codex runtime required to sync Chrome plugin app server for \$\{\2\.nativeHostName\} \(resourcesPath: \$\{\2\.resourcesPath\?\?`<none>`\}\)\.`\);return ([A-Za-z_$][\w$]*)\(\{codexCliPath:\3,codexHome:\2\.codexHome,nativeHostName:\2\.nativeHostName\}\)\}/;
  const match = currentSource.match(appServerCodexRuntimeRegex);
  if (match == null) {
    return null;
  }

  const [
    original,
    resolverFn,
    configVar,
    codexVar,
    bundledCodexResolverFn,
    syncFn,
  ] = match;
  const replacement =
    `${helper}async function ${resolverFn}(${configVar}){let ${codexVar}=${bundledCodexResolverFn}(${configVar})??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`);if(${codexVar}==null)throw Error(\`Missing bundled Electron Codex runtime required to sync Chrome plugin app server for \${${configVar}.nativeHostName} (resourcesPath: \${${configVar}.resourcesPath??\`<none>\`}).\`);return ${syncFn}({codexCliPath:${codexVar},codexHome:${configVar}.codexHome,nativeHostName:${configVar}.nativeHostName})}`;
  return currentSource.replace(original, replacement);
}

function applyChromePluginAppServerRuntimePatch(currentSource, helper) {
  if (!currentSource.includes("nativeHostName") || !currentSource.includes("nodeModuleDirs")) {
    return null;
  }

  const appServerRuntimeRegex =
    /async function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),/;
  const match = currentSource.match(appServerRuntimeRegex);
  if (match == null) {
    return null;
  }
  const [
    originalPrefix,
    resolverFn,
    configVar,
    codexVar,
    codexResolverFn,
    nodeVar,
    nodeResolverFn,
    nodeReplVar,
    nodeReplResolverFn,
  ] = match;
  const replacement =
    `${helper}async function ${resolverFn}(${configVar}){let ${codexVar}=${codexResolverFn}(${configVar})??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`),${nodeVar}=${nodeResolverFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_BROWSER_USE_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeEnv(\`NODE_REPL_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[\`node-runtime\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]]),${nodeReplVar}=${nodeReplResolverFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_NODE_REPL_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]]),`;
  return currentSource.replace(originalPrefix, replacement);
}

function applyModernChromeNativeHostRuntimePatch(currentSource, helper) {
  if (
    !currentSource.includes("CODEX_BROWSER_USE_NODE_PATH") ||
    !currentSource.includes("nodeReplPathSource") ||
    !currentSource.includes("resolvePrimaryRuntimeNodePath")
  ) {
    return null;
  }

  const markerIndex = currentSource.indexOf("CODEX_BROWSER_USE_NODE_PATH");
  const functionStart = currentSource.lastIndexOf("function ", markerIndex);
  if (functionStart === -1) {
    return null;
  }
  const functionBodyMarker = currentSource.indexOf("){", functionStart);
  if (functionBodyMarker === -1) {
    return null;
  }
  const functionBrace = functionBodyMarker + 1;
  const functionEnd = findMatchingBrace(currentSource, functionBrace);
  if (functionEnd === -1) {
    return null;
  }

  const resolverSource = currentSource.slice(functionStart, functionEnd + 1);
  const varsMatch = resolverSource.match(
    /function [A-Za-z_$][\w$]*\(\{env:([A-Za-z_$][\w$]*)=process\.env,[^{}]*?platform:([A-Za-z_$][\w$]*)=process\.platform,[^{}]*?resourcesPath:([A-Za-z_$][\w$]*)\}\)\{let ([A-Za-z_$][\w$]*)=\3\?\?/,
  );
  if (varsMatch == null) {
    return null;
  }
  const [, envVar, platformVar, , resourcesVar] = varsMatch;
  let patchedResolver = resolverSource;
  const codexPathRegex = new RegExp(
    String.raw`(rawValue:${envVar}\.CODEX_CLI_PATH,resolveWindowsAppsPath:[A-Za-z_$][\w$]*\}\)\?\?)([A-Za-z_$][\w$]*)\(\{devRelativePathSegments:\[\`extension\`,\`bin\`,\`codex\`\]`,
  );
  const nodePathRegex = new RegExp(
    String.raw`(rawValue:${envVar}\.CODEX_BROWSER_USE_NODE_PATH,resolveWindowsAppsPath:[A-Za-z_$][\w$]*\}\)\?\?)(\([A-Za-z_$][\w$]*\.path==null&&[A-Za-z_$][\w$]*!=null\?)`,
  );
  const nodeReplPathRegex = new RegExp(
    String.raw`(rawValue:${envVar}\.CODEX_NODE_REPL_PATH,resolveWindowsAppsPath:[A-Za-z_$][\w$]*\}\)\?\?)([A-Za-z_$][\w$]*)\(\{devRelativePathSegments:null`,
  );

  patchedResolver = patchedResolver.replace(
    codexPathRegex,
    (_match, prefix, resolverFn) =>
      `${prefix}codexLinuxChromeNativeHostRuntimeEntry(codexLinuxChromeNativeHostRuntimePath(\`codex\`),\`linux-path\`)??${resolverFn}({devRelativePathSegments:[\`extension\`,\`bin\`,\`codex\`]`,
  );
  patchedResolver = patchedResolver.replace(
    nodePathRegex,
    (_match, prefix, fallbackExpressionStart) =>
      `${prefix}codexLinuxChromeNativeHostRuntimeEntry(codexLinuxChromeNativeHostRuntimeFile(${resourcesVar},[[\`node-runtime\`,\`bin\`,${platformVar}===\`win32\`?\`node.exe\`:\`node\`]]),\`linux-node-runtime\`)??${fallbackExpressionStart}`,
  );
  patchedResolver = patchedResolver.replace(
    nodeReplPathRegex,
    (_match, prefix, resolverFn) =>
      `${prefix}codexLinuxChromeNativeHostRuntimeEntry(codexLinuxChromeNativeHostRuntimeFile(${resourcesVar},[[${platformVar}===\`win32\`?\`node_repl.exe\`:\`node_repl\`]]),\`linux-node-repl-runtime\`)??${resolverFn}({devRelativePathSegments:null`,
  );

  if (patchedResolver === resolverSource) {
    return null;
  }

  return currentSource.slice(0, functionStart) +
    helper +
    patchedResolver +
    currentSource.slice(functionEnd + 1);
}

function patchLinuxChromeNativeHostRuntimeAssets(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    const reason = `Could not find build directory in ${buildDir}`;
    console.warn(`WARN: ${reason} — skipping Linux Chrome native host runtime patch`);
    return { matched: 0, changed: 0, reason };
  }

  let matched = 0;
  let changed = 0;
  for (const fileName of readDirectoryNames(buildDir).filter((name) => name.endsWith(".js")).sort()) {
    const filePath = path.join(buildDir, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    if (
      !source.includes("Missing bundled Electron runtime required to sync Chrome native host resources") &&
      !source.includes("codexLinuxChromeNativeHostRuntimeFile") &&
      !(
        source.includes("CODEX_BROWSER_USE_NODE_PATH") &&
        source.includes("nodeReplPathSource") &&
        source.includes("resolvePrimaryRuntimeNodePath")
      )
    ) {
      continue;
    }

    matched += 1;
    const patched = applyLinuxChromeNativeHostRuntimePatch(source);
    if (patched !== source) {
      fs.writeFileSync(filePath, patched, "utf8");
      changed += 1;
    }
  }

  return { matched, changed };
}

module.exports = {
  applyLinuxChromeNativeHostRuntimePatch,
  applyLinuxChromePluginAutoInstallPatch,
  patchLinuxChromeNativeHostRuntimeAssets,
};
