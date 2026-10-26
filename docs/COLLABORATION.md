# Sports Betting Master: two-person collaboration

## The shared workspace
GitHub is the shared record. Each person keeps their own ChatGPT/Codex account and session, but works against this same repository. Sharing GitHub access does not automatically share private ChatGPT conversations, Codex sessions, credentials or account configuration.

The repeatable loop is:
**Agree on a task → separate branch → Codex work → draft PR → other person reviews → authorized merge → both refresh main.**

## What each person does once
1. Confirm their own GitHub account can access this repository. Do not exchange accounts, tokens or API keys.
2. In their own Codex setup, select this repository if already available. If not, complete that account's supported GitHub connection/repository-access flow themselves. For local Codex, open a separate local checkout of this repository.
3. Select the task branch/worktree, not an uncoordinated shared checkout. Confirm the branch before asking an agent to edit.
4. Open this guide and AGENTS.md from the same branch. Changes in a draft PR are not installed on main until an authorized merge.
5. Agree on who reviews and who may merge. Neither an AI response nor a green check constitutes the other person's approval.

Account connection and collaborator access must be verified individually; repository files cannot perform those steps for someone else.

## Keep context moving between chats
Put the following in the issue or PR, then paste its link into the next person's chat:
- Goal and acceptance criteria.
- Owner, reviewer, branch and exact base/head commits.
- Owned files and interfaces that must not change.
- Decisions, source links and reasons.
- Commands run and results, including skipped/blocked checks.
- Open questions and the next owner's concrete action.

Do not paste private conversations or secrets just to share progress. A concise task handoff is enough.

## Ready-to-use task prompt
```text
Work in danteclaird98/sports-betting-master on the branch for linked issue <URL>.
Read AGENTS.md and CONTRIBUTING.md, inspect current main and relevant PRs first.
Goal: <one outcome>. Owner: <GitHub handle>. Reviewer: <other handle>.
Owned files: <exact files/directories>. Do not edit: <other owner's files>.
Dependencies/contracts: <links and agreed behavior>.
Acceptance checks: <specific tests or observable results>.
Preserve unrelated work. Do not merge, deploy or change credentials.
Finish with a draft PR when authorized and a handoff listing final commit,
changed files, validation results, remaining gaps and next action.
```

## Suggested initial split (agree before claiming)
- Person A: UI acceptance review and isolated frontend improvements. Avoid backend/runtime edits; agree on the response contract first.
- Person B: data/runtime correctness and targeted tests. Avoid frontend edits; agree on the same contract first.
- Shared integrator: contract changes, package files, workflow files and cross-cutting tests. Only one person edits these at a time.
- Swap reviewer roles so neither person is the sole author and reviewer of a change.

These are suggested lanes, not assignments to an unidentified friend.

## Current integration caution
Snapshot checked October 26, 2026; recheck before acting:
- PR #13 merged integration work described as including #10–12. PR #8 merged overlapping workflow-parity work. Old open branches may therefore be superseded or only partly outstanding.
- PR #15 proposes revision/idempotency ledger work. Review its current status and authenticated gateway test coverage before starting competing ledger changes.
- Historical coordinator documents can describe older pending states. Use current merged metadata plus actual residual diffs, not titles or old prose, to decide what remains.
- A source import, passing test or UI screenshot is not proof of deployment, provider access or signed-in end-to-end parity.

## Optional safeguards, not enabled by this setup
After both collaborators agree, consider a main-branch ruleset requiring PRs, one independent collaborator approval and the current Validate checks, with an explicitly agreed maintainer/bypass policy. Confirm exact check names and repository-plan availability first. This setup does not change permissions, branch rules, account connections, secrets, deployment or production data.

## First session together
Choose one small nonoverlapping task each, fill in the issue template, agree on contracts, then open two draft PRs. Review each other's diff and checks before asking the authorized maintainer to merge. Keep unfinished work in draft, and keep merge/deployment decisions explicit.
