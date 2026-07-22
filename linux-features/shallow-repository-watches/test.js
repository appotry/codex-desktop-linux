#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  loadLinuxFeaturePatchDescriptors,
} = require("../../scripts/lib/linux-features.js");
const {
  PATCH_MARKER,
  descriptors,
  findLocalFileWatchBundle,
  patchWorker,
  patchWorkerSource,
} = require("./patch.js");

function localWorkerSource() {
  return [
    "var LocalHost=class{",
    "async platformPath(){return E.default.posix}",
    "async startFileWatch(e){let t=jH(),n=!1,r=await this.platformPath(),",
    "i=(0,w.watch)(this.getFileSystemPath(e.path),{recursive:e.recursive},()=>{});",
    "return{coverage:{recursive:e.recursive},path:e.path,closed:t.promise}}",
    "};",
  ].join("");
}

function withFeatureConfig(enabled, callback) {
  const original = process.env.CODEX_LINUX_FEATURES_CONFIG;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-shallow-watch-config-"));
  process.env.CODEX_LINUX_FEATURES_CONFIG = path.join(tempDir, "features.json");
  try {
    fs.writeFileSync(process.env.CODEX_LINUX_FEATURES_CONFIG, JSON.stringify({ enabled }));
    return callback();
  } finally {
    if (original == null) delete process.env.CODEX_LINUX_FEATURES_CONFIG;
    else process.env.CODEX_LINUX_FEATURES_CONFIG = original;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function instantiate(source, platform, watchCalls) {
  const LocalHost = new Function(
    "process",
    "E",
    "jH",
    "w",
    `${source};return LocalHost;`,
  )(
    { platform },
    { default: { posix: path.posix } },
    () => ({ promise: Promise.resolve() }),
    {
      watch: (watchedPath, options) => {
        watchCalls.push({ watchedPath, options });
        return { close() {}, on() {} };
      },
    },
  );
  const host = new LocalHost();
  host.getFileSystemPath = (value) => value;
  return host;
}

test("feature is disabled until selected and conflicts with the directory-tree strategy", () => {
  const featuresRoot = path.resolve(__dirname, "..");
  withFeatureConfig([], () => {
    assert.equal(
      loadLinuxFeaturePatchDescriptors({ featuresRoot })
        .some((descriptor) => descriptor.id === "feature:shallow-repository-watches:local-file-watch"),
      false,
    );
  });
  withFeatureConfig(["shallow-repository-watches"], () => {
    assert.equal(
      loadLinuxFeaturePatchDescriptors({ featuresRoot })
        .some((descriptor) => descriptor.id === "feature:shallow-repository-watches:local-file-watch"),
      true,
    );
  });
  assert.throws(
    () => withFeatureConfig(
      ["shallow-repository-watches", "directory-only-working-tree-watch"],
      () => loadLinuxFeaturePatchDescriptors({ featuresRoot }),
    ),
    /conflicts with 'directory-only-working-tree-watch'/,
  );
});

test("patch is idempotent and downgrades every Linux recursive request", async () => {
  const first = patchWorkerSource(localWorkerSource());
  assert.equal(first.matched, 1);
  assert.equal(first.changed, 1);
  assert.equal(first.source.split(PATCH_MARKER).length - 1, 1);
  assert.match(
    first.source,
    /process\.platform===`linux`&&e\.recursive\)\{\/\*codexLinuxShallowRepositoryWatches\*\/e=\{\.\.\.e,recursive:!1\}\}/,
  );
  const second = patchWorkerSource(first.source);
  assert.deepEqual(second, { source: first.source, matched: 1, changed: 0, reason: null });

  for (const renameEventHandling of ["changed-path", "changed-path-with-parent-directory"]) {
    const calls = [];
    const host = instantiate(first.source, "linux", calls);
    const session = await host.startFileWatch({
      path: renameEventHandling === "changed-path" ? "/repo/.git/refs" : "/repo",
      recursive: true,
      renameEventHandling,
    });
    assert.equal(calls[0].options.recursive, false);
    assert.deepEqual(session.coverage, { recursive: false });
  }
});

test("patch preserves non-recursive Linux watches and recursive watches on other platforms", async () => {
  const source = patchWorkerSource(localWorkerSource()).source;
  const linuxCalls = [];
  const linux = instantiate(source, "linux", linuxCalls);
  const linuxSession = await linux.startFileWatch({ path: "/repo", recursive: false });
  assert.equal(linuxCalls[0].options.recursive, false);
  assert.deepEqual(linuxSession.coverage, { recursive: false });

  const darwinCalls = [];
  const darwin = instantiate(source, "darwin", darwinCalls);
  const darwinSession = await darwin.startFileWatch({ path: "/repo", recursive: true });
  assert.equal(darwinCalls[0].options.recursive, true);
  assert.deepEqual(darwinSession.coverage, { recursive: true });
});

test("feature discovers and patches the current hashed build bundle shape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-shallow-watch-bundle-"));
  try {
    const buildDir = path.join(root, ".vite", "build");
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, "unrelated.js"), "var worker={startFileWatch(){}};");
    fs.writeFileSync(path.join(buildDir, "src-current.js"), localWorkerSource());

    const discovery = findLocalFileWatchBundle(root);
    assert.equal(path.basename(discovery.target), "src-current.js");
    const first = patchWorker(root);
    assert.deepEqual(first, {
      matched: 1,
      changed: 1,
      reason: null,
      target: path.join(".vite", "build", "src-current.js"),
    });
    const second = patchWorker(root);
    assert.equal(second.changed, 0);
    assert.equal(fs.readFileSync(discovery.target, "utf8").split(PATCH_MARKER).length - 1, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ambiguous or drifted local hosts remain byte-identical", () => {
  const source = `${localWorkerSource()}${localWorkerSource()}`;
  const result = patchWorkerSource(source);
  assert.equal(result.source, source);
  assert.equal(result.matched, 0);
  assert.equal(result.changed, 0);
  assert.match(result.reason, /Found 2 local startFileWatch implementations/);
  assert.equal(descriptors[0].status(result, []).status, "skipped-optional");
});
