"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Upstream gates the bootstrap single-instance lock behind a flag computed
// from {isMacOS, isPackaged}, which is always false on Linux — so the stock
// `!flag ||` short-circuit skips requestSingleInstanceLock() entirely and
// Linux gets no duplicate-instance protection. Rewrite the gate so Linux
// always takes the lock (unless an explicit CODEX_LINUX_MULTI_LAUNCH=1
// side-by-side launch opts out) while other platforms keep upstream
// semantics. Shapes handled, with minified variable names captured
// dynamically (enabled flag, electron namespace):
//   upstream:  if(!(!S||n.app.requestSingleInstanceLock()))
//   guarded:   if(!(!S||process.platform===`linux`&&process.env.CODEX_LINUX_MULTI_LAUNCH===`1`||n.app.requestSingleInstanceLock()))
//   enforced:  if(!(process.platform===`linux`?process.env.CODEX_LINUX_MULTI_LAUNCH===`1`||n.app.requestSingleInstanceLock():!S||n.app.requestSingleInstanceLock()))
const enforcedLockRegex =
  /if\(!\(process\.platform===`linux`\?process\.env\.CODEX_LINUX_MULTI_LAUNCH===`1`\|\|([A-Za-z_$][\w$]*)\.app\.requestSingleInstanceLock\(\):!([A-Za-z_$][\w$]*)\|\|\1\.app\.requestSingleInstanceLock\(\)\)\)/;
const guardedLockRegex =
  /if\(!\(!([A-Za-z_$][\w$]*)\|\|process\.platform===`linux`&&process\.env\.CODEX_LINUX_MULTI_LAUNCH===`1`\|\|([A-Za-z_$][\w$]*)\.app\.requestSingleInstanceLock\(\)\)\)/;
const unguardedLockRegex =
  /if\(!\(!([A-Za-z_$][\w$]*)\|\|([A-Za-z_$][\w$]*)\.app\.requestSingleInstanceLock\(\)\)\)/;
const bootstrapImportRegex = /require\((["'])\.\/(bootstrap-[A-Za-z0-9_-]+\.js)\1\)/g;

const bootstrapFailureTailRegex =
  /(for\(let ([A-Za-z_$][\w$]*) of ([A-Za-z_$][\w$]*)\.BrowserWindow\.getAllWindows\(\)\)\2\.isDestroyed\(\)\|\|\2\.destroy\(\);[^]{0,400}?`Desktop bootstrap failed to start the main app`[^]{0,400}?),await ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)/;
const patchedBootstrapFailureTailRegex =
  /Desktop bootstrap failed to start the main app[^]*?process\.platform===`linux`\?Promise\.race\([^]*?process\.platform===`linux`&&[A-Za-z_$][\w$]*\.app\.exit\(1\)/;
const linuxBootstrapFailureExitTimeoutMs = "15e3";

function resolveBootstrapBundle(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  const entrypoint = path.join(buildDir, "early-bootstrap.js");
  if (!fs.existsSync(entrypoint)) {
    throw new Error(`Could not find current bootstrap entrypoint at ${entrypoint}`);
  }

  const entrypointSource = fs.readFileSync(entrypoint, "utf8");
  const bundleNames = [
    ...new Set(Array.from(entrypointSource.matchAll(bootstrapImportRegex), (match) => match[2])),
  ];
  if (bundleNames.length !== 1) {
    throw new Error(
      `Expected exactly one hashed bootstrap bundle in ${entrypoint}, found ${bundleNames.length}`,
    );
  }

  const target = path.join(buildDir, bundleNames[0]);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Bootstrap bundle referenced by ${entrypoint} was not found at ${target}`);
  }
  return target;
}

function enforcedLockCondition(enabledVar, appVar) {
  return (
    "if(!(process.platform===`linux`?process.env.CODEX_LINUX_MULTI_LAUNCH===`1`||" +
    `${appVar}.app.requestSingleInstanceLock():!${enabledVar}||` +
    `${appVar}.app.requestSingleInstanceLock()))`
  );
}

function applyLinuxMultiInstanceBootstrapPatch(currentSource) {
  if (enforcedLockRegex.test(currentSource)) {
    return currentSource;
  }
  if (guardedLockRegex.test(currentSource)) {
    return currentSource.replace(
      guardedLockRegex,
      (_match, enabledVar, appVar) => enforcedLockCondition(enabledVar, appVar),
    );
  }
  if (unguardedLockRegex.test(currentSource)) {
    return currentSource.replace(
      unguardedLockRegex,
      (_match, enabledVar, appVar) => enforcedLockCondition(enabledVar, appVar),
    );
  }

  if (
    currentSource.includes("requestSingleInstanceLock") &&
    currentSource.includes("Exiting second desktop instance")
  ) {
    console.warn(
      "WARN: Could not find bootstrap single-instance lock — Linux builds would allow unbounded duplicate instances",
    );
  }
  return currentSource;
}

// The upstream bootstrap catches failures from runMainAppStartup(), destroys
// every BrowserWindow, and waits on a native error dialog. On Linux, the main
// bundle may already have created the warm-start socket before that failure.
// If the native dialog is hidden or never resolves, the windowless process
// keeps the single-instance lock and acknowledges every later launch forever.
// Bound the dialog wait and terminate the failed bootstrap so the launcher can
// perform a real cold start on the next attempt.
function applyLinuxBootstrapFailureExitPatch(currentSource) {
  if (patchedBootstrapFailureTailRegex.test(currentSource)) {
    return currentSource;
  }

  if (!bootstrapFailureTailRegex.test(currentSource)) {
    console.warn(
      "WARN: Could not find bootstrap failure handler — Linux failed starts may retain the single-instance lock",
    );
    return currentSource;
  }

  return currentSource.replace(
    bootstrapFailureTailRegex,
    (_match, prefix, _windowVar, electronVar, failureDialogVar, errorVar) => {
      const boundedFailureDialog =
        `await (process.platform===\`linux\`?Promise.race([${failureDialogVar}(${errorVar}),` +
        `new Promise(e=>setTimeout(e,${linuxBootstrapFailureExitTimeoutMs}))]):${failureDialogVar}(${errorVar}))`;
      return `${prefix},${boundedFailureDialog},process.platform===\`linux\`&&${electronVar}.app.exit(1)`;
    },
  );
}

function patchLinuxMultiInstanceBootstrap(extractedDir) {
  const target = resolveBootstrapBundle(extractedDir);

  const source = fs.readFileSync(target, "utf8");
  const patched = applyLinuxMultiInstanceBootstrapPatch(source);
  if (patched === source) {
    return { changed: false };
  }

  fs.writeFileSync(target, patched, "utf8");
  return { changed: true };
}

function patchLinuxBootstrapFailureExit(extractedDir) {
  const target = resolveBootstrapBundle(extractedDir);

  const source = fs.readFileSync(target, "utf8");
  const patched = applyLinuxBootstrapFailureExitPatch(source);
  if (patched === source) {
    return { changed: false };
  }

  fs.writeFileSync(target, patched, "utf8");
  return { changed: true };
}

module.exports = {
  applyLinuxBootstrapFailureExitPatch,
  applyLinuxMultiInstanceBootstrapPatch,
  patchLinuxBootstrapFailureExit,
  patchLinuxMultiInstanceBootstrap,
};
