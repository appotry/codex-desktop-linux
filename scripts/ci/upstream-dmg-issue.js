"use strict";

const LABEL = "upstream-dmg-drift";
const FINGERPRINT_PATTERN = /<!-- upstream-dmg-fingerprint:([a-f0-9]{64}) -->/i;

function fingerprintMarker(fingerprint) {
  return `<!-- upstream-dmg-fingerprint:${fingerprint} -->`;
}

function runMarker(runId) {
  return `<!-- upstream-dmg-run:${runId ?? "local"} -->`;
}

function issueFingerprint(issue) {
  return issue.body?.match(FINGERPRINT_PATTERN)?.[1]?.toLowerCase() ?? null;
}

function issueTitle(decision) {
  const version = decision.dmg.appVersion ?? "unknown version";
  return `Upstream DMG drift: ${version} (${decision.dmg.sha256.slice(0, 12)})`;
}

function issueBody(decision) {
  const runUrl = decision.run.url;
  const lines = [
    fingerprintMarker(decision.dmg.sha256),
    runMarker(decision.run.id),
    "The latest upstream DMG was rejected by the shared local/CI acceptance profile.",
    "",
    "## Candidate",
    "",
    `- App version: \`${decision.dmg.appVersion ?? "unknown"}\``,
    `- SHA-256: \`${decision.dmg.sha256}\``,
    `- Workflow run: ${runUrl ? `[open run](${runUrl})` : "unknown"}`,
    "",
    "## Blocking checks",
    "",
    ...decision.blockers.map((item) => `- **${item.check}**: ${item.reason}`),
    "",
    "## Maintainer checklist",
    "",
    "1. Download the exact DMG fingerprint shown above and reproduce the acceptance report locally.",
    "2. Update only current-DMG patch shapes; remove obsolete drift workarounds in the same change.",
    "3. Keep optional patches fail-soft and run the local release profile before opening a fix PR.",
  ];
  return `${lines.join("\n")}\n`;
}

async function listTrackingIssues(github, repo) {
  const params = { ...repo, state: "all", labels: LABEL, per_page: 100 };
  const issues = github.paginate
    ? await github.paginate(github.rest.issues.listForRepo, params)
    : (await github.rest.issues.listForRepo(params)).data;
  // The label is public repository metadata and may also be useful on a
  // maintainer-created issue. Only the hidden fingerprint marker proves that
  // this automation owns an issue and may mutate its lifecycle.
  return issues.filter((issue) => issue.pull_request == null && issueFingerprint(issue) !== null);
}

async function ensureLabel(github, repo) {
  try {
    await github.rest.issues.getLabel({ ...repo, name: LABEL });
  } catch (error) {
    if (error?.status !== 404) throw error;
    await github.rest.issues.createLabel({
      ...repo,
      name: LABEL,
      color: "d93f0b",
      description: "Current upstream DMG failed the shared acceptance profile",
    });
  }
}

async function closeIssue(github, repo, issue, message, stateReason) {
  await github.rest.issues.createComment({ ...repo, issue_number: issue.number, body: message });
  await github.rest.issues.update({
    ...repo,
    issue_number: issue.number,
    state: "closed",
    state_reason: stateReason,
  });
}

async function reconcileUpstreamDmgIssue({ github, repo, decision, currentHttpIdentityKey }) {
  if (decision.verdict === "inconclusive") {
    return { action: "ignored-inconclusive" };
  }
  if (typeof decision.dmg?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(decision.dmg.sha256)) {
    return { action: "ignored-missing-fingerprint" };
  }
  const expectedIdentity = decision.dmg.httpIdentity?.key ?? null;
  if (!expectedIdentity || !currentHttpIdentityKey) {
    return { action: "ignored-missing-http-identity" };
  }
  if (currentHttpIdentityKey !== expectedIdentity) {
    return { action: "ignored-stale-candidate" };
  }

  let issues;
  try {
    issues = await listTrackingIssues(github, repo);
  } catch (error) {
    if (error?.status === 404 && decision.verdict !== "rejected") {
      return { action: "no-tracking-label" };
    }
    throw error;
  }

  if (decision.verdict === "accepted" || decision.verdict === "accepted_with_warnings") {
    const openIssues = issues.filter((issue) => issue.state === "open");
    for (const issue of openIssues) {
      await closeIssue(
        github,
        repo,
        issue,
        `Superseded by accepted upstream DMG \`${decision.dmg.sha256.slice(0, 12)}\`.`,
        "completed",
      );
    }
    return { action: "closed-resolved", count: openIssues.length };
  }

  await ensureLabel(github, repo);
  const fingerprint = decision.dmg.sha256.toLowerCase();
  const matching = issues.find((issue) => issueFingerprint(issue) === fingerprint);
  const obsolete = issues.filter((issue) => issue.state === "open" && issueFingerprint(issue) !== fingerprint);
  for (const issue of obsolete) {
    await closeIssue(
      github,
      repo,
      issue,
      `Superseded by newer rejected upstream DMG \`${fingerprint.slice(0, 12)}\`.`,
      "not_planned",
    );
  }

  const title = issueTitle(decision);
  const body = issueBody(decision);
  if (matching) {
    const wasOpen = matching.state === "open";
    const alreadyReported = matching.body?.includes(runMarker(decision.run.id));
    await github.rest.issues.update({
      ...repo,
      issue_number: matching.number,
      title,
      body,
      state: "open",
    });
    if (!alreadyReported) {
      await github.rest.issues.createComment({
        ...repo,
        issue_number: matching.number,
        body: `Acceptance failed again. ${decision.run.url ?? "See the latest workflow artifacts."}`,
      });
    }
    return { action: wasOpen ? "updated" : "reopened", issueNumber: matching.number };
  }

  const created = await github.rest.issues.create({ ...repo, title, body, labels: [LABEL] });
  return { action: "created", issueNumber: created.data.number };
}

module.exports = {
  LABEL,
  fingerprintMarker,
  issueBody,
  issueFingerprint,
  reconcileUpstreamDmgIssue,
  runMarker,
};
