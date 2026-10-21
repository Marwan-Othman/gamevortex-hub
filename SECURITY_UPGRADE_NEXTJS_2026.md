# Next.js security upgrade — October 2026

## Current dependency
The current `main` branch pins Next.js `16.3.6`. Upstream release notes list `16.4.1` as fixing critical unauthenticated remote-code-execution issues involving `use cache` typed-array results and image optimization with SVG, along with a high-severity Server Actions denial of service. The latest stable release identified during this audit is `16.4.2`.

Sources:
- https://github.com/vercel/next.js/releases
- https://nextjs-changelog.vercel.app/

## Upgrade policy
Do not change the application dependency or lockfile by hand with guessed package integrity values. Upgrade `next`, `@next/env`, and platform-specific `@next/swc-*` entries together using npm so that `package.json` and `package-lock.json` remain consistent.

## Required validation before deployment
1. `npm ci`
2. `npm run db:validate`
3. `npm run test:source`
4. `npm test`
5. `npm run typecheck`
6. `npm run build`
7. `npm run test:smoke`
8. Verify production deployment and key flows in preview before promoting to production.

No dependency version was changed by this audit note. This is an explicit tracked security task, not a claim that the upgrade is complete.
