#!/usr/bin/env bash
set -euo pipefail

stage="$(cat .github/fixtures/.fixture-stage)"
if [[ "$stage" -ge 4 ]]; then
  echo "Fixture history is complete at stage $stage."
  exit 0
fi

next=$((stage + 1))
case "$next" in
  2)
    author_name="Jordan Fixture"
    author_email="jordan.fixture@example.invalid"
    commit_date="2026-07-02T09:30:00Z"
    commit_message="Add checkout and notification fixture tests"
    ;;
  3)
    author_name="Riley Fixture"
    author_email="riley.fixture@example.invalid"
    commit_date="2026-07-09T11:45:00Z"
    commit_message="Add search locale and auth fixture tests"
    ;;
  4)
    author_name="Avery Fixture"
    author_email="avery.fixture@example.invalid"
    commit_date="2026-07-17T08:20:00Z"
    commit_message="Add cart trace-loss fixture test"
    ;;
esac

git apply ".github/fixtures/stage${next}.patch"
cp ".github/fixtures/plans/stage${next}.json" .github/fixtures/run-plan.json
printf '%s\n' "$next" > .github/fixtures/.fixture-stage
git add tests/e2e .github/fixtures/run-plan.json .github/fixtures/.fixture-stage

GIT_AUTHOR_DATE="$commit_date" \
GIT_COMMITTER_DATE="$commit_date" \
git -c user.name="$author_name" -c user.email="$author_email" \
  commit --author="$author_name <$author_email>" -m "$commit_message"
git push origin HEAD:main

