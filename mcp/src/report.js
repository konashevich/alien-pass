/**
 * Safe status report helpers — never include secrets.
 */
'use strict';

function buildReport(partial = {}) {
  return {
    ok: Boolean(partial.ok),
    site: partial.site || null,
    username: partial.username || null,
    method: partial.method || null,
    login_index: partial.login_index != null ? partial.login_index : null,
    evidence: partial.evidence || null,
    error_code: partial.error_code || null,
    message: partial.message || null,
    duration_ms: partial.duration_ms != null ? partial.duration_ms : null,
    // Explicitly document absence of secrets for cloud agents
    secrets_included: false
  };
}

const REPORT_SCHEMA = {
  ok: 'boolean',
  site: 'string|null',
  username: 'string|null',
  method: "'alienpass-v2'|'keyring'|null",
  login_index: 'number|null',
  evidence: 'string|null',
  error_code: 'string|null',
  message: 'string|null (non-secret)',
  duration_ms: 'number|null',
  secrets_included: 'always false'
};

module.exports = { buildReport, REPORT_SCHEMA };
