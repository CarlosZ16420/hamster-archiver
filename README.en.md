<div align="center">

<img src="assets/app-icon.png" alt="Hamster Archiver app icon" width="96">

</div>

![Hamster Archiver turns scattered folders into a verified, searchable local vault](assets/readme/hero.svg)

<div align="center">

[![Version](https://img.shields.io/badge/version-4.5.6-e9653c?style=flat-square)](../../releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-28241f?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-28745c?style=flat-square)
[![CI](https://github.com/CarlosZ16420/hamster-archiver/actions/workflows/ci.yml/badge.svg)](https://github.com/CarlosZ16420/hamster-archiver/actions/workflows/ci.yml)

**A local-first batch archiver and searchable media warehouse for Windows.**

[Download for Windows](../../releases/latest) · [中文](README.md) · [Report an issue](../../issues) · [Contributing](CONTRIBUTING.md)

</div>

## Built for overflowing drives

Ordinary compression tools leave you with archives. Hamster Archiver turns every direct child folder or video into a traceable task, creates a manifest and media previews, compresses and verifies it, then stores titles, paths, tags, thumbnails and fingerprints in a local SQLite warehouse.

- Search titles, tags, notes, paths and filenames instead of excavating folders.
- Compare exact fingerprints, titles, video names and sizes before accepting another copy.
- Keep the warehouse, previews, saved passwords and logs on your own machine.

## See the warehouse, not just the ZIPs

![Archive workbench, real task queue, warehouse overview and cover grid](docs/images/interface-overview.png)

The warehouse preserves the complete directory tree and turns images and evenly sampled video frames into browsable previews. Each project can have a cover, tags, rating, notes, backup location and its own extraction password.

<details>
<summary><strong>Open a project detail and frame preview</strong></summary>

![Project details, media previews and complete directory structure](docs/images/detail.png)

</details>

## One local, verifiable pipeline

![Scan, manifest, archive, verify and catalogue workflow](assets/readme/workflow.svg)

1. Scan a source directory or add one folder or video.
2. Build a directory manifest, MD5 fingerprints, image thumbnails and evenly sampled video frames.
3. Create 7z/ZIP archives with portable 7-Zip, optional passwords, levels and 64 MiB–10 GiB volumes.
4. Test archive integrity. Large tasks, abnormal ratios and possible duplicates wait for confirmation.
5. Only after a successful warehouse commit does the app keep, move or recycle the source as configured.

## What it gives you

| Safe archiving | Searchable warehouse | Local and portable |
|---|---|---|
| Source and free-space checks | Persistent SQLite WAL + FTS5 indexes | No automatic media or warehouse upload |
| Integrity tests and ratio review | Search titles, tags, notes, paths and names | Switchable portable `userdata` |
| Isolated multi-volume publish/rollback | Covers, previews, directory trees, discovery | Relocatable app-owned data |
| Copy, verify, then delete across drives | Exact and similarity-based review | Chinese/English UI and five themes |

### Duplicate and similarity review

- Exact files require both size and MD5 evidence; title and video evidence are scored separately.
- A short title, one generic term or release-format boilerplate cannot mark unrelated projects by itself.
- Choose “Possible duplicate” directly from the tag filter, rebuild one project or the whole warehouse, or dismiss a relation symmetrically.
- Changing similarity strength does not silently trigger an expensive full rebuild.

### Queue and source safety

- Pause, finish the current item and pause, schedule a run, and estimate remaining time from real history.
- Unreadable files are skipped and logged; the source remains when a task contains skipped items.
- Recycle Bin handling is checked immediately for the current task. Unverified handling stops the queue; historical projects are not sampled.
- Restoring a moved or recycled source can be attempted before deleting a warehouse record. A failed restore preserves the record and archives.

## Quick start

1. Download the Windows x64 ZIP from [Releases](../../releases/latest).
2. Extract the **complete directory** and run `HamsterArchiver.exe`.
3. Choose the source and archive-output directories, scan, review the queue and start archiving.

> Do not copy only the EXE. Electron, 7-Zip, FFmpeg and update verification depend on the complete release directory.

### Updating

Check for updates always shows the current and latest versions. When a release is available, automatic update is offered; manual update remains available at any time and accepts a complete Windows x64 release ZIP. The package version, platform, manifest and critical files are verified, existing `userdata` is excluded from replacement, and failed replacement rolls back.

<details>
<summary><strong>One-time migration from 4.2.0</strong></summary>

The updater bundled with 4.2.0 cannot replace `resources` correctly, so that version needs one manual migration:

1. Export the warehouse from the old app and exit it completely.
2. Extract the latest ZIP into a **new directory**; do not overwrite a running installation.
3. Run the new app and use Import external warehouse with the exported ZIP.
4. Verify the version, records and thumbnails before removing the old directory.

</details>

## Portable data layout

```text
HamsterArchiver-v4.5.6-win-x64/
├─ HamsterArchiver.exe
├─ tools/                  # 7-Zip and FFmpeg
├─ resources/              # Electron application
└─ userdata/
   ├─ config/              # settings and similarity ignore terms
   ├─ warehouse/           # SQLite warehouse and thumbnails
   ├─ logs/                # current-user log
   ├─ processed/           # default processed-source destination
   └─ electron/            # local UI cache
```

The user data area can contain passwords, personal paths and media thumbnails. Git ignores it and it never enters the public source snapshot or release ZIP. More settings can copy data to an empty directory or switch to another recognized data area while retaining the old directory; two warehouses are never merged silently.

## Technology and boundaries

| Area | Implementation |
|---|---|
| Desktop | Electron 43, context isolation, sandbox, strict CSP |
| Data | Node built-in SQLite, WAL, transactions, FTS5 |
| Compression | Portable 7-Zip 26.02, 7z/ZIP, integrity tests |
| Media | One portable FFmpeg binary for probing and frame extraction |
| Performance | Pagination, virtualized trees, persistent search and similarity candidates |
| Network | GitHub is contacted only for update checks or links; archive upload is outside the app |

## Run from source

Requires Windows, Node.js 22.12+ on the 22.x line or Node.js 24.x, and npm 10.x/11.x.

```powershell
git clone https://github.com/CarlosZ16420/hamster-archiver.git
cd hamster-archiver
npm ci
npm run verify:dependencies
npm run check
npm test
npm start
```

The repository does not commit the large `ffmpeg.exe`. `dependency-lock.json` pins Electron, 7-Zip and FFmpeg versions, sources and critical hashes. Use `npm run tools:prepare` to restore bundled tools and `npm run verify:tools` before a release build.

Keep maintainer builds, user data and public snapshots outside the source tree. Development uses isolated data; see [development](docs/DEVELOPMENT.md) and [release](docs/RELEASE.md).

## Contributing

Before submitting changes, run `npm run verify:dependencies`, `npm run check`, `npm test` and `npm run publish:check`. Never commit user data, databases, logs, archives, passwords, real media or personal absolute paths. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Released under the [MIT License](LICENSE). Bundled 7-Zip and FFmpeg retain their accompanying licenses.

<div align="center">

**Turn “I think I saved this before” into a verified, searchable answer.**

[Download the latest release](../../releases/latest) · [Open an issue](../../issues) · [Changelog](CHANGELOG.public.md)

</div>
