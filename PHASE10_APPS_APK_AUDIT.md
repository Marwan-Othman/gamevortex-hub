# Phase 10 — Apps / APK audit

Scope: the single owner page `/admin/content` (add / edit / delete a game or an app), APK upload from the
phone, APK from one external link, name, description, main image, extra images, version, MOD, category,
platform, link, file, and the public side (app page, list, download).
No separate "Downloader" was created: everything stays inside the one page, as designed.

## Checked and found correct (not changed)

* Every write route re-checks SUPER_ADMIN on the server and uses `guardMutation` (same-origin + rate limit); the upload-token route re-checks the role inside `onBeforeGenerateToken`.
* Files go browser → Vercel Blob directly (no server body limit); pathname folder, extension and max size are enforced when the token is issued; Android = APK only.
* Blob URLs are canonicalised (no query/hash); a file already used by another item is refused (`FILE_ALREADY_USED`); failed saves delete the files that attempt uploaded.
* External links: https only, public host, no credentials, no hash, max 2000 chars. The server never fetches the link (it only redirects the visitor), so there is no SSRF surface.
* `downloadSource` never reaches the browser; `/download/app/[slug]` validates status, rate limits, ignores HEAD for the counter, 303 + no-store.
* Delete removes the DB row and then the item's own Blob files (files another item still uses are protected).

## Problems found and fixed

| # | Area | Problem | Fix |
|---|------|---------|-----|
| 1 | Version | There was **no version field** anywhere (DB, form, API, page). | `version String?` on `Game` and `App` (migration `20261009180000_content_version`, nullable + idempotent). Form field "الإصدار", validated by `parseVersionValue` (letters/digits/`. _ + - ( )`, max 40), saved on create/edit (omitted = unchanged, empty = cleared), shown as a badge on the app page, game page, apps list and the admin list. |
| 2 | Storage | The server trusted the URL sent by the browser: it never checked that the file really exists in Blob, is not empty, or what it is. | `verifyUploadedFiles` (after upload, before the DB write, only for files added by that save): file exists (`UPLOADED_FILE_MISSING`), not empty, within size limits, images are real JPG/PNG/WEBP/AVIF **by signature** (`INVALID_IMAGE_FILE`), an Android file is a real APK = ZIP signature (`INVALID_APK_FILE`). Failing files are removed from Blob. A temporary storage/network failure never blocks a save (it is logged). |
| 3 | MIME / filename | Cover pathnames accepted **any extension** (only the browser-declared MIME was checked). Phone pictures named `image` with no extension had no valid name. | Cover pathname must end with `.jpg/.jpeg/.png/.webp/.avif` (`hasAllowedCoverExtension`); the form adds the right extension from the MIME type when the name has none (`coverFileName`). Android upload tokens only allow the APK content type. |
| 4 | APK in the form | A renamed/corrupted file (e.g. `.apk` that is not a ZIP) was uploaded in full before failing; picking a `.zip` for PC and then switching the platform to Android kept the wrong file until the upload failed with a generic message. | Client checks the ZIP signature of the first 4 bytes before uploading; switching to Android drops a non-APK file; submit re-checks; the max size and "APK only" hint are shown. |
| 5 | Error handling | Upload failures were swallowed by the Blob client and always showed the generic "تعذر الحفظ"; many server codes (`INVALID_VERSION_TYPE`, `INVALID_SOURCE`, `CONTENT_CREATE_FAILED` …) had no message; the token route returned **internal error text** in `detail` for 500s. | `UPLOAD_FAILED` message for any upload failure; Arabic messages for all codes above and the new ones; `detail` is returned only for our own known codes. |
| 6 | Edit imported apps | Saving an app always wrote the one "main image" into **both** `coverUrl` and `iconUrl`, so editing an imported app with a different icon and cover silently lost the icon. | Icon and cover are only rewritten when the owner changed the image; the cleanup list uses the real final values. |
| 7 | App page | View counter only moved through the API; `officialUrl` rendered unchecked (`javascript:` possible from bad data); no message when there is no download; MOD/version not on the list. | Best-effort counter on page load, `officialUrl` only http(s), "download not available" note, MOD + version badges on the list. |

## Tests

* `tests/content-admin.test.ts`: `parseVersionValue`, `looksLikeApk`, `detectImageType`.
* `tests/game-upload-shared.test.ts`: cover pathname rule, `coverFileName`.
* The pure test files (content-admin, game-upload-shared, downloads) pass here (31 checks). `npm install` is not possible in the audit environment, so run the full check on your side: `npm run production:validate` (Prisma generate, `tsc`, `vitest`, `next build`).

## Deploy notes

* Run `npm run db:deploy` (or let your pipeline do it): the new migration only adds two nullable columns.
* `BLOB_READ_WRITE_TOKEN` must be set (it already was required for uploads); it is also used for the new verification.

## Known limitations (not changed)

* A link is stored as typed; the server does not download it to check that it is really an APK (that would need a server-side fetch and a new SSRF surface). The owner is responsible for link content.
* iOS packages (`.ipa`) are not an upload format; use a link.
* The app page counts a view on every load (no per-visitor de-duplication).
