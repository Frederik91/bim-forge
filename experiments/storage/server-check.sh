#!/usr/bin/env bash
# Invoke inside the coordinator's server container, with a real Git checkout at /work.
set -euo pipefail
: "${QVM_EXECUTION_LEASE:?coordinator lease required}"
: "${DATABASE_URL:?isolated PostgreSQL URL required}"
cd /work
test -d .git
test -d /app/node_modules
test -d /deps
test -d /evidence
if test ! -e node_modules; then ln -s /app/node_modules node_modules; fi
cp experiments/storage/package.json /deps/package.json
npm install --prefix /deps --ignore-scripts --no-audit --no-fund 2>&1 | tee /evidence/dependency-install.log
if test ! -e experiments/storage/node_modules; then ln -s /deps/node_modules experiments/storage/node_modules; fi
git rev-parse HEAD | tee /evidence/source-commit.txt
node --version | tee /evidence/node-version.txt
npm ls --prefix /deps --all --json > /evidence/dependency-tree.json
cp /deps/package-lock.json /evidence/dependency-lock.json
sha256sum experiments/storage/schema.sql /evidence/dependency-lock.json > /evidence/source-hashes.txt
npm run validate 2>&1 | tee /evidence/root-validate.log
npm --prefix experiments/storage run typecheck 2>&1 | tee /evidence/storage-typecheck.log
npm --prefix experiments/storage test 2>&1 | tee /evidence/storage-tests.log
node experiments/storage/cli.ts metrics > /evidence/database-metrics.json
