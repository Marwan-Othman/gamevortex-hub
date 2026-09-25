import { spawnSync } from 'node:child_process';

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npx', ['prisma', 'migrate', 'deploy']);
run('node', ['scripts/seed-production.mjs']);
run('npm', ['start']);
