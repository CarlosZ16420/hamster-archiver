'use strict';

const TASK_STATUS_VALUES = [
  'accepted', 'preparing', 'queued', 'running', 'needs_input', 'needs_confirmation',
  'paused', 'completed', 'completed_with_warnings', 'partial_failed', 'failed',
  'cancelling', 'cancelled', 'recovery_required'
];

const stableCapabilities = Object.freeze([
  { name: 'intake.submit', cli: 'intake', readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'task.get', cli: 'task get', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.wait', cli: 'task wait', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.resolve', cli: null, readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'task.retry', cli: null, readOnly: false, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.cancel', cli: null, readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'catalog.search', cli: 'search', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'catalog.details', cli: 'project', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'catalog.add_tags', cli: 'tag', readOnly: false, risk: 'none', resultSchemaVersion: 1 }
]);

function createAutomationManifest(version) {
  return {
    schemaVersion: 3,
    version,
    platform: 'win32-x64',
    launchers: { cli: 'hamster.cmd', mcp: 'HamsterArchiver-MCP.cmd' },
    defaultInterface: 'cli',
    cliCommands: ['intake', 'search', 'project', 'tag', 'task', 'capabilities', 'describe', 'call', 'doctor', 'mcp'],
    mcpTools: ['hamster_discover', 'hamster_describe', 'hamster_call'],
    stableCapabilities: stableCapabilities.map((entry) => entry.name),
    taskStatuses: TASK_STATUS_VALUES,
    instructions: 'llms.txt'
  };
}

module.exports = { TASK_STATUS_VALUES, createAutomationManifest, stableCapabilities };
