"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PATCH_MARKER = "codexLinuxShallowRepositoryWatches";
const LOCAL_FILE_WATCH_METHOD =
  /async startFileWatch\((?<options>[A-Za-z_$][\w$]*)\)\{(?=let [^{}]{0,180}?await this\.platformPath\(\),[^{}]{0,180}?\(0,[A-Za-z_$][\w$]*\.watch\)\(this\.getFileSystemPath\(\k<options>\.path\),\{recursive:\k<options>\.recursive\})/gu;

function patchWorkerSource(source) {
  const markerCount = source.split(PATCH_MARKER).length - 1;
  if (markerCount === 1) {
    return { source, matched: 1, changed: 0, reason: null };
  }
  if (markerCount !== 0) {
    return {
      source,
      matched: 0,
      changed: 0,
      reason: `Found ${markerCount} shallow repository-watch markers`,
    };
  }

  LOCAL_FILE_WATCH_METHOD.lastIndex = 0;
  const matches = [...source.matchAll(LOCAL_FILE_WATCH_METHOD)];
  if (matches.length !== 1) {
    return {
      source,
      matched: 0,
      changed: 0,
      reason: `Found ${matches.length} local startFileWatch implementations`,
    };
  }

  const match = matches[0];
  const optionsName = match.groups.options;
  const branch =
    `if(process.platform===\`linux\`&&${optionsName}.recursive){` +
    `/*${PATCH_MARKER}*/` +
    `${optionsName}={...${optionsName},recursive:!1}}`;
  const methodStart = match.index + match[0].length;
  return {
    source: source.slice(0, methodStart) + branch + source.slice(methodStart),
    matched: 1,
    changed: 1,
    reason: null,
  };
}

function findLocalFileWatchBundle(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    return { target: null, result: null, reason: ".vite/build directory not found" };
  }

  const bundlePaths = fs.readdirSync(buildDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(buildDir, entry.name))
    .sort();
  const patched = [];
  const raw = [];

  for (const bundlePath of bundlePaths) {
    const source = fs.readFileSync(bundlePath, "utf8");
    const markerCount = source.split(PATCH_MARKER).length - 1;
    if (markerCount > 0) {
      patched.push({ bundlePath, result: patchWorkerSource(source) });
      continue;
    }
    LOCAL_FILE_WATCH_METHOD.lastIndex = 0;
    const matches = [...source.matchAll(LOCAL_FILE_WATCH_METHOD)].length;
    if (matches > 0) raw.push({ bundlePath, matches, source });
  }

  if (patched.length > 0) {
    if (patched.length !== 1 || raw.length !== 0) {
      return {
        target: null,
        result: null,
        reason:
          `Found shallow-watch markers in ${patched.length} bundles and ` +
          `${raw.length} unpatched bundles`,
      };
    }
    return {
      target: patched[0].bundlePath,
      result: patched[0].result,
      reason: patched[0].result.reason,
    };
  }

  const rawMatchCount = raw.reduce((total, candidate) => total + candidate.matches, 0);
  if (raw.length !== 1 || rawMatchCount !== 1) {
    return {
      target: null,
      result: null,
      reason:
        `Found ${rawMatchCount} local startFileWatch implementations across ` +
        `${bundlePaths.length} build bundles`,
    };
  }
  const result = patchWorkerSource(raw[0].source);
  return { target: raw[0].bundlePath, result, reason: result.reason };
}

function patchWorker(extractedDir) {
  const discovery = findLocalFileWatchBundle(extractedDir);
  if (discovery.target == null || discovery.result?.matched !== 1) {
    const reason = discovery.reason ?? "Local startFileWatch implementation not found";
    console.warn(`WARN: ${reason} - skipping shallow repository-watch feature`);
    return { matched: discovery.result?.matched ?? 0, changed: 0, reason };
  }
  const result = discovery.result;
  if (result.changed === 1) fs.writeFileSync(discovery.target, result.source, "utf8");
  return {
    matched: result.matched,
    changed: result.changed,
    reason: result.reason,
    target: path.relative(extractedDir, discovery.target),
  };
}

const descriptors = [
  {
    id: "local-file-watch",
    phase: "extracted-app:pre-webview",
    order: 20_935,
    ciPolicy: "optional",
    apply: patchWorker,
    status: (result, warnings) => {
      if (result?.matched !== 1) {
        return { status: "skipped-optional", reason: result?.reason ?? warnings[0] ?? null };
      }
      return result.changed === 1 ? "applied" : "already-applied";
    },
  },
];

module.exports = {
  LOCAL_FILE_WATCH_METHOD,
  PATCH_MARKER,
  descriptors,
  findLocalFileWatchBundle,
  patchWorker,
  patchWorkerSource,
};
