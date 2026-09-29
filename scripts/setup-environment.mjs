import fs from 'node:fs';
import crypto from 'node:crypto';

const envPath = '.env.local';
if (!fs.existsSync(envPath)) {
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(envPath, [
    'DATABASE_URL="postgresql://gamevortex:gamevortex_password@localhost:5432/gamevortex"',
    `AUTH_SECRET="${secret}"`,
    'APP_ORIGIN="http://localhost:3000"',
    'RATE_LIMIT_STORE="memory"',
    'OWNER_WITHDRAWAL_ENABLED="false"',
    'PAYMENT_PROVIDER=""',
    'PAYMENT_WEBHOOK_SECRET=""',
    ''
  ].join('\n'), { flag: 'wx' });
  console.log('Created .env.local with a random AUTH_SECRET.');
} else {
  console.log('.env.local already exists; leaving it unchanged.');
}
console.log('Next: docker compose up -d postgres');
console.log('Then: npm run db:migrate && npm run production:validate');
