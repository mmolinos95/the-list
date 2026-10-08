#!/bin/sh
# Deploy the last commit to production with the Vercel CLI.
#
# Vercel's free plan won't build a private repo owned by a GitHub organization,
# and blocks commits with co-authors who aren't on the Vercel team. So this
# deploys a clean copy of the committed code, without its Git history.
set -e

[ -d .vercel ] || { echo "Run 'npx vercel link' first (log in with the club account)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first: this deploys the last commit."; exit 1; }

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
git archive HEAD | tar -x -C "$dir"
cp -R .vercel "$dir/"
cd "$dir" && npx vercel deploy --prod --yes
