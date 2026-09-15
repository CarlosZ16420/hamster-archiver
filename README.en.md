<div align="center">

<img src="README.assets/iconC_cropped_1022x1022.png" alt="Hamster Archiver icon" width="96">

# Hamster Archiver 仓鼠症大结局

### Enjoy collecting. Enjoy organizing, too.

Turn scattered local files into your own visual resource library.

![Version](https://img.shields.io/badge/version-4.6.9-d45f3c?style=flat-square)
![Windows x64](https://img.shields.io/badge/Windows-x64-23211d?style=flat-square)
![MIT](https://img.shields.io/badge/license-MIT-2f7558?style=flat-square)

**[Download for Windows](https://github.com/CarlosZ16420/hamster-archiver/releases/latest)** · **[Use with AI](#let-your-ai-client-use-the-library)** · [简体中文](README.md) · [Report an issue](https://github.com/CarlosZ16420/hamster-archiver/issues)

</div>

Downloads keep piling up, your drive is almost full, and organizing everything never gets done?

- Folders are scattered everywhere. You do not know how to categorize them or what you can afford to delete.
- You want a cloud backup but would rather not upload original pictures and videos for online viewing and processing.
- You plan to package files before uploading, but worry about ending up with archives whose contents you cannot recognize.

**Start by adding one folder.** Hamster Archiver builds a local library of folders and videos with covers, previews and directory manifests. Organize your collection with tags, ratings and notes. When you need a backup, create archives in batches, with optional passwords and split volumes, ready for you to upload or store on another drive.

**Your files can live elsewhere while a clear record of their contents and backup locations stays on your computer.**

![Archive workbench and thumbnail library](assets/readme/product-overview.en-US.png)

<sub>Actual application views; some labels in these screenshots may differ from the current version.</sub>

## One library, two ways to organize

| Your goal | What you get |
| --- | --- |
| **Prepare backups for cloud storage or another drive** | Batch compression, integrity verification and catalog registration. After uploading, record the backup location; local covers, video frames and directory trees show what each archive contains. |
| **Organize the files already on your computer** | Originals stay in place while the app creates previews and manifests. Categorize with tags and notes in the library, and queue those records for compression later if needed. |

The app packages files and records them; you or your sync tool handles cloud uploads. Local organization uses catalog metadata such as tags and does not automatically rearrange folders on disk.

## Store the backup elsewhere. Keep its contents in view.

Each project retains image thumbnails, sampled video frames and a complete directory tree. Choose a cover, record the extraction password and backup location, and browse what you archived without opening the archive itself.

![Project organization, media previews and directory tree](assets/readme/project-detail.en-US.png)

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

- Large thumbnails and a text list serve different browsing needs, with keyboard pagination, bulk tags and backup-location edits, and undo for supported operations.
- Tag completion reuses existing categories; accept suggestions with Tab. Selection updates in place to reduce flicker and layout jumps.
- Frames from the same video stay grouped, and portrait media remains fully visible. Change covers or add supplementary images from files or the clipboard.
- Read large-project details on demand. Load nearby visible media with bounded concurrent reads, and render directory trees virtually to reduce unnecessary work.
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

## Let AI organize it for you

This works with an AI assistant that can access your computer and connect to MCP. The AI can handle setup, connection checks and task tracking; you only need to describe what you want.

### Download

Send this to your AI assistant:

> Please download this project for me: https://github.com/CarlosZ16420/hamster-archiver

### First intake

After the download finishes, say:

> Please use Hamster Archiver to organize my D:\Downloads folder.

The AI reads existing settings first. On the first run, it asks only for missing choices:

1. Where compressed archives should be saved;
2. The intake mode (compressed or inventory-only) and what to do with original files afterward;
3. Whether to set an extraction password.

Once confirmed, you can wait for completion. The AI connects to the app, runs the intake, tracks progress and summarizes archive locations, warehouse records and results.

### Later use

At any time, say:

> Please use Hamster Archiver to organize everything in E:\Downloads.

The AI reuses saved preferences and asks again only when this task differs or required information is missing. The app itself does not upload media; metadata returned through MCP enters your chosen AI client's context. Full operating instructions for AI assistants are in the [AI quick start](docs/AI-QUICKSTART.md).

## Start with your first batch

1. Get the **Setup EXE installer** or **portable ZIP** from [Releases](https://github.com/CarlosZ16420/hamster-archiver/releases/latest). Extract the entire portable package and run `HamsterArchiver.exe`.
2. In the archive workbench, scan a directory or drop folders and videos, then review the pending resources.
3. For **local organization**, choose uncompressed intake. To **prepare backups**, set the archive output directory and start compressed intake. Open the library afterward to browse and organize the results.

Keep the full portable directory, such as `HamsterArchiver-v4.6.9-win-x64/`; do not copy only the EXE. Compression and video-preview tools are included.

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
<summary>How do I update? Does a warehouse export include my originals?</summary>

Open Check for updates to read release notes and update. If networking is unavailable, download a newer release and choose Manual update: select a ZIP for portable builds or a Setup EXE for installed builds.

If an older version has no working updater, export the warehouse and import it into a new copy of the app. Verify records and thumbnails before retiring the old directory. **Warehouse exports contain the index and thumbnails, not original files or archive outputs**; keep those separately.

</details>

## Continued refinement since 4.5.0

Recent work reworked similarity and duplicate verification, improved large-folder processing and failure recovery, and added tag completion, theme and language refinements, installed-edition updates and AI access. Much of it shows up as fewer misleading matches, less flicker and clearer file states after a failure. See the [changelog](CHANGELOG.md) for details.

## Open source and contributions

[MIT License](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

Source development requires Windows, Node.js 22.12+ on 22.x or 24.x, and npm 10.x/11.x. Install dependencies with `npm ci`, prepare bundled tools with `npm run tools:prepare` as needed, then run `npm start`. See the contribution guide for verification requirements.

Thanks to 7-Zip, FFmpeg, the open-source community and everyone who tests the app and reports the details that need attention.

If Hamster Archiver makes your collection easier to organize, a Star or an Issue with your experience is always welcome.
