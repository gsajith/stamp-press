#!/usr/bin/env bash
# Sets up a new git worktree. Orca runs it for every worktree it creates: the
# repo's Orca setup script is the one line `bash scripts/worktree-setup.sh`.
set -euo pipefail

# The main checkout holds .env.local. Orca names it; plain git worktrees fall back to git.
root="${ORCA_ROOT_PATH:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"

if [ ! -f "$root/.env.local" ]; then
  echo "worktree-setup: no .env.local in $root. Run 'vercel env pull .env.local' there." >&2
  exit 1
fi
ln -sfn "$root/.env.local" .env.local
# Link the Vercel project too, so `vercel env ls` works here.
[ -d "$root/.vercel" ] && ln -sfn "$root/.vercel" .vercel

npm install
