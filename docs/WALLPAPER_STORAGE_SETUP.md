# GameVortex Wallpaper Storage Setup

The wallpaper system now stores newly uploaded/imported originals in Vercel Blob. The browser can upload large image files directly to Blob, while GameVortex keeps the database record and serves downloads through `/api/wallpapers/[id]/download` instead of redirecting the user to an external file URL.

## Required Vercel setup

1. Create or connect a **Public** Vercel Blob store to the same Vercel project. The public store is used for fast image rendering; the actual download button still goes through the GameVortex download API.
2. Deploy the project.
3. For local development, set `BLOB_READ_WRITE_TOKEN` in `.env.local` to the read/write token for the Blob store.
4. Do not expose `BLOB_READ_WRITE_TOKEN` through a `NEXT_PUBLIC_` variable.

New Vercel Blob stores can use Vercel OIDC authentication on Vercel, so a long-lived token is not required by the deployed server when the store is connected and OIDC is enabled.

## Supported image files

- JPEG
- PNG
- WebP
- GIF
- APNG
- AVIF

Animated GIF/WebP/APNG/AVIF files remain animated. The original file is not converted or recompressed by GameVortex.

## Upload flow

Phone file:

Browser -> Vercel Blob direct upload -> GameVortex database record

URL:

External URL -> GameVortex server fetch -> Vercel Blob -> GameVortex database record

## Download flow

User -> `/api/wallpapers/[id]/download` -> GameVortex server -> original stored file -> browser download

The download route deliberately does not return a 3xx redirect to the Blob URL or an external URL.
