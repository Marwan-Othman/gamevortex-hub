import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) {
  const r = spawnSync(npm, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// A fresh source archive has no node_modules and may not have a lockfile.
// Generate the lockfile first, then install exactly from that lockfile before
// invoking any Prisma/Next commands. This makes bootstrap work from a clean checkout.
if (!fs.existsSync('package-lock.json')) {
  console.log('package-lock.json not found; generating it from the pinned package.json versions...');
  run(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
}

run(['ci', '--no-audit', '--no-fund']);
run(['run', 'validate:env']);
run(['run', 'production:validate']);
