'use strict';

const path = require('node:path');
const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

const TEST_GROUPS = Object.freeze({
  release: [
    'test/qa-plan.test.js',
    'test/release-architecture.test.js',
    'test/release-checkpoint.test.js',
    'test/release-local.test.js',
    'test/release-publish.test.js',
    'test/release-zip-manifest.test.js'
  ],
  mirrors: [
    'test/public-snapshot.test.js',
    'test/release-sync-cnb.test.js',
    'test/sync-cnb-source-tag.test.js'
  ],
  packaging: [
    'test/installer-build.test.js',
    'test/installer-compile.test.js',
    'test/manifest.test.js',
    'test/prepare-electron-runtime.test.js',
    'test/tool-integrity.test.js',
    'test/toolchain.test.js'
  ],
  archive: [
    'test/archive-engine.test.js',
    'test/archive-integration.test.js',
    'test/duplicate-check.test.js',
    'test/queue-manager.test.js',
    'test/scanner.test.js'
  ],
  catalog: [
    'test/catalog-query-performance.test.js',
    'test/tag-autocomplete.test.js',
    'test/thumbnail-loading.test.js'
  ],
  data: [
    'test/import-export.test.js',
    'test/migration.test.js',
    'test/storage-migration.test.js',
    'test/store.test.js',
    'test/warehouse-paths.test.js'
  ],
  desktop: [
    'test/i18n.test.js',
    'test/process-controller.test.js',
    'test/ui-state.test.js',
    'test/update-checker.test.js',
    'test/update-manager.test.js'
  ],
  mcp: [
    'test/mcp.test.js',
    'test/mcp-application-services.test.js'
  ],
  safety: [
    'test/development-paths.test.js',
    'test/paths.test.js',
    'test/publish-safety.test.js',
    'test/safety-regressions.test.js'
  ]
});

const DOCUMENT_ONLY = /^(?:docs\/|AGENTS\.md$|README(?:\.[^/]+)?$|CHANGELOG(?:\.[^/]+)?\.md$|LICENSE(?:\.[^/]+)?$|\.agents\/skills\/)/i;

