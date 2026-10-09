# Hamster Archiver for macOS

[简体中文](README.md)

The current macOS release is **4.8.5-beta.mac.1, a test version** of Hamster Archiver. The universal DMG and ZIP support Apple Silicon and Intel on macOS 12 or later. Download them from the [Mac Beta release page](https://github.com/CarlosZ16420/hamster-archiver/releases/tag/v4.8.5-beta.mac.1).

## Install: download, copy, open

1. Choose a Mac Beta from the [official Hamster Archiver releases](https://github.com/CarlosZ16420/hamster-archiver/releases) and download the file ending in `-mac-universal.dmg`. Universal supports both Apple Silicon and Intel. `Source code` is for development, not a runnable app.
2. Double-click the DMG, drag **Hamster Archiver.app** to **Applications**, and wait for copying to finish.
3. Open **Applications** in Finder and double-click **Hamster Archiver**. Once the app opens successfully, eject the installer disk and optionally delete the downloaded DMG.

You can also download the file ending in `-mac-universal.zip`, double-click it to extract the app, then move **Hamster Archiver.app** to **Applications** or another writable folder before opening it. Do not download the Windows ZIP. Both formats include a same-name `.sha256` checksum file. Launch the copy in your chosen folder: an app running inside a mounted DMG cannot update itself.

If the app opens normally, start using it; the confirmation below applies only when the first launch is blocked. You do not need Node.js or an Apple developer account.

<a id="first-launch"></a>

## First launch blocked

**This Beta has an ad-hoc signature, no Apple Developer ID signature, and has not been notarized by Apple.** The steps below are the computer user's permission to open this app, not an application for an Apple developer account. Verify that your file comes from the official release above. To check a download, compare its SHA-256 with the release's accompanying `.sha256` file.

If the warning says the developer cannot be verified or Apple cannot check for malicious software, and you have confirmed the source is trustworthy and the file has not been altered:

1. First try opening **Hamster Archiver** from **Applications** so macOS displays the warning for this app.
2. Open Apple menu → **System Settings → Privacy & Security**. Scroll to **Security** and find the blocked **Hamster Archiver** entry.
3. Click **Open Anyway** for this app and confirm as prompted. macOS may request this Mac's login password or Touch ID. Enter the password only in the macOS system dialog; do not send it to the developer.
4. Once the app opens, you can use it. macOS remembers the exception, so you do not repeat this setting on every launch.

**Official help with screenshots:** [Apple: Safely open apps on your Mac](https://support.apple.com/en-us/102445). On macOS 12, use Apple menu → **System Preferences → Security & Privacy → General**. Labels and locations vary by macOS version; choose your version at the top of the [Apple user guide](https://support.apple.com/guide/mac-help/mh40616/mac).

## Other messages

| What you see | What to do |
|---|---|
| No Open Anyway button | Try launching the Applications copy again and check that the blocked entry names Hamster Archiver. A company- or school-managed Mac may prohibit this action; contact its administrator. |
| The app is damaged or will damage your computer | Do not apply the exception steps above. Stop opening it, download again from the official release and check the digest. If the warning remains, report your macOS version and a screenshot of the original error. |
| Access to a selected folder is denied | Folder access is separate from the first-launch confirmation. Grant access to the needed folder through the system prompt, or choose a location writable by your user. External disks must be mounted and writable. |

This procedure uses a system exception for this app; it does not require disabling system-wide security checks. Hide personal paths, accounts and notifications in recordings or support screenshots, and do not record passwords.

## Data and feature limits

Application data is stored in the current user's `~/Library/Application Support/Hamster Archiver/` by default. Moving or replacing the app does not move that data. This Mac build bundles the official universal 7-Zip command-line tool for archiving. Video frame extraction is disabled by default because FFmpeg is not bundled. Automatic source deletion and Trash restoration are disabled on macOS because the Windows recovery mechanism cannot verify macOS Trash contents. Archive with **Keep source** or **Move source**.

Source folders, archive destinations, staging folders and moved-source destinations remain configurable on Mac. Paths such as `/Users/name/Documents/Archives` or `/Volumes/External/Archives` can be selected with the native folder picker. Archives stay at your chosen destination; the Warehouse index, previews and settings are separate user data. External disks must be mounted and writable. The ZIP distribution contains a runnable `.app` with no installer; its data still lives in Application Support, so moving the app does not carry the Warehouse to another Mac.

## Updates and Beta rollback

Background checks only discover new Mac Betas; they do not install them. Use **Check for updates** to choose a version, read its notes and download a verified DMG. Only after you confirm restart does the updater replace the `.app`; it checks startup with an isolated profile before replacement and retains the previous app for recovery. User data stays in place.

For **Manual update**, select a newer DMG or ZIP and keep its same-name `.sha256` file in the same folder. Preserve both release filenames; the checksum file must name the selected package and contain its matching SHA-256. For example:

```text
HamsterArchiver-v4.8.5-beta.mac.1-mac-universal.dmg
HamsterArchiver-v4.8.5-beta.mac.1-mac-universal.dmg.sha256
```

The ZIP pair uses `.zip` and `.zip.sha256` instead. Local updates only accept newer versions; rollback is a separate online action. Before rolling back, export the Warehouse and make a separate user-data backup: older Betas may not understand newer databases or settings, and replacing the app does not restore old data formats. The older `4.8.0-beta.mac.2` has no in-app updater, so install the newer app manually for its first upgrade.

## Help test

Please help test this Beta with a small copy first: scanning, compressed and uncompressed intake, online and manual updates, and supported recovery operations. Keep originals, an exported Warehouse and a separate user-data backup. [Report an issue](https://github.com/CarlosZ16420/hamster-archiver/issues) with your macOS version, Mac chip type, app version, steps and error details; redact private paths and passwords.
