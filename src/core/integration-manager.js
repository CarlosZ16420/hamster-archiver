'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { codedError } = require('./task-contracts');
const { writeJsonAtomic } = require('./store');

const OWNED_BEGIN = '# BEGIN HAMSTER ARCHIVER MANAGED MCP';
const OWNED_END = '# END HAMSTER ARCHIVER MANAGED MCP';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function readText(filePath, fallback = '') {
  try { return await fs.readFile(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readJson(filePath, fallback = {}) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, filePath);
}

async function pathExists(filePath) {
  try { await fs.access(filePath); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function managedCodexBlock(commandPath) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
  return [
    OWNED_BEGIN,
    '[mcp_servers.hamster_archiver]',
    `command = ${tomlString(cmd)}`,
    `args = ["/d", "/s", "/c", ${tomlString(`"${commandPath}"`)}]`,
    'startup_timeout_sec = 45',
    'tool_timeout_sec = 60',
    'enabled = true',
    OWNED_END
  ].join('\n');
}

function replaceManagedBlock(source, block, { remove = false } = {}) {
  const start = source.indexOf(OWNED_BEGIN);
  const end = source.indexOf(OWNED_END);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) {
    throw codedError('INTEGRATION_CONFIG_CONFLICT', 'The Codex config contains an incomplete Hamster-managed block.', 'integration', {
      requiredAction: 'review_host_config'
    });
  }
  if (start >= 0) {
    return `${source.slice(0, start)}${remove ? '' : block}${source.slice(end + OWNED_END.length)}`;
  }
  if (remove) return source;
  const separator = !source ? '' : source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n';
  return `${source}${separator}${block}\n`;
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(Object.assign(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`), { code: 'INTEGRATION_COMMAND_FAILED' })));
  });
}

class IntegrationManager {
  constructor({ applicationRoot, userDataRoot, homeDirectory = os.homedir(), packagedWithIdentity = false } = {}) {
    this.applicationRoot = path.resolve(applicationRoot);
    this.userDataRoot = path.resolve(userDataRoot);
    this.homeDirectory = path.resolve(homeDirectory);
    this.packagedWithIdentity = packagedWithIdentity;
    this.templatesRoot = path.join(this.applicationRoot, 'integrations');
    this.statePath = path.join(this.userDataRoot, 'integrations', 'state.json');
  }

  async state() {
    const value = await readJson(this.statePath, { schemaVersion: 1, adapters: {} });
    value.adapters ||= {};
    return value;
  }

  async saveState(value) {
    value.schemaVersion = 1;
    value.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.statePath, value);
  }

  launcher(name) {
    return path.join(this.applicationRoot, name);
  }

  async renderTemplate(relativePath, replacements = {}) {
    let value = await readText(path.join(this.templatesRoot, relativePath));
    if (!value) throw codedError('INTEGRATION_TEMPLATE_MISSING', `Missing integration template: ${relativePath}`, 'integration');
    for (const [key, replacement] of Object.entries(replacements)) {
      value = value.replaceAll(`{{${key}}}`, replacement);
    }
    return value;
  }

  async writeOwnedFiles(adapterId, files) {
    const state = await this.state();
    const previous = state.adapters[adapterId];
    if (previous?.files) {
      for (const owned of previous.files) {
        if (!await pathExists(owned.path)) continue;
        const current = await fs.readFile(owned.path);
        if (digest(current) !== owned.digest) {
          throw codedError('INTEGRATION_USER_MODIFIED', `The user modified ${owned.path}; it was not overwritten.`, 'integration', {
            requiredAction: 'review_host_config'
          });
        }
      }
    }
    const savedFiles = [];
    for (const file of files) {
      const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
      if (await pathExists(file.path) && !previous?.files?.some((owned) => owned.path === file.path)) {
        throw codedError('INTEGRATION_TARGET_EXISTS', `The target already exists and is not owned by Hamster Archiver: ${file.path}`, 'integration', {
          requiredAction: 'choose_repair_or_remove_conflict'
        });
      }
      await fs.mkdir(path.dirname(file.path), { recursive: true });
      await fs.writeFile(file.path, content);
      savedFiles.push({ path: file.path, digest: digest(content) });
    }
    state.adapters[adapterId] = { ...(previous || {}), enabled: true, files: savedFiles, installedAt: previous?.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.saveState(state);
    return state.adapters[adapterId];
  }

  async installCodexSkill({ explicitOnly = false } = {}) {
    const root = path.join(this.homeDirectory, '.agents', 'skills', 'hamster-archiver');
    const cli = this.launcher('hamster.cmd');
    const files = [
      ['SKILL.md', await this.renderTemplate(path.join('codex', 'hamster-archiver', 'SKILL.md'), { HAMSTER_CLI: cli })],
      [path.join('agents', 'openai.yaml'), await this.renderTemplate(path.join('codex', 'hamster-archiver', 'agents', 'openai.yaml'), { ALLOW_IMPLICIT: explicitOnly ? 'false' : 'true' })]
    ].map(([relative, content]) => ({ path: path.join(root, relative), content }));
    const installed = await this.writeOwnedFiles('codex-skill', files);
    installed.explicitOnly = explicitOnly;
    const state = await this.state();
    state.adapters['codex-skill'] = installed;
    await this.saveState(state);
    return this.status('codex-skill');
  }

  async installCodexMcp() {
    const configPath = path.join(this.homeDirectory, '.codex', 'config.toml');
    const source = await readText(configPath);
    const block = managedCodexBlock(this.launcher('HamsterArchiver-MCP.cmd'));
    const state = await this.state();
    const previous = state.adapters['codex-mcp'];
    if (previous?.managedBlockDigest && source.includes(OWNED_BEGIN)) {
      const managed = source.slice(source.indexOf(OWNED_BEGIN), source.indexOf(OWNED_END) + OWNED_END.length);
      if (digest(managed) !== previous.managedBlockDigest) {
        throw codedError('INTEGRATION_USER_MODIFIED', 'The Hamster Codex MCP block was edited and was not overwritten.', 'integration', {
          requiredAction: 'review_host_config'
        });
      }
    }
    await atomicText(configPath, replaceManagedBlock(source, block));
    state.adapters['codex-mcp'] = { enabled: true, configPath, managedBlockDigest: digest(block), updatedAt: new Date().toISOString() };
    await this.saveState(state);
    return this.status('codex-mcp');
  }

  async installWorkBuddy() {
    const workBuddyRoot = path.join(this.homeDirectory, '.workbuddy');
    const connectorRoot = path.join(workBuddyRoot, 'connectors', 'hamster-archiver');
    const replacements = {
      HAMSTER_MCP: this.launcher('HamsterArchiver-MCP.cmd').replace(/\\/g, '\\\\')
    };
    const files = [];
    for (const relative of ['connector-meta.json', 'mcp.json', 'icon.svg', path.join('skills', 'hamster-archiver', 'SKILL.md')]) {
      files.push({ path: path.join(connectorRoot, relative), content: await this.renderTemplate(path.join('workbuddy', relative), replacements) });
    }
    const configPath = path.join(workBuddyRoot, 'mcp.json');
    const config = await readJson(configPath, { mcpServers: {} });
    config.mcpServers ||= {};
    const ownedEntry = {
      type: 'stdio',
      command: this.launcher('HamsterArchiver-MCP.cmd'),
      args: [],
      timeout: 30000
    };
    const state = await this.state();
    const previous = state.adapters.workbuddy;
    if (config.mcpServers['hamster-archiver'] && !previous) {
      throw codedError('INTEGRATION_TARGET_EXISTS', 'WorkBuddy already has an unmanaged hamster-archiver entry.', 'integration', {
        requiredAction: 'review_host_config'
      });
    }
    if (previous?.entryDigest && config.mcpServers['hamster-archiver'] &&
        digest(JSON.stringify(config.mcpServers['hamster-archiver'])) !== previous.entryDigest) {
      throw codedError('INTEGRATION_USER_MODIFIED', 'The WorkBuddy Hamster entry was edited and was not overwritten.', 'integration', {
        requiredAction: 'review_host_config'
      });
    }
    await this.writeOwnedFiles('workbuddy', files);
    config.mcpServers['hamster-archiver'] = ownedEntry;
    await writeJsonAtomic(configPath, config);
    const next = await this.state();
    next.adapters.workbuddy.configPath = configPath;
    next.adapters.workbuddy.entryDigest = digest(JSON.stringify(ownedEntry));
    await this.saveState(next);
    return this.status('workbuddy');
  }

  async installGenericMcp() {
    const target = path.join(this.userDataRoot, 'integrations', 'generic-mcp.json');
    const value = {
      mcpServers: {
        'hamster-archiver': {
          type: 'stdio',
          command: this.launcher('HamsterArchiver-MCP.cmd'),
          args: []
        }
      }
    };
    await this.writeOwnedFiles('generic-mcp', [{ path: target, content: `${JSON.stringify(value, null, 2)}\n` }]);
    return this.status('generic-mcp');
  }

  async odrExecutable() {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const candidates = [path.join(systemRoot, 'System32', 'odr.exe'), 'odr.exe'];
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && await pathExists(candidate)) return candidate;
    }
    return '';
  }

  async installWindowsOdr() {
    const odr = await this.odrExecutable();
    if (!odr) throw codedError('ODR_UNAVAILABLE', 'Windows ODR is not available on this system.', 'integration');
    if (!this.packagedWithIdentity) {
      throw codedError('ODR_PACKAGE_IDENTITY_REQUIRED', 'Safe ODR registration requires package identity. This NSIS build will not ask you to reduce Windows agent-connector protections.', 'integration', {
        requiredAction: 'use_future_package_identity_build'
      });
    }
    const manifest = path.join(this.templatesRoot, 'windows-odr', 'manifest.json');
    await run(odr, ['mcp', 'add', manifest]);
    const listed = await run(odr, ['list']);
    if (!listed.stdout.toLowerCase().includes('hamster')) throw codedError('ODR_REGISTRATION_NOT_VISIBLE', 'ODR did not list the Hamster server after registration.', 'integration');
    const state = await this.state();
    state.adapters['windows-odr'] = { enabled: true, serverId: 'hamster-archiver', updatedAt: new Date().toISOString() };
    await this.saveState(state);
    return this.status('windows-odr');
  }

  async install(adapterId, options = {}) {
    if (adapterId === 'codex-skill') return this.installCodexSkill(options);
    if (adapterId === 'codex-mcp') return this.installCodexMcp();
    if (adapterId === 'workbuddy') return this.installWorkBuddy();
    if (adapterId === 'generic-mcp') return this.installGenericMcp();
    if (adapterId === 'windows-odr') return this.installWindowsOdr();
    throw codedError('UNKNOWN_INTEGRATION', `Unknown integration: ${adapterId}`, 'integration');
  }

  async uninstall(adapterId) {
    const state = await this.state();
    const owned = state.adapters[adapterId];
    if (!owned) return this.status(adapterId);
    // Validate every owned file before removing any of them, so a user edit
    // never leaves the adapter half-uninstalled.
    for (const file of owned.files || []) {
      if (!await pathExists(file.path)) continue;
      const content = await fs.readFile(file.path);
      if (digest(content) !== file.digest) {
        throw codedError('INTEGRATION_USER_MODIFIED', `The user modified ${file.path}; no managed files were removed.`, 'integration');
      }
    }
    if (adapterId === 'codex-mcp') {
      const source = await readText(owned.configPath);
      if (source.includes(OWNED_BEGIN) || source.includes(OWNED_END)) {
        const managed = source.slice(source.indexOf(OWNED_BEGIN), source.indexOf(OWNED_END) + OWNED_END.length);
        if (digest(managed) !== owned.managedBlockDigest) throw codedError('INTEGRATION_USER_MODIFIED', 'The Codex MCP block was edited and was not removed.', 'integration');
        await atomicText(owned.configPath, replaceManagedBlock(source, '', { remove: true }));
      }
    } else if (adapterId === 'workbuddy') {
      const config = await readJson(owned.configPath, { mcpServers: {} });
      const entry = config.mcpServers?.['hamster-archiver'];
      if (entry && digest(JSON.stringify(entry)) !== owned.entryDigest) throw codedError('INTEGRATION_USER_MODIFIED', 'The WorkBuddy entry was edited and was not removed.', 'integration');
      if (entry) {
        delete config.mcpServers['hamster-archiver'];
        await writeJsonAtomic(owned.configPath, config);
      }
    }
    for (const file of owned.files || []) {
      if (!await pathExists(file.path)) continue;
      await fs.rm(file.path, { force: true });
    }
    if (adapterId === 'windows-odr' && owned.enabled) {
      const odr = await this.odrExecutable();
      if (odr) await run(odr, ['mcp', 'remove', owned.serverId || 'hamster-archiver']);
    }
    delete state.adapters[adapterId];
    await this.saveState(state);
    return this.status(adapterId);
  }

  async repair(adapterId, options = {}) {
    return this.install(adapterId, options);
  }

  async detect(adapterId = '') {
    return this.status(adapterId);
  }

  async status(adapterId = '') {
    const ids = adapterId ? [adapterId] : ['codex-skill', 'codex-mcp', 'workbuddy', 'generic-mcp', 'windows-odr'];
    const state = await this.state();
    const results = [];
    for (const id of ids) {
      const owned = state.adapters[id];
      let modified = false;
      let missing = false;
      for (const file of owned?.files || []) {
        if (!await pathExists(file.path)) missing = true;
        else if (digest(await fs.readFile(file.path)) !== file.digest) modified = true;
      }
      if (id === 'codex-mcp' && owned?.configPath) {
        const source = await readText(owned.configPath);
        const start = source.indexOf(OWNED_BEGIN);
        const end = source.indexOf(OWNED_END);
        missing = start < 0 && end < 0;
        modified = (start < 0) !== (end < 0) || (start >= 0 && end < start) ||
          (start >= 0 && digest(source.slice(start, end + OWNED_END.length)) !== owned.managedBlockDigest);
      }
      if (id === 'workbuddy' && owned?.configPath) {
        const config = await readJson(owned.configPath, { mcpServers: {} });
        const entry = config.mcpServers?.['hamster-archiver'];
        if (!entry) missing = true;
        else if (digest(JSON.stringify(entry)) !== owned.entryDigest) modified = true;
      }
      const odrAvailable = id === 'windows-odr' ? Boolean(await this.odrExecutable()) : undefined;
      results.push({
        id,
        enabled: Boolean(owned?.enabled),
        modified,
        missing,
        ...(id === 'windows-odr' ? { preview: true, available: odrAvailable && this.packagedWithIdentity, odrAvailable, packageIdentity: this.packagedWithIdentity } : {}),
        ...(id === 'generic-mcp' && owned?.files?.[0] ? { exportPath: owned.files[0].path } : {}),
        ...(owned?.explicitOnly !== undefined ? { explicitOnly: owned.explicitOnly } : {})
      });
    }
    return adapterId ? results[0] : results;
  }
}

module.exports = { IntegrationManager, OWNED_BEGIN, OWNED_END, digest, replaceManagedBlock };
