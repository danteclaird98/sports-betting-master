#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
repository='danteclaird98/EdgeFusion'
expected_url="https://github.com/${repository}.git"

if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit local changes before publishing.' >&2
  exit 1
fi
if ! account="$(gh api user --jq .login)"; then
  echo 'Cannot reach the authenticated GitHub API. Allow api.github.com in the environment network settings; then retry. If GitHub returns 401 after network access works, configure GitHub CLI authentication.' >&2
  exit 1
fi
if [[ "$account" != 'danteclaird98' ]]; then
  echo 'Authenticated account does not match danteclaird98; stopping.' >&2
  exit 1
fi
if ! gh repo view "$repository" --json nameWithOwner >/dev/null 2>&1; then
  gh repo create "$repository" --private --description 'Standalone sports odds research, price comparison and wager tracking'
fi
remote_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "$remote_url" ]]; then
  git remote add origin "$expected_url"
elif [[ "$remote_url" != "$expected_url" ]]; then
  echo 'Origin points elsewhere; stopping without changing it.' >&2
  exit 1
fi
# Ordinary push only: divergent remote history is never overwritten.
git push --set-upstream origin main
remote_sha="$(git ls-remote origin refs/heads/main | cut -f1)"
local_sha="$(git rev-parse HEAD)"
if [[ "$remote_sha" != "$local_sha" ]]; then
  echo 'Published branch does not match the local commit.' >&2
  exit 1
fi
printf 'Published and verified: https://github.com/%s\n' "$repository"