function normalizeFile(file) {
  return String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function groupsForFile(file) {
  const name = normalizeFile(file);
  if (!name || DOCUMENT_ONLY.test(name)) return [];
  if (name === 'package.json' || name === 'package-lock.json' || name === 'dependency-lock.json' || name === '.nvmrc' || name.startsWith('scripts/prepare-') ||
      name.startsWith('scripts/build-') || name.includes('toolchain') || name.includes('tool-integrity')) {
    return ['packaging'];
  }
  if (name.includes('public-snapshot') || name.includes('sync-cnb')) return ['mirrors'];
  if (name.startsWith('.github/workflows/') || name.startsWith('scripts/release') ||
      name === 'scripts/qa-plan.js' || name === 'scripts/release-checkpoint.js') return ['release'];
  if (name.startsWith('src/core/mcp') || name.includes('/mcp-')) return ['mcp'];
  if (/(?:archive|queue|scanner|duplicate)/i.test(name)) return ['archive'];
  if (/(?:catalog|thumbnail|tag-autocomplete)/i.test(name)) return ['catalog'];
  if (/(?:store|storage|migration|warehouse|import-export)/i.test(name)) return ['data'];
  if (name.startsWith('src/') || name.startsWith('test/')) return ['desktop'];
  return ['safety'];
}

function makePlan(files, options = {}) {
  const normalized = [...new Set((files || []).map(normalizeFile).filter(Boolean))].sort();
  const requestedLevel = options.level || 'auto';
  if (!['auto', 'none', 'targeted', 'full'].includes(requestedLevel)) {
    throw new Error('QA level must be auto, none, targeted, or full.');
  }
  const groups = [...new Set(normalized.flatMap(groupsForFile))].sort();
  let level = requestedLevel;
  if (level === 'auto') level = groups.length === 0 ? 'none' : 'targeted';
  if (level === 'none') groups.length = 0;
  const tests = level === 'full'
    ? []
    : [...new Set(groups.flatMap(group => TEST_GROUPS[group] || []))].sort();
  const syntaxFiles = level === 'none' ? [] : normalized.filter(name => /\.(?:c?js|mjs)$/i.test(name));
  return {
    schemaVersion: 1,
    level,
    files: normalized,
    groups,
    tests,
    syntaxFiles,
    needsDependencies: level === 'full' || groups.includes('packaging'),
    needsElectron: level === 'full',
    needsBundledTools: level === 'full'
  };
}

function gitOutput(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function previousReleaseBase(commandRunner = gitOutput) {
  try {
    return commandRunner(['describe', '--tags', '--match', 'v[0-9]*', '--exclude', '*-*', '--abbrev=0', 'HEAD^']);
  } catch {
    // A first release must cover the entire source tree, including its root commit.
    return commandRunner(['hash-object', '-t', 'tree', '--stdin']);
  }
}

function changedFiles(base, head = 'HEAD') {
  if (base === 'previous-release') base = previousReleaseBase();
  const diff = base
    ? gitOutput(['diff', '--name-only', '--diff-filter=ACDMRTUXB', base, head])
    : gitOutput(['diff', '--name-only', '--diff-filter=ACDMRTUXB', 'HEAD']);
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard']);
  return [...new Set(`${diff}\n${untracked}`.split(/\r?\n/).filter(Boolean))];
}

function parseArgs(argv) {
  const result = { level: 'auto', head: 'HEAD', groups: [], files: [], testFiles: [], execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--execute') result.execute = true;
    else if (['--base', '--head', '--level', '--group', '--file', '--test-file', '--github-output'].includes(name)) {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${name}.`);
      if (name === '--group') result.groups.push(...value.split(',').filter(Boolean));
      else if (name === '--file') result.files.push(...value.split(',').filter(Boolean));
      else if (name === '--test-file') result.testFiles.push(...value.split(',').filter(Boolean));
      else result[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else throw new Error(`Unknown QA option: ${name}`);
  }
  return result;
}

function runPlan(plan) {
  if (plan.level === 'none') {
    console.log('QA skipped: the change contains documentation or metadata only.');
    return;
  }
  const syntaxFiles = plan.syntaxFiles.filter(file => existsSync(path.join(projectRoot, file)));
  if (plan.level === 'full') {
    execFileSync(process.execPath, [path.join('scripts', 'check-syntax.js')], { cwd: projectRoot, stdio: 'inherit' });
  } else if (syntaxFiles.length > 0) {
    execFileSync(process.execPath, [path.join('scripts', 'check-syntax.js'), ...syntaxFiles], { cwd: projectRoot, stdio: 'inherit' });
  }
  if (plan.level === 'full') {
    execFileSync(process.execPath, ['--test', 'test/**/*.test.js'], { cwd: projectRoot, stdio: 'inherit' });
  } else if (plan.tests.length > 0) {
    execFileSync(process.execPath, ['--test', ...plan.tests], { cwd: projectRoot, stdio: 'inherit' });
  }
}

async function writeGithubOutput(target, plan) {
  if (!target) return;
  const fs = require('node:fs/promises');
  const values = {
    level: plan.level,
    groups: plan.groups.join(','),
    needs_dependencies: String(plan.needsDependencies),
    needs_electron: String(plan.needsElectron),
    needs_tools: String(plan.needsBundledTools),
    tests_json: JSON.stringify(plan.tests),
    files_json: JSON.stringify(plan.files)
  };
  await fs.appendFile(target, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = options.files.length > 0 ? options.files : changedFiles(options.base, options.head);
  let plan = makePlan(files, { level: options.level });
  if (options.groups.length > 0 && plan.level !== 'full') {
    const unknown = options.groups.filter(group => !TEST_GROUPS[group]);
    if (unknown.length > 0) throw new Error(`Unknown QA group: ${unknown.join(', ')}`);
    plan = makePlan([], { level: 'targeted' });
    plan.groups = [...new Set(options.groups)].sort();
    plan.tests = [...new Set(plan.groups.flatMap(group => TEST_GROUPS[group]))].sort();
    plan.needsDependencies = plan.groups.includes('packaging');
    plan.needsElectron = false;
    plan.needsBundledTools = false;
  }
  if (options.testFiles.length > 0) {
    const allowed = new Set(Object.values(TEST_GROUPS).flat());
    const tests = options.testFiles.map(normalizeFile);
    const invalid = tests.filter(file => !allowed.has(file));
    if (invalid.length > 0) throw new Error(`Test file is outside the QA catalog: ${invalid.join(', ')}`);
    plan = makePlan([], { level: 'targeted' });
    plan.tests = [...new Set(tests)].sort();
    plan.needsDependencies = plan.tests.some(testFile => TEST_GROUPS.packaging.includes(testFile));
  }
  console.log(JSON.stringify(plan, null, 2));
  await writeGithubOutput(options.githubOutput, plan);
  if (options.execute) runPlan(plan);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { TEST_GROUPS, changedFiles, groupsForFile, makePlan, parseArgs, previousReleaseBase, runPlan };
