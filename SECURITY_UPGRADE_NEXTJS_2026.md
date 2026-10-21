# Next.js security upgrade — October 2026

## Finding
The production branch currently pins Next.js `16.3.6`. Upstream release notes report that `16.4.1` fixes critical unauthenticated remote-code-execution issues involving `use cache` typed-array results and image optimization with SVG, as well as a high-severity Server Actions denial of service. The latest stable release identified during this audit is `16.4.2`.

Sources:
- https://github.com/vercel/next.js/releases
- https://nextjs-changelog.vercel.app/

## Required follow-up
Upgrade Next.js and its matching `@next/env` and `@next/swc-*` optional packages together using npm, preserving a fully consistent `package-lock.json`. Do not fabricate package integrity hashes or edit lock metadata by hand.

## Gate
Do not call this issue resolved until the dependency update passes `npm ci`, Prisma validation, source integrity checks, unit tests, TypeScript, production build, smoke tests, and a Vercel preview verification. This document records an unresolved security task; no dependency version was changed by the audit note.
