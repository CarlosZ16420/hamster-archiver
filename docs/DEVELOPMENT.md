# Development guide

Hamster Archiver targets Windows. Use Node.js 22.12+ (22.x) or 24.x with npm 10.x/11.x; `.nvmrc` tracks Node.js 24.x.

## Setup

Install the locked dependencies with `npm ci`. Electron is not downloaded during dependency installation. Before launching the desktop application, run `npm run electron:prepare`; add `-- --allow-download` only when network access is intentional. If bundled tools are missing, run `npm run tools:prepare`.

Runtime data, databases, logs, generated archives, and built applications do not belong in the source tree. See [Data safety](DATA_SAFETY.md) for the user-data boundaries.

## Common commands

```powershell
npm start
npm run check
npm test
npm run verify:dependencies
npm run publish:check
```

`npm start` uses isolated development data. The checks above validate the source tree but do not authorize access to real user data or release publication.

## Contributing

Create your own branch, keep changes focused, add tests for behavior changes, and describe user-visible effects and data-migration risks in the pull request. Contributors may use their own editor, agent, review, and Git workflow; no maintainer-specific automation is required by this public source snapshot.

See [Contributing](../CONTRIBUTING.md) for the repository's general contribution and privacy rules.
