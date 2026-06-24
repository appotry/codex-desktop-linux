"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  findMatchingBrace,
  readDirectoryNames,
  requireName,
} = require("./shared.js");

function hasChromePluginLiteral(source) {
  return /(?:`chrome`|"chrome"|'chrome')/.test(source);
}

function isChromeNameExpr(nameExpr, chromeNameVar) {
  return /^(?:`chrome`|"chrome"|'chrome')$/.test(nameExpr) ||
    nameExpr === chromeNameVar;
}

function chromeNamePatterns(chromeNameVar) {
  const namePatterns = [String.raw`\`chrome\``, "\"chrome\"", "'chrome'"];
  if (chromeNameVar != null) {
    namePatterns.push(chromeNameVar);
  }
  return namePatterns;
}

function hasLinuxChromeAvailability(source) {
  return source.includes("process.platform===`linux`");
}

function hasChromeAutoInstallWithLinuxAvailability(source, chromeNameVar) {
  const namePatterns = chromeNamePatterns(chromeNameVar);
  return new RegExp(
    String.raw`\{(?=[^{}]*installWhenMissing:!0)(?=[^{}]*name:(?:${namePatterns.join("|")}))(?=[^{}]*process\.platform===\`linux\`)[^{}]*(?:isEnabled|isAvailable):[^{}]*\}`,
  ).test(source);
}

