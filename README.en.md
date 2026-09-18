<div align="center">

<img src="README.assets/iconC_cropped_1022x1022.png" alt="Hamster Archiver icon" width="96">

# Hamster Archiver

### Enjoy collecting. Enjoy organizing, too.

Windows local-first file organizer, media library, and verifiable batch archiver. Optional local CLI/MCP interfaces support capable AI agents as an experimental feature.

![Version](https://img.shields.io/badge/version-4.6.16-d45f3c?style=flat-square)
![Windows x64](https://img.shields.io/badge/Windows-x64-23211d?style=flat-square)
![MIT](https://img.shields.io/badge/license-MIT-2f7558?style=flat-square)

**[Download for Windows](https://github.com/CarlosZ16420/hamster-archiver/releases/latest)** · [简体中文](README.md) · [Report an issue](https://github.com/CarlosZ16420/hamster-archiver/issues)

</div>

[Quick start](#quick-start) · [Features](#everyday-ease-supported-by-careful-details) · [Experimental AI integration](#experimental-features) · [FAQ](#frequently-asked-questions) · [Documentation and contributions](#documentation-and-contributions)

Downloads keep piling up, your drive is almost full, and organizing everything never gets done?

- Folders are scattered everywhere. You do not know how to categorize them or what you can afford to delete.
- You want a cloud backup but would rather not upload original pictures and videos for online viewing and processing.
- You plan to package files before uploading, but worry about ending up with archives whose contents you cannot recognize.

**Start by adding one folder.** Hamster Archiver builds a local library of folders and videos with covers, previews and directory manifests. Organize your collection with tags, ratings and notes. When you need a backup, create archives in batches, with optional passwords and split volumes, ready for you to upload or store on another drive.

**Your files can live elsewhere while a clear record of their contents and backup locations stays on your computer.**

[![Library overview, cover gallery and search filters](assets/readme/library-showcase.en-US.png)](assets/readme/library-showcase.en-US.png)

<sub>Actual application views; some labels in these screenshots may differ from the current version.</sub>

## One library, two ways to organize

| Your goal | What you get |
| --- | --- |
| **Organize the files already on your computer** | Originals stay in place while the app creates previews and manifests. Categorize with tags and notes in the library, and queue those records for compression later if needed. |
| **Prepare backups for cloud storage or another drive** | Batch compression, integrity verification and catalog registration. Record the backup location; local covers, video frames and directory trees show what each archive contains. |

The app packages files and records them; you or your sync tool handles cloud uploads. Local organization uses catalog metadata such as tags and does not automatically rearrange folders on disk.

Refresh an uncompressed folder from its details or a selected batch. Additions merge into the same record; modifications and deletions require a source-change review. Dropping the same original folder again continues its latest content record, with an explicit choice to replace, create an independent record, or skip when review is needed. Valid previews and fingerprints are reused, and relocating an original only changes the association until your next operation.

Intake automatically detects duplicates and can skip existing content while still providing a similarity report. Large directories remain responsive, and the whole library is quick to search.

## Quick start

For **Windows x64**, with English and Chinese interfaces. To use the app, choose a [Release package](https://github.com/CarlosZ16420/hamster-archiver/releases/latest); GitHub Source code downloads and repository clones are for development.

1. Download the **Setup EXE installer**, or extract the entire **portable ZIP** and run `HamsterArchiver.exe`.
2. In the archive workbench, scan a directory or drop folders and videos, then review the pending resources. Try one small folder for your first run.
3. For **local organization**, choose uncompressed intake. To **prepare backups**, set the archive output directory and start compressed intake. Open the library afterward to browse and organize the results.

Compression and video-preview tools are included, and no separate Node.js installation is needed.

Keep all included files in the portable directory, `HamsterArchiver-v4.6.16-win-x64/`.

[![Batch archiving, progress tracking and duplicate review](assets/readme/archive-showcase.en-US.png)](assets/readme/archive-showcase.en-US.png)

### Ready for modern local workflows

Beyond the desktop interface, Hamster Archiver offers optional CLI/MCP automation for scripts and AI agents with local tool access. This is an experimental feature and does not affect the default local desktop workflow.

## Store the backup elsewhere. Keep its contents in view.

Each project retains image thumbnails, sampled video frames and a complete directory tree. Choose a cover, record the extraction password and backup location, and browse what you archived without opening the archive itself.

[![Tags, ratings, backup locations, video frames and directory tree](assets/readme/details-showcase.en-US.png)](assets/readme/details-showcase.en-US.png)

## Everyday ease, supported by careful details

### File safety: verify before handling originals

Archive intake follows **manifest → compression → integrity verification → catalog registration → configured source handling**. Low disk space and abnormal output sizes stop processing or require review. Source post-processing runs only after verification and registration succeed.

<details>
<summary>Details: file preservation and recovery</summary>

- Generate a manifest and recheck sources before compression. Cross-drive moves copy and verify before handling the source location.
- Verify archive identity before moving or cleaning up, protecting against replacement files with the same name; handle split archives as a complete set.
- Preserve generated archives for recovery if catalog registration fails. Cancellation during thumbnail generation keeps originals and cleans uncommitted outputs.
- Distinguish a failed source operation from a completed operation whose status could not be saved, retaining diagnostic recovery information.
- Track original-file location and disposition, with restoration of moved or recycled sources when conditions permit.
- Report invalid data locations explicitly; safe data-location switching retains the previous directory instead of silently presenting an empty library.

</details>

### Organization: preview, categorize and keep useful notes

Browse covers and build your own organization habits with tags, ratings and notes. Search titles, tags, notes, paths and filenames, and record backup locations in bulk.

<details>
<summary>Details: organization tools and responsive browsing</summary>

- Large thumbnails and a text list serve different browsing needs, with keyboard pagination, bulk tags and backup-location edits. Warehouse items deleted during the current session, together with their files in the Windows Recycle Bin, can also be undone directly.
- Tag completion reuses existing categories; accept suggestions with Tab. Selection updates in place to reduce flicker and layout jumps.
- Frames from the same video stay grouped, and portrait media remains fully visible. Change covers or add supplementary images from files or the clipboard.
- Read large-project details on demand. Load nearby visible media with bounded concurrent reads, and render directory trees virtually to reduce unnecessary work.
- Both views support marquee selection, Ctrl toggling and Shift ranges, with one-click clearing across pages. Warehouse tools offer small, medium and large thumbnails; a floating button returns to search and bulk actions after scrolling down.
- Store thumbnails instead of another complete copy of original media; preview counts are configurable.
- Choose from five themes and Chinese or English, with continuing refinements to dark menus, text contrast and dynamic messages.

</details>

### Similar resources: see the evidence and decide

**Similar names, identical file contents and complete duplicate projects are shown separately.** Optionally skip projects that meet complete-duplicate rules; review merely similar resources instead of letting a shared word decide for you.

<details>
<summary>Details: fewer false matches and bounded processing</summary>

- Highlight only the matching name fragment. Click a red term and confirm adding it to the ignore list to reduce that source of noise; gold distinguishes identical-content evidence.
- Reduce interference from short titles, numeric identifiers and common words. Adjust similarity strength, and retain manually dismissed relationships across recalculation.
- Narrow candidates with indexes, verify content as needed and stop unnecessary reads once candidates are excluded. Reuse evidence instead of scanning the whole catalog for every file.
- Use a shortcut only when the same original location and complete directory/file metadata snapshots match. Otherwise verify content; matching names or sizes alone cannot justify automatic skipping.
- Large-folder safeguards bound representative files for ordinary similarity analysis and can omit tiny-file MD5 records from that analysis. Complete manifests and archives still cover all files.
- Changing similarity strength does not start a full-library rebuild automatically. Choose single-project or full recalculation yourself.

</details>

### Packaging: fit your backup habits

Choose 7z/ZIP, passwords and custom split volumes. Queue batches, pause or schedule work, and adjust compression, sampled video frames and thumbnail counts.

<details>
<summary>Details: compression, password records and batch tasks</summary>

- Compression levels 0–9 and configurable 64 MiB–10 GiB split volumes, with tools included in release packages.
- Set an archive password and record extraction passwords per project. Records remain masked until revealed for viewing or copying; protect the local user data that holds them.
- Pause, finish the current item before pausing, schedule runs and view remaining-time estimates. Add next-run resources from the desktop while processing continues.
- Configure video frame counts and per-project thumbnail limits; task settings are saved with each job.
- Password protection does not guarantee that a third-party storage provider will never review or remove files.

</details>

## Experimental features

### AI / agent integration (CLI · MCP · discovery preview)

Hamster Archiver offers experimental local integration for modern AI/agent workflows. Once enabled, assistants with local command or MCP access can search the library, add tags, and submit inventory-only or compressed archive tasks.

AI integration is off by default. The Setup EXE is recommended because it provides a stable application path and managed upgrade/uninstall lifecycle; portable ZIP builds can still use CLI/MCP manually.

Under **More settings → Experimental → AI assistant integration**, enable Codex / ChatGPT Desktop, optional Codex MCP, WorkBuddy, generic MCP, or the ODR discovery preview independently. Each adapter can also be disabled independently.

For routine use, state the goal directly—for example: “Use Hamster Archiver to catalog `D:\Downloads\Sample` without compression and keep the originals.” The application owns validation, queueing, archive verification, and result persistence. The assistant needs extra steps only when input is missing, confirmation is required, or a real error occurs.

> This is experimental. The AI client can see returned paths, titles, tags, notes, and other metadata; Hamster Archiver itself does not upload media to an online model. Availability depends on the selected client, operating system, and permissions.

[AI quick start](docs/AI-QUICKSTART.md) · [CLI reference](docs/CLI.md) · [MCP reference](docs/MCP.md) · [Troubleshooting](docs/AI-TROUBLESHOOTING.md)

## Frequently asked questions

<details>
<summary>Will packaging immediately free up space on a nearly full drive?</summary>

Packaging organizes files for backup; it does not guarantee substantial size reductions for videos or images. Output files require available disk space, so you can select another drive with enough room.

Confirm that the backup is safely stored at its destination before deciding what to do with local files. Local archives and Recycle Bin contents still consume space. Source post-processing happens after local verification and registration; **it does not wait for or verify cloud uploads**. If you intend to clean up after uploading, keep originals first and verify the backup yourself.

</details>

<details>
<summary>Where do files and library data live?</summary>

Local organization leaves originals in place and stores an index and thumbnails. Backup archives go to your selected destination. Portable builds default to adjacent `userdata`; installed builds use Windows user data. More settings provides a safe location-switching workflow.

The application does not upload resources; you or your sync tool handles uploads. It contacts GitHub for update checks and downloads. When using AI, returned metadata enters the chosen client's context.

</details>

<details>
<summary>Can I view runtime logs after closing the app?</summary>

Yes. Runtime logs remain in `logs/app.log` inside the active user-data area, and the next launch restores the latest 300 valid entries in the interface. Logs cover task processing, changed setting fields, user-data-area switches, update actions, and critical errors, but never password values or routine searching, browsing, and copying.

</details>

<details>
<summary>How do I update? Does a warehouse export include my originals?</summary>

Open Check for updates to read release notes and update. If networking is unavailable, download a newer release and choose Manual update: select a ZIP for portable builds or a Setup EXE for installed builds.

If an older version has no working updater, export the warehouse and import it into a new copy of the app. Verify records and thumbnails before retiring the old directory. **Warehouse exports contain the index and thumbnails, not original files or archive outputs**; keep those separately.

</details>

## Documentation and contributions

| What you need | Where to go |
| --- | --- |
| Downloads and published versions | [Releases](https://github.com/CarlosZ16420/hamster-archiver/releases) |
| Experimental AI / CLI / MCP integration | [AI quick start](docs/AI-QUICKSTART.md) · [CLI reference](docs/CLI.md) · [MCP reference](docs/MCP.md) · [Troubleshooting](docs/AI-TROUBLESHOOTING.md) |
| Feature changes | [Changelog](CHANGELOG.md) (`Unreleased` marks changes awaiting release) |
| Bug reports or feature suggestions | [Issues](https://github.com/CarlosZ16420/hamster-archiver/issues): include the version, steps and error details; redact private paths and passwords |
| Code or documentation contributions | [Contributing](CONTRIBUTING.md) · [Development guide](docs/DEVELOPMENT.md) |
| Security reports and licensing | [Security](SECURITY.md) · [MIT License](LICENSE) |

Source development requires Windows, Node.js 22.12+ on 22.x or 24.x, and npm 10.x/11.x. See the development guide for dependency, Electron runtime and bundled-tool setup.

Hamster Archiver started as a small tool for my own collection. I hope it helps you enjoy organizing yours, too. Thanks to 7-Zip, FFmpeg, the LinuxDo community and everyone who tries the app and shares feedback. If it helps you, a Star or a suggestion is always welcome.
