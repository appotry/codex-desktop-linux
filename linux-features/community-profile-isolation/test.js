"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadEnabledLinuxFeatures } = require("../../scripts/lib/linux-features.js");

const featureDir = __dirname;
const featuresRoot = path.resolve(featureDir, "..");
const launcherTemplate = path.resolve(featureDir, "../../launcher/start.sh.template");
const wrapperSource = path.join(featureDir, "codex-cli-wrapper.sh");
const envSource = path.join(featureDir, "env.sh");
const launcherHookSource = path.join(featureDir, "launcher-hook.sh");
const manifest = require("./feature.json");

function writeExecutable(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o755 });
}

function makeFakeApp(root) {
  const app = path.join(root, "community");
  const wrapper = path.join(
    app,
    ".codex-linux",
    "features",
    "community-profile-isolation",
    "codex-cli-wrapper.sh",
  );
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.copyFileSync(wrapperSource, wrapper);
  fs.chmodSync(wrapper, 0o755);
  return { app, wrapper };
}

test("manifest stages the wrapper and rejects shared app-server socket", () => {
  assert.deepEqual(manifest.conflicts, ["shared-app-server-socket"]);
  assert.deepEqual(manifest.resources, [
    {
      source: "codex-cli-wrapper.sh",
      target: ".codex-linux/features/community-profile-isolation/codex-cli-wrapper.sh",
      mode: "0755",
    },
  ]);

  assert.throws(
    () => loadEnabledLinuxFeatures({
      featuresRoot,
      enabledFeatureIds: [
        "community-profile-isolation",
        "shared-app-server-socket",
      ],
    }),
    /community-profile-isolation.*conflicts with.*shared-app-server-socket/i,
  );
});