function applyLinuxChromePluginAutoInstallPatch(currentSource) {
  if (!hasChromePluginLiteral(currentSource)) {
    console.warn(
      "WARN: Could not find Chrome plugin gate literal — skipping Linux Chrome plugin auto-install patch",
    );
    return currentSource;
  }

  const chromeNameVar = currentSource.match(/([A-Za-z_$][\w$]*)=(?:`chrome`|"chrome"|'chrome')/)?.[1] ?? null;
  const nameExpressionPattern = String.raw`(?:[A-Za-z_$][\w$]*|` +
    String.raw`\`chrome\`|"chrome"|'chrome')`;
  const gateRegex =
    new RegExp(
      String.raw`\{([^{}]*?)(installWhenMissing:!0,)?name:(${nameExpressionPattern}),([^{}]*?)(isEnabled|isAvailable):\(\{([^}]*)\}\)=>([^{}]*?externalBrowserUseAllowed[^{}]*?)(,migrate:[A-Za-z_$][\w$]*)?\}`,
      "g",
    );

  let sawChromeGate = false;
  let sawAlreadyInstalledGate = false;
  const patched = currentSource.replace(
    gateRegex,
    (
      gateSource,
      prefix,
      installWhenMissing,
      nameExpr,
      middleFields,
      availabilityProp,
      paramsText,
      expression,
      migrateSuffix = "",
    ) => {
      if (!isChromeNameExpr(nameExpr, chromeNameVar)) {
        return gateSource;
      }

      sawChromeGate = true;
      const hasInstallWhenMissing = installWhenMissing != null ||
        prefix.includes("installWhenMissing:!0");
      const hasLinuxAvailability = hasLinuxChromeAvailability(expression);
      if (hasInstallWhenMissing && hasLinuxAvailability) {
        sawAlreadyInstalledGate = true;
        return gateSource;
      }

      const installWhenMissingField = hasInstallWhenMissing ? (installWhenMissing ?? "") : "installWhenMissing:!0,";
      const availabilityExpression = hasLinuxAvailability
        ? expression
        : `process.platform===\`linux\`||(${expression})`;
      return `{${prefix}${installWhenMissingField}name:${nameExpr},${middleFields}${availabilityProp}:({${paramsText}})=>${availabilityExpression}${migrateSuffix}}`;
    },
  );

  if (patched !== currentSource || (sawChromeGate && sawAlreadyInstalledGate)) {
    return patched;
  }

  if (hasChromeAutoInstallWithLinuxAvailability(currentSource, chromeNameVar)) {
    return currentSource;
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
  if (currentSource.includes("codexLinuxChromeNativeHostRuntimeFile")) {
    return currentSource;
  }

  const fsVar = requireName(currentSource, "node:fs");
  const pathVar = requireName(currentSource, "node:path");
  if (fsVar == null || pathVar == null) {
    console.warn(
      "WARN: Could not find fs/path aliases — skipping Linux Chrome native host runtime patch",
    );
    return currentSource;
  }

  const helper =
    `function codexLinuxChromeNativeHostRuntimeFile(e,t){if(process.platform!==\`linux\`||e==null)return null;for(let n of t){let t=(0,${pathVar}.join)(e,...n);try{if((0,${fsVar}.statSync)(t).isFile())return t}catch{}}return null}function codexLinuxChromeNativeHostRuntimeEnv(e){if(process.platform!==\`linux\`)return null;let t=process.env[e];if(t==null||t.length===0)return null;try{return(0,${fsVar}.statSync)(t).isFile()?t:null}catch{return null}}function codexLinuxChromeNativeHostRuntimePath(e){if(process.platform!==\`linux\`)return null;for(let t of(process.env.PATH??\`\`).split(\`:\`)){if(t.length===0)continue;let n=(0,${pathVar}.join)(t,e);try{if((0,${fsVar}.statSync)(n).isFile())return n}catch{}}return null}function codexLinuxChromeNativeHostRuntimeEntry(e,t){return e==null?null:{path:e,source:t}}`;
  let source = currentSource;
  let needsHelper = false;

  // --- Apply all matching patterns in sequence ---

  // 1. Modern CODEX_BROWSER_USE_NODE_PATH-based resolver
  const modernPatch = applyModernChromeNativeHostRuntimePatch(source, helper);
  if (modernPatch != null) {
    source = modernPatch;
    needsHelper = true;
  }

  // 2. App server runtime patch (old XB-style async function)
  const appPatch = applyChromePluginAppServerRuntimePatch(source, helper);
  if (appPatch != null) {
    source = appPatch;
    needsHelper = true;
  }

  // 3. New xB-style async function that only resolves codex via ZB-like
  //    function without Linux fallbacks. Pattern:
  //      async function [name]([p]){let [v]=FN([p]);if([v]==null)throw Error(`Missing bundled Electron Codex runtime...
  //    We inject CODEX_CLI_PATH env var and PATH fallbacks before the error.
  if (!source.includes("codexLinuxChromeNativeHostRuntimeFile")) {
    const xbRegex =
      /async function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\);if\(\3==null\)throw Error\(`Missing bundled Electron Codex runtime/;
    const xbMatch = source.match(xbRegex);
    if (xbMatch != null) {
      const [, resolverName, configVar, codexVar, fnName] = xbMatch;
      const original = xbMatch[0];
      const patched =
        `async function ${resolverName}(${configVar}){let ${codexVar}=${fnName}(${configVar})??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`)??${fnName}(${configVar});if(${codexVar}==null)throw Error(\`Missing bundled Electron Codex runtime`;
      source = source.replace(original, patched);
      needsHelper = true;
    }
  }

  // 4. Old-style patterns using "Missing bundled Electron runtime required to sync Chrome native host resources"
  const hasOldError = source.includes(
    "Missing bundled Electron runtime required to sync Chrome native host resources",
  );
  if (hasOldError) {
    // 4a. Three-variable resolver: let [codex]=FN([p].resourcesPath)??FN([p].devRuntimeRepoRoot,[ext,bin,codex]),[node]=...
    const runtimeResolverRegex =
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?([A-Za-z_$][\w$]*)\(\2\.devRuntimeRepoRoot,\[`extension`,`bin`,process\.platform===`win32`\?`codex\.exe`:`codex`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?\5\(\2\.devRuntimeRepoRoot,\[`electron`,`bin`,process\.platform===`win32`\?`node\.exe`:`node`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?\5\(\2\.devRuntimeRepoRoot,\[`electron`,`bin`,process\.platform===`win32`\?`node_repl\.exe`:`node_repl`\]\),/;
    const oldMatch = source.match(runtimeResolverRegex);
    if (oldMatch != null) {
      const [orig, resolverName, configVar, codexVar, codexResourceFn, devRuntimeFn, nodeVar, nodeResourceFn, nodeReplVar, nodeReplResourceFn] = oldMatch;
      const patched =
        `${helper}function ${resolverName}(${configVar}){let ${codexVar}=${codexResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`)??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`extension\`,\`bin\`,process.platform===\`win32\`?\`codex.exe\`:\`codex\`]),${nodeVar}=${nodeResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_BROWSER_USE_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeEnv(\`NODE_REPL_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[\`node-runtime\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]),${nodeReplVar}=${nodeReplResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_NODE_REPL_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]),`;
      source = source.replace(orig, patched);
      needsHelper = true;
    }

    // 4b. Current two-variable/one-variable resolver: let [codex]=FN([p].resourcesPath)??FN([p].devRuntimeRepoRoot,...),[node]=FN([p].resourcesPath),[node_repl]=FN([p].resourcesPath),
    const currentRuntimeResolverRegex =
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\)\?\?([A-Za-z_$][\w$]*)\(\2\.devRuntimeRepoRoot,\[`extension`,`bin`,process\.platform===`win32`\?`codex\.exe`:`codex`\]\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\2\.resourcesPath\),/;
    const currentMatch = source.match(currentRuntimeResolverRegex);
    if (currentMatch != null) {
      const [orig, resolverName, configVar, codexVar, codexResourceFn, devRuntimeFn, nodeVar, nodeResourceFn, nodeReplVar, nodeReplResourceFn] = currentMatch;
      const patched =
        `${helper}function ${resolverName}(${configVar}){let ${codexVar}=${codexResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_CLI_PATH\`)??codexLinuxChromeNativeHostRuntimePath(\`codex\`)??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`extension\`,\`bin\`,process.platform===\`win32\`?\`codex.exe\`:\`codex\`]),${nodeVar}=${nodeResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_BROWSER_USE_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeEnv(\`NODE_REPL_NODE_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[\`node-runtime\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node.exe\`:\`node\`]),${nodeReplVar}=${nodeReplResourceFn}(${configVar}.resourcesPath)??codexLinuxChromeNativeHostRuntimeEnv(\`CODEX_NODE_REPL_PATH\`)??codexLinuxChromeNativeHostRuntimeFile(${configVar}.resourcesPath,[[process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]])??${devRuntimeFn}(${configVar}.devRuntimeRepoRoot,[\`electron\`,\`bin\`,process.platform===\`win32\`?\`node_repl.exe\`:\`node_repl\`]),`;
      source = source.replace(orig, patched);
      needsHelper = true;
    }

    if (!needsHelper) {
      console.warn(
        "WARN: Could not identify Chrome native host runtime resolver shape — skipping Linux runtime path patch",
      );
      return source;
    }
  }

  if (!needsHelper) {
    return source;
  }

  // If the helper was injected as part of a replacement (patterns 4a/4b), it is
  // already in the source. For patterns 1-3, prepend it once.
  if (!source.includes("codexLinuxChromeNativeHostRuntimeFile")) {
    source = helper + source;
  }

  return source;
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
