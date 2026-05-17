# AsunaTracks Sync for Seanime

A Seanime plugin that syncs Seanime/AniList list changes into AsunaTracks.

Keep AsunaTracks up to date from Seanime. The extension can live-sync list edits as you watch or read in Seanime, and it also includes manual anime/manga sync buttons for catching up an existing library in AsunaTracks.

## What It Does

- Signs in with an AsunaTracks account through `/public/api/auth/login`.
- Live-syncs Seanime entry updates, progress updates, repeat counts, and deletes.
- Manually pushes the current AniList anime or manga collection into AsunaTracks.
- Uses MAL IDs from AniList as the bridge, so AsunaTracks can resolve or import media through its public API.
- Shows a compact tray UI with notifications, logs, profile menu, manual sync buttons, and live-sync toggles.

## Install

In Seanime, add this extension manifest URL:

```text
https://raw.githubusercontent.com/Kolex06/asunatracks-seanime-sync/main/asunatracks-sync.json
```

Then open the AsunaTracks Sync tray icon, sign in with your AsunaTracks account, and run `Sync Anime` or `Sync Manga` once. Leave live sync enabled for future Seanime list changes.

## Additional Notes

- Seanime/AniList media is matched to AsunaTracks through MAL IDs when available.
- Private AniList entries are skipped during sync.
- You can disable live sync from the tray at any time without signing out.

## Local AsunaTracks Testing

The extension defaults to:

```text
https://asunatracks.space
```

Open the profile menu, choose `Settings`, and change the URL to `http://localhost:8000` if you are testing a local AsunaTracks server.
