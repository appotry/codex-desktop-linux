#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const patcher = path.join(__dirname, "patch-chrome-plugin.js");

test("patches current Chrome skill and profile resolvers idempotently", () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chrome-plugin-current-"));
  const scriptsDir = path.join(pluginDir, "scripts");
  const skillDir = path.join(pluginDir, "skills", "control-chrome");
  const profileScript = `function resolveChromeProfileDirectory(userDataDirectory) {
  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;

  return findLatestChromeProfile(userDataDirectory);
}

function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {
  return null;
}

function findLatestChromeProfile(userDataDirectory) {
  return "Default";
}

function isUsableChromeProfile(userDataDirectory, profileDirectory) {
  return profileDirectory.length > 0;
}
`;

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "Do not inspect browser cookies, local storage, profiles, passwords, or session stores. Browser discovery must remain read-only.\n",
      "utf8",
    );
    for (const scriptName of ["check-extension-installed.js", "open-chrome-window.js"]) {
      fs.writeFileSync(path.join(scriptsDir, scriptName), profileScript, "utf8");
    }

    const firstResult = spawnSync(process.execPath, [patcher, pluginDir], {
      encoding: "utf8",
    });
    assert.equal(firstResult.status, 0, firstResult.stderr);
    assert.equal(firstResult.stderr, "");
    assert.match(firstResult.stdout, /Patched SKILL\.md: Chrome profile launch guard/);
    assert.match(
      firstResult.stdout,
      /Patched check-extension-installed\.js: Linux running browser extension profile preference/,
    );
    assert.match(
      firstResult.stdout,
      /Patched check-extension-installed\.js: Linux running browser extension profile resolver/,
    );
    assert.match(
      firstResult.stdout,
      /Patched open-chrome-window\.js: Linux running browser profile preference/,
    );
    assert.match(
      firstResult.stdout,
      /Patched open-chrome-window\.js: Linux running browser profile resolver/,
    );

    const firstSources = new Map();
    const skillPath = path.join(skillDir, "SKILL.md");
    const patchedSkill = fs.readFileSync(skillPath, "utf8");
    assert.match(patchedSkill, /browser\.tabs\.new\(\)/);
    assert.match(patchedSkill, /start a different Chrome, Brave, or Chromium profile/);
    firstSources.set(skillPath, patchedSkill);

    for (const scriptName of ["check-extension-installed.js", "open-chrome-window.js"]) {
      const scriptPath = path.join(scriptsDir, scriptName);
      const source = fs.readFileSync(scriptPath, "utf8");
      assert.match(
        source,
        /const runningProfile =\s+resolveChromeProfileDirectoryFromRunningProcess\(userDataDirectory\);\s+if \(runningProfile\) return runningProfile;/,
      );
      assert.equal(source.match(/function linuxProcessDirectories/g)?.length, 1);

      const context = {
        fs: {
          readdirSync(directory) {
            assert.equal(directory, "/proc");
            return ["4242"];
          },
          readFileSync(filePath) {
            assert.equal(filePath, "/proc/4242/cmdline");
            return "google-chrome\0--user-data-dir=/profiles\0--profile-directory=Work\0";
          },
        },
        os: { homedir: () => "/home/test" },
        path,
        process: { platform: "linux" },
        result: null,
      };
      vm.runInNewContext(
        `${source}\nresult = resolveChromeProfileDirectory("/profiles");`,
        context,
      );
      assert.equal(context.result, "Work", `${scriptName} must prefer the running profile`);
      firstSources.set(scriptPath, source);
    }

    const secondResult = spawnSync(process.execPath, [patcher, pluginDir], {
      encoding: "utf8",
    });
    assert.equal(secondResult.status, 0, secondResult.stderr);
    assert.equal(secondResult.stderr, "");
    assert.match(secondResult.stdout, /SKILL\.md already patched: Chrome profile launch guard/);
    assert.match(secondResult.stdout, /check-extension-installed\.js already patched:/);
    assert.match(secondResult.stdout, /open-chrome-window\.js already patched:/);
    for (const [filePath, firstSource] of firstSources) {
      assert.equal(fs.readFileSync(filePath, "utf8"), firstSource);
    }
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});
