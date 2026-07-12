#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const patcher = path.join(__dirname, "patch-chrome-plugin.js");

test("keeps current browser preference routing and patches the current Chrome skill", () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chrome-plugin-current-"));
  const scriptsDir = path.join(pluginDir, "scripts");
  const skillDir = path.join(pluginDir, "skills", "control-chrome");
  const browserClient = [
    "const browserPreference = {};",
    "function preferredWindowIdFor() {}",
    "function getForUrl() {}",
    "const extensionInstanceId = null;",
  ].join("\n");

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, "browser-client.mjs"),
      browserClient,
      "utf8",
    );
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "Use the browser bound to `browser` for tasks in this skill.\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [patcher, pluginDir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(path.join(scriptsDir, "browser-client.mjs"), "utf8"),
      browserClient,
    );
    assert.doesNotMatch(result.stdout, /browser-client\.mjs skipped:/);
    assert.doesNotMatch(result.stderr, /browser-client\.mjs missing patch target/);

    const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    assert.match(skill, /agent\.browsers\.list\(\)/);
    assert.match(skill, /browser\.tabs\.new\(\)/);
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});