test("environment hook pins Community state and bare codex resolution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-env-"));
  try {
    const home = path.join(root, "home");
    const app = path.join(root, "community");
    const officialBin = path.join(root, "official-bin");
    const communityCodex = path.join(app, "resources", "codex");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(path.dirname(communityCodex), { recursive: true });
    fs.mkdirSync(officialBin, { recursive: true });
    writeExecutable(communityCodex, ["#!/bin/sh", "exit 0"]);
    writeExecutable(path.join(officialBin, "codex"), ["#!/bin/sh", "exit 0"]);

    const output = childProcess.execFileSync(
      "bash",
      [
        "-c",
        '. "$1"; command -v codex; printf "%s\\n" "$CODEX_HOME"; printf "%s\\n" "$PATH"',
        "_",
        envSource,
      ],
      {
        encoding: "utf8",
        env: {
          HOME: home,
          CODEX_LINUX_APP_DIR: app,
          PATH: officialBin + ":/usr/bin:/bin",
        },
      },
    ).trim().split("\n");

    assert.equal(output[0], communityCodex);
    assert.equal(output[1], path.join(home, ".codex-community"));
    assert.equal(output[2].split(":")[0], path.join(app, "resources"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher exports upstream Electron profile contract and CLI wrapper", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-launcher-"));
  try {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    const fake = makeFakeApp(root);
    const canonical = path.join(home, ".config", "Codex-Community");

    const output = childProcess.execFileSync(
      launcherHookSource,
      ["--class=codex-desktop"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          CODEX_LINUX_APP_DIR: fake.app,
        },
      },
    ).trim().split("\n");

    assert.deepEqual(output, [
      "env CODEX_ELECTRON_USER_DATA_PATH=" + canonical,
      "env CODEX_CLI_PATH=" + fake.wrapper,
      "electron-arg --user-data-dir=" + canonical,
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher fails closed for conflicting Electron profiles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-conflict-"));
  try {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    const fake = makeFakeApp(root);

    const envConflict = childProcess.spawnSync(launcherHookSource, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_LINUX_APP_DIR: fake.app,
        CODEX_ELECTRON_USER_DATA_PATH: "/tmp/not-community",
      },
    });
    assert.equal(envConflict.status, 64);
    assert.match(envConflict.stderr, /refuses non-canonical CODEX_ELECTRON_USER_DATA_PATH/);

    const argConflict = childProcess.spawnSync(
      launcherHookSource,
      ["--user-data-dir=/tmp/not-community"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          CODEX_LINUX_APP_DIR: fake.app,
        },
      },
    );
    assert.equal(argConflict.status, 64);
    assert.match(argConflict.stderr, /refuses non-canonical --user-data-dir/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher fails closed when Community CLI wrapper is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-missing-"));
  try {
    const home = path.join(root, "home");
    const app = path.join(root, "community");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(app, { recursive: true });

    const result = childProcess.spawnSync(launcherHookSource, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_LINUX_APP_DIR: app,
      },
    });
    assert.equal(result.status, 69);
    assert.match(result.stderr, /CLI isolation wrapper is missing or not executable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wrapper repairs runtime PATH and pins child PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-wrapper-"));
  try {
    const home = path.join(root, "home");
    const officialBin = path.join(home, ".local", "bin");
    const runtimeOverride = path.join(root, "runtime", "override");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(officialBin, { recursive: true });
    fs.mkdirSync(runtimeOverride, { recursive: true });

    const fake = makeFakeApp(root);
    const communityBin = path.join(fake.app, "resources");
    const communityCodex = path.join(communityBin, "codex");
    fs.mkdirSync(communityBin, { recursive: true });
    writeExecutable(path.join(officialBin, "codex"), ["#!/bin/sh", "exit 0"]);
    writeExecutable(communityCodex, [
      "#!/usr/bin/env bash",
      'printf "PATH=%s\\n" "$PATH"',
      'printf "RESOLVED=%s\\n" "$(command -v codex)"',
      'for arg in "$@"; do printf "ARG=%s\\n" "$arg"; done',
    ]);

    const brokenPath = [
      runtimeOverride,
      officialBin,
      communityBin,
      "/usr/bin",
      "/bin",
    ].join(":");

    const output = childProcess.execFileSync(
      fake.wrapper,
      ["-c", "features.code_mode_host=true", "app-server", "--remote-control"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          CODEX_HOME: path.join(home, ".codex-community"),
          CODEX_LINUX_APP_DIR: fake.app,
          PATH: brokenPath,
        },
      },
    ).trim().split("\n");

    const expectedPath = communityBin + ":" + brokenPath;
    assert.equal(output[0], "PATH=" + expectedPath);
    assert.equal(output[1], "RESOLVED=" + communityCodex);
    assert.deepEqual(output.slice(2), [
      "ARG=-c",
      "ARG=shell_environment_policy.set.PATH=" + expectedPath,
      "ARG=-c",
      "ARG=features.code_mode_host=true",
      "ARG=app-server",
      "ARG=--remote-control",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wrapper accepts launcher-canonicalized symlinked Community home", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-symlink-"));
  try {
    const home = path.join(root, "home");
    const physical = path.join(root, "physical-codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(physical, { recursive: true });
    fs.symlinkSync(physical, path.join(home, ".codex-community"));

    const fake = makeFakeApp(root);
    fs.mkdirSync(path.join(fake.app, "resources"), { recursive: true });
    writeExecutable(path.join(fake.app, "resources", "codex"), [
      "#!/bin/sh",
      'printf "%s\\n" "$CODEX_HOME"',
    ]);

    const output = childProcess.execFileSync(fake.wrapper, ["--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: physical,
        CODEX_LINUX_APP_DIR: fake.app,
        PATH: "/usr/bin:/bin",
      },
    }).trim();

    assert.equal(output, physical);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real launcher canonicalizes symlinked state before invoking wrapper", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-full-launch-"));
  try {
    const home = path.join(root, "home");
    const physical = path.join(root, "physical-codex-home");
    const app = path.join(root, "community");
    const hookRoot = path.join(app, ".codex-linux");
    const wrapper = path.join(
      hookRoot,
      "features",
      "community-profile-isolation",
      "codex-cli-wrapper.sh",
    );
    const launcher = path.join(app, "codex-desktop");

    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(physical, { recursive: true });
    fs.symlinkSync(physical, path.join(home, ".codex-community"));
    fs.mkdirSync(path.join(hookRoot, "env.d"), { recursive: true });
    fs.mkdirSync(path.join(hookRoot, "launcher.d"), { recursive: true });
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.mkdirSync(path.join(app, "resources"), { recursive: true });

    fs.copyFileSync(launcherTemplate, launcher);
    fs.chmodSync(launcher, 0o755);
    fs.copyFileSync(envSource, path.join(hookRoot, "env.d", "community-profile-isolation.env"));
    fs.copyFileSync(
      launcherHookSource,
      path.join(hookRoot, "launcher.d", "community-profile-isolation.sh"),
    );
    fs.chmodSync(path.join(hookRoot, "launcher.d", "community-profile-isolation.sh"), 0o755);
    fs.copyFileSync(wrapperSource, wrapper);
    fs.chmodSync(wrapper, 0o755);

    writeExecutable(path.join(app, "resources", "codex"), [
      "#!/usr/bin/env bash",
      'printf "WRAPPER_CODEX_HOME=%s\\n" "$CODEX_HOME"',
      'printf "WRAPPER_RESOLVED=%s\\n" "$(command -v codex)"',
      'for arg in "$@"; do printf "WRAPPER_ARG=%s\\n" "$arg"; done',
    ]);
    writeExecutable(path.join(app, "ChatGPT"), [
      "#!/usr/bin/env bash",
      'printf "CHATGPT_CODEX_HOME=%s\\n" "$CODEX_HOME"',
      'printf "CHATGPT_ELECTRON_USER_DATA=%s\\n" "$CODEX_ELECTRON_USER_DATA_PATH"',
      'printf "CHATGPT_CLI_PATH=%s\\n" "$CODEX_CLI_PATH"',
      'for arg in "$@"; do printf "CHATGPT_ARG=%s\\n" "$arg"; done',
      '"$CODEX_CLI_PATH" app-server',
    ]);

    const output = childProcess.execFileSync(launcher, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: "/usr/bin:/bin",
        CODEX_LINUX_APP_ID: "codex-desktop",
        CODEX_LINUX_APP_DISPLAY_NAME: "ChatGPT Community",
        CODEX_LINUX_DISABLE_USAGE_REPORTING: "1",
        XDG_SESSION_TYPE: "x11",
      },
    });

    assert.equal(output.includes("CHATGPT_CODEX_HOME=" + physical), true);
    assert.equal(
      output.includes(
        "CHATGPT_ELECTRON_USER_DATA=" + path.join(home, ".config", "Codex-Community"),
      ),
      true,
    );
    assert.equal(output.includes("CHATGPT_ARG=--user-data-dir="), true);
    assert.equal(output.includes("WRAPPER_CODEX_HOME=" + physical), true);
    assert.equal(output.includes("WRAPPER_ARG=app-server"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wrapper refuses a non-Community CODEX_HOME", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-isolation-wrong-home-"));
  try {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    const fake = makeFakeApp(root);
    fs.mkdirSync(path.join(fake.app, "resources"), { recursive: true });
    writeExecutable(path.join(fake.app, "resources", "codex"), ["#!/bin/sh", "exit 0"]);

    const result = childProcess.spawnSync(fake.wrapper, ["--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        CODEX_LINUX_APP_DIR: fake.app,
        PATH: "/usr/bin:/bin",
      },
    });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /refuses CODEX_HOME=/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function signedBootstrapContexts(root) {
  const contexts = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.isFile() || !/\.(?:c?js|mjs)$/.test(entry.name)) continue;
      const stat = fs.statSync(file);
      if (stat.size > 50 * 1024 * 1024) continue;
      const source = fs.readFileSync(file, "utf8");
      let index = source.indexOf("CODEX_ELECTRON_USER_DATA_PATH");
      while (index >= 0) {
        contexts.push(source.slice(Math.max(0, index - 4000), index + 4000));
        index = source.indexOf("CODEX_ELECTRON_USER_DATA_PATH", index + 1);
      }
    }
  }
  walk(root);
  return contexts;
}

test(
  "signed upstream bootstrap keeps CODEX_ELECTRON_USER_DATA_PATH tied to userData",
  { skip: process.env.CODEX_SIGNED_EXTRACTED_APP == null },
  () => {
    const root = process.env.CODEX_SIGNED_EXTRACTED_APP;
    assert.equal(fs.statSync(root).isDirectory(), true);
    const contexts = signedBootstrapContexts(root);
    assert.ok(
      contexts.length > 0,
      "signed bootstrap no longer exposes CODEX_ELECTRON_USER_DATA_PATH",
    );
    assert.ok(
      contexts.some((context) => /userData/.test(context)),
      "signed bootstrap no longer associates CODEX_ELECTRON_USER_DATA_PATH with Electron userData",
    );
  },
);
