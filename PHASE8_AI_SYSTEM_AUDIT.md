# Phase 8 — AI System Audit

Scope: `lib/ai/*`, `app/api/ai/*`, `app/ai/*`, `components/ai/*` (chat is `AiHubClient.tsx`; there is no `AIChat.tsx`), AI credits, image, video.

## Findings fixed

| # | Area | Problem | Fix |
|---|------|---------|-----|
| 1 | Chat / credits | `executeChat` wrapped credit errors in its outer `catch`, so `AI_CREDITS_EXHAUSTED`, `AI_VIP_REQUIRED` and `AI_IDEMPOTENCY_KEY_CONFLICT` all reached the client as `AI_SERVICE_UNAVAILABLE` (503). The 402/403/409 branches in the route were dead code. | Gateway passes those codes through unchanged. |
| 2 | Chat / UI | `AiHubClient` swallowed every error into one generic message, did nothing when no conversation existed, lost the typed text on failure and never showed the balance. | Per-code messages (shared `components/ai/ai-errors.ts`), auto-create conversation, prompt restored on failure, GVC balance shown, load errors surfaced. |
| 3 | Chat / failures | After a provider failure the user message stayed in history (and blocked a same-key retry for 6 minutes). Failed attempts were never written to the usage ledger when *all* providers failed, so health/cooldown stats missed real failures. | User message removed + credits refunded + failed attempts recorded (`AiProviderError.attempts`). |
| 4 | Chat / idempotency | `GameVortexAiMessage.idempotencyKey` is unique across all users, but the key was client-chosen and unscoped: another user's identical key produced a bogus 409 and probing. | Key stored as `userId:key`; key reuse with a different prompt/conversation → 409. Keys limited to `[A-Za-z0-9._:-]{8,128}`. |
| 5 | Chat / regenerate | `regenerate` overwrote the *oldest* assistant message of the last 12 (list is newest-first). | Uses the newest assistant message. |
| 6 | Chat / history | History order/filter relied on reversing before filtering; clarified and kept oldest-first. | — |
| 7 | Post-success bookkeeping | A DB/ledger error after a successful (and paid) answer turned the reply into a 503 with credits kept. | Ledger / persistence are best-effort and logged (`logSystemError`); the answer is still returned. |
| 8 | Timeouts | Chat chain (Gemini 30 s + Manus 30 s + 240 s poll) could exceed `maxDuration=300`; image request had a 300 s timeout equal to `maxDuration` and video status/start calls had 300 s timeouts. A killed function never reaches the refund `catch`. | Chat chain deadline 240 s with abort; Manus poll 200 s; image 120 s; video start/status 30 s (`maxDuration` 60); download 240 s. |
| 9 | Provider failover | Gemini 400/404 (bad model, expired `previous_interaction_id`) did not fail over; empty answers were not treated as failures; `GEMINI_MAX_OUTPUT_TOKENS=abc` → `NaN`. | 400/404 failoverable; empty answer → `EMPTY_RESPONSE` + failover; token count validated. Image/video failures no longer put chat Gemini into cooldown. |
| 10 | Image | Option strings (`imageSize`, `aspectRatio`) were forwarded unvalidated (cost bypass: `IMAGE_COST` for an unvalidated size); `imageData` validated only after credits were taken; returned mime type trusted; no per-user limit; no ledger rows. | Whitelists, validation before reserving, mime/base64 checks, per-user rate limit, ledger rows. |
| 11 | Video / idempotency | Credit key was a fresh server UUID → double-click/retry started and charged twice. | Client `idempotencyKey` is the reservation key; replay → 409, never a second video. |
| 12 | Video / refunds | A permanently failing operation (404, malformed) kept answering `processing` forever; owners triggered a pointless refund lookup. | Permanent provider errors refund once and return `failed`; owners skipped. Status reports `refunded`. |
| 13 | Video download | `fetch(..., redirect:"follow")` would forward the custom `x-goog-api-key` header to any redirect target; no host check; advertised `Accept-Ranges` but ignored `Range`; unlimited requests. | https + `*.googleapis.com` only, manual redirects (key only to Google hosts), `Range`/206 passthrough, safe content type, rate limit. |
| 14 | Video UI | Timeout dropped the token (user paid, could not collect); 3 MB limit exceeded the API's 4,000,000-char limit (valid 3 MB images were rejected with 413). | Pending token kept (localStorage, best-effort) with a "متابعة الانتظار" button; limit 2.8 MB + length check; transient poll errors/429 tolerated. |
| 15 | Response contract | Error codes were duplicated per route and per UI. | `lib/ai/http.ts` is the single mapping; `tests/ai-routes.test.ts` asserts every server code has a UI message. |
| 16 | Env | Invalid `*_COST` / `GEMINI_MAX_OUTPUT_TOKENS` only failed at request time. | `scripts/validate-env.mjs` checks them. |

## Response contracts (verified by `tests/ai-routes.test.ts`)

* Chat: `200 { data: { answer, provider, model, requestId, latencyMs }, requestId }` — UI reads `data.answer`.
* Image: `200` raw image bytes — UI reads `response.blob()`.
* Video start: `200 { data: { status:"processing", token, requestId, provider, model } }`; status: `{ data: { status: "processing" | "completed" (videoUrl) | "failed" (refunded) } }`.
* Errors: `{ error: <code>, requestId }`, codes in `lib/ai/http.ts`.

## Checked and found correct

* Secrets only read server-side (`GEMINI_API_KEY`, `MANUS_API_KEY`, `AUTH_SECRET`); nothing under `NEXT_PUBLIC_`.
* Auth on every route; admin health is SUPER_ADMIN only; media tokens are HMAC-signed, user-bound, expiring.
* `consumeAiCredit` is atomic (conditional decrement), VIP re-checked inside the transaction; refunds are idempotent and cannot exceed the reservation.

## Known limitations (not changed)

* **No streaming**: chat is request/response (the whole answer is returned at once). Adding SSE needs a separate credit/refund design for partially delivered answers.
* A video whose operation fails while nobody polls `/status` is refunded only when someone polls again (token valid 6 h). A scheduled sweeper would close this gap.
* Video resolution is limited to 720p from the client (cost control); aspect ratio 16:9 / 9:16.
* Model names in `.env.example` (e.g. `gemini-3.6-flash`) were not verified against the live provider.
* `npm install` was unavailable in the audit environment, so the full `tsc`/`vitest` run must be done with `npm run production:validate` on your side.
