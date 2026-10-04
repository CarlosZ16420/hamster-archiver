'use strict';

const TASK_STATUS_VALUES = [
  'accepted', 'preparing', 'queued', 'running', 'needs_input', 'needs_confirmation',
  'paused', 'completed', 'completed_with_warnings', 'partial_failed', 'failed',
  'cancelling', 'cancelled', 'recovery_required'
];
const JOB_STATUS_VALUES = [
  'queued', 'inventorying', 'compressing', 'verifying', 'moving', 'cancelling',
  'awaiting_confirmation', 'awaiting_duplicate_confirmation',
  'awaiting_source_change_confirmation', 'awaiting_anomaly_confirmation',
  'awaiting_trash_safety_confirmation', 'completed', 'completed_cleanup_failed',
  'skipped_duplicate', 'failed', 'cancelled'
];
const TASK_OUTCOME_VALUES = [
  'pending', 'needs_input', 'no_change', 'created', 'updated', 'already_present',
  'skipped', 'completed', 'partial_failed', 'failed', 'cancelled', 'recovery_required'
];

const stableCapabilities = Object.freeze([
  { name: 'intake.submit', cli: 'intake', readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'task.get', cli: 'task get', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.wait', cli: 'task wait', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.resolve', cli: null, readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'task.retry', cli: null, readOnly: false, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.start', cli: 'task start', readOnly: false, risk: 'none', resultSchemaVersion: 1 },
  { name: 'task.cancel', cli: null, readOnly: false, risk: 'conditional', resultSchemaVersion: 1 },
  { name: 'catalog.search', cli: 'search', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'catalog.details', cli: 'project', readOnly: true, risk: 'none', resultSchemaVersion: 1 },
  { name: 'catalog.add_tags', cli: 'tag', readOnly: false, risk: 'none', resultSchemaVersion: 1 }
]);

function createAutomationManifest(version, options = {}) {
  return {
    schemaVersion: 3,
    version,
    platform: options.platform || 'win32-x64',
    launchers: options.launchers || { cli: 'hamster.cmd', mcp: 'HamsterArchiver-MCP.cmd' },
    defaultInterface: 'cli',
    cliCommands: ['intake', 'search', 'project', 'tag', 'task', 'capabilities', 'describe', 'call', 'doctor', 'mcp'],
    mcpTools: ['hamster_discover', 'hamster_describe', 'hamster_call'],
    stableCapabilities: stableCapabilities.map((entry) => entry.name),
    taskStatuses: TASK_STATUS_VALUES,
    jobStatuses: JOB_STATUS_VALUES,
    taskOutcomes: TASK_OUTCOME_VALUES,
    taskReceiptSchemaVersions: [1, 2],
    v2ReceiptSchema: 'docs/AI-TASK-RECEIPT-v2.schema.json',
    instructions: 'llms.txt'
  };
}

module.exports = { JOB_STATUS_VALUES, TASK_OUTCOME_VALUES, TASK_STATUS_VALUES,
  createAutomationManifest, stableCapabilities };
