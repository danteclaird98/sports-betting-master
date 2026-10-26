# Contributing together

Start with [COLLABORATION.md](docs/COLLABORATION.md). The workflow is a team convention; this change does not enforce GitHub branch rules or connect anybody's account.

## One small task, one branch
1. Check current main and open/merged PRs for overlapping work.
2. Open a collaboration-task issue or agree on a bounded task in an existing issue. Name one owner and reviewer, affected files, acceptance checks and dependencies.
3. In a clean checkout: `git fetch origin`, `git switch main`, `git pull --ff-only`, then `git switch -c collab/<handle>/<short-task>`. If another task is using the checkout, use a separate clone/worktree instead. Never discard uncommitted work to make these commands succeed.
4. Use your own Codex/ChatGPT session and GitHub identity. Keep other contributors' edits out of your task branch.
5. Commit focused changes and push your branch. Open a draft PR against main with the provided template. The other collaborator reviews; resolve comments and rerun affected checks.
6. An authorized maintainer decides when to merge. Fetch updated main before starting the next task. Deployment is a separate decision.

## Local checks matching current CI

Use Node 24 and Python 3.12. From the repository root:

```sh
npm ci --no-audit --no-fund
python3 -m pip install -r requirements-test.txt
npm run verify:sources
npm run build
npm run test:node
npm run test:models
python3 -m pytest -q
node --check web/app.js
```

Use an isolated Python virtual environment where needed. The Validate workflow also runs a checksum-verified Gitleaks scan with secret values redacted. Review both `test` and `secrets` jobs for the exact PR head; a successful earlier commit is not validation of a later edit. This guide lists the current commands, but [the workflow](.github/workflows/test.yml) is authoritative if they change. `npm test` uses unittest discovery and is not a replacement for all the workflow checks above.

For documentation-only work, verify relative links, template syntax, instructions and the changed-file scope; still check the PR workflow. Document local checks that could not run. Do not use production credentials or paid providers to validate collaboration documentation.

## Review and conflicts
- Review correctness, data integrity, scope, tests, provenance and security, not just style.
- If two PRs touch the same contract or file, agree on merge order and an integrator before rebasing or resolving conflicts. Never assume a still-open PR contains unmerged work.
- Do not resolve review threads without checking the current code. If review capacity is exhausted, use the other human or an available independent reviewer; do not purchase quota automatically.
- Do not add CODEOWNERS entries until the collaborators' actual GitHub usernames and desired responsibilities are confirmed.
