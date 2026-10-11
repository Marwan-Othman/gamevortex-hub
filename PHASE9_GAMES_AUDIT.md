# Phase 9 — Games audit

Scope: add / edit / delete game, file upload, images, categories, platforms (PC, Mobile), download,
game details, search, filtering, admin controls, user access.

## Checked and found correct (not changed)

* Every write route (`/api/admin/content*`) re-checks SUPER_ADMIN on the server (`requireOwner`) and uses `guardMutation` (same-origin + rate limit).
* Upload token route re-checks the role again inside `onBeforeGenerateToken`; pathname folder + extension and size are enforced server-side; Android = APK only.
* Blob URLs are canonicalised (no query/hash), and a file already used by another item is refused (`FILE_ALREADY_USED`).
* `downloadSource` never reaches the browser (`toPublicContent`); `/download/*` validates status, rate limits, never counts HEAD, redirects 303 no-store.
* External links must be https, public host, no credentials (`normalizeExternalSourceUrl`).
* Public lists only show `published: true`; platform filter and sort options are whitelisted.

## Problems found and fixed

| # | Area | Problem | Fix |
|---|------|---------|-----|
| 1 | Delete game | There was **no way to delete a game or app** (no API, no button; the only `DELETE` was the upload cleanup). | `DELETE /api/admin/content/[type]/[id]` (owner only, CSRF + rate limit, audit log) + "حذف" button with confirmation. Blocked with `CONTENT_HAS_PURCHASES` (409) when users own it or it was ordered; unpublish instead. Own Blob files are cleaned afterwards (files still referenced elsewhere are protected). |
| 2 | Categories | The owner form could not assign categories, so games added from the panel never appeared under any category filter. | Category picker in the form; `categories` (IDs) validated on POST/PATCH (`INVALID_CATEGORY` for unknown ones), replaced on edit, omitted = unchanged; loaded back when editing. |
| 3 | Edit imported games | The 500+ RAWG-imported games have no file/link, but the form demanded one, so they could not be edited (e.g. hidden or re-described). | Editing an item that has no source can be saved without adding one; the stored source stays unchanged. New items still require a source. |
| 4 | Admin list | The list showed only the latest 100 games, so most imported games were unreachable. | Search (name/slug) + pagination (30 per page) + totals. |
| 5 | Categories page | Built from the old `genre` text column, not from real categories, so it did not match the `/games?genre=` filter and ignored owner-added games. | Uses the `Category` table with the count of published games; empty categories hidden. |
| 6 | User access | Library / favorites / wishlist POST+DELETE returned **400** for a logged-out user, so the UI showed a generic failure instead of "log in"; raw error messages could leak. | `userRouteError`: 401 `UNAUTHORIZED`, 400 `INVALID_BODY`, otherwise a fixed code. |
| 7 | Game details | View counter only moved through the API, so the page counter / "most viewed" sort never changed; title shown twice when Arabic = English; `officialUrl` rendered unchecked; no message when no download. | Best-effort counter on page load, duplicate title hidden, `officialUrl` only http(s), "download not available" note. |
| 8 | Games list | A page number past the end showed "No results"; `limit` was lost when searching; same duplicate title. | Redirect to last page; hidden `limit` field; duplicate title hidden. |
| 9 | `/api/games` | `search`/`category` unbounded; `genre` param (used by the page) not understood; description not searched (page does). | Length caps, `genre` alias, description search, page upper bound. |

## Tests

* `tests/content-admin.test.ts`: added `parseCategoryValues` cases.
* `npm run test:source` and `npm run test:env-contract` pass here. `npm install` is unavailable in the audit environment, so the full `tsc` / `vitest` / `next build` must be run on your side: `npm run production:validate`.

## Known limitations (not changed)

* A game that real users already bought cannot be deleted (by design); hide it with "نشر في الموقع" off.
* Direct download of commercial titles is intentionally not implemented; official store links are used.
* The game page counts a view on every load (no per-visitor de-duplication).
