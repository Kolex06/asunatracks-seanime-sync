# AsunaTracks Sync for Seanime

A Seanime plugin that syncs Seanime/AniList list changes into AsunaTracks.

## Install

In Seanime, add this extension manifest URL:

```text
https://raw.githubusercontent.com/Kolex06/asunatracks-seanime-sync/main/asunatracks-sync.json
```

Then open the AsunaTracks Sync tray icon, sign in with your AsunaTracks account, and run `Sync Anime` or `Sync Manga` once. Leave live sync enabled for future Seanime list changes.

## What It Does

- Signs in with an AsunaTracks account through `/public/api/auth/login`.
- Live-syncs Seanime entry updates, progress updates, repeat counts, and deletes.
- Manually pushes the current AniList anime or manga collection into AsunaTracks.
- Uses MAL IDs from AniList as the bridge, so AsunaTracks can resolve/import media through its public API.
- Includes notifications, logs, profile menu, manual sync buttons, and live-sync toggles.

## Local AsunaTracks Testing

The extension defaults to:

```text
https://asunatracks.space
```

Open the profile menu, choose `Settings`, and change the URL to `http://localhost:8000` if you are testing a local AsunaTracks server.
