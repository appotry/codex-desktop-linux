const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");

const approvedNode24Actions = new Set([
  "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  "actions/checkout@v7",
  "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
  "actions/github-script@d746ffe35508b1917358783b479e04febd2b8f71",
  "actions/github-script@v9",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/setup-node@v7",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
]);

test("workflows use approved Node 24 first-party actions", () => {
  const workflowNames = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  const unapproved = [];
  let actionCount = 0;

  for (const workflowName of workflowNames) {
    const workflow = fs.readFileSync(
      path.join(workflowsDir, workflowName),
      "utf8",
    );
    assert.doesNotMatch(
      workflow,
      /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24/,
      `${workflowName} must not force an action onto a runtime it does not declare`,
    );

    for (const match of workflow.matchAll(
      /uses:\s*(actions\/(?:cache|checkout|download-artifact|github-script|setup-node|upload-artifact)@[^\s#]+)/g,
    )) {
      actionCount += 1;
      if (!approvedNode24Actions.has(match[1])) {
        unapproved.push(`${workflowName}: ${match[1]}`);
      }
    }
  }

  assert.ok(actionCount > 0, "expected to find first-party JavaScript actions");
  assert.deepEqual(unapproved, []);
});
