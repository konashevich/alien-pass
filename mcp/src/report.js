/**
 * Safe status report helpers — never include secrets.
 */
'use strict';

const ALLOWED_METHODS = new Set(['alienpass-v2', 'alienpass-v2-compose', 'keyring', null]);

const EVIDENCE_MAX = 240;
const MESSAGE_MAX = 240;

/** Patterns that suggest accidental secret inclusion. */
const SUSPICIOUS =
  /(password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|mnemonic|input_string\s*[:=]|bearer\s+[a-z0-9]|[A-Za-z0-9+/=]{40,})/i;

function scrubText(value, max) {
  if (value == null) return null;
  let text = String(value);
  if (SUSPICIOUS.test(text)) {
    return '[redacted_suspicious_content]';
  }
  // Collapse Playwright multi-line stacks into one line, truncate.
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text || null;
}

function buildReport(partial = {}) {
  let method = partial.method || null;
  if (!ALLOWED_METHODS.has(method)) method = null;

  return {
    ok: Boolean(partial.ok),
    site: partial.site ? String(partial.site).slice(0, 512) : null,
    username: partial.username ? String(partial.username).slice(0, 320) : null,
    method,
    login_index: partial.login_index != null ? partial.login_index : null,
    evidence: scrubText(partial.evidence, EVIDENCE_MAX),
    error_code: partial.error_code ? String(partial.error_code).slice(0, 80) : null,
    message: scrubText(partial.message, MESSAGE_MAX),
    duration_ms: partial.duration_ms != null ? partial.duration_ms : null,
    verified: partial.verified != null ? Boolean(partial.verified) : Boolean(partial.ok),
    secrets_included: false
  };
}

const REPORT_SCHEMA = {
  ok: 'boolean',
  site: 'string|null',
  username: 'string|null',
  method: "'alienpass-v2'|'alienpass-v2-compose'|'keyring'|null",
  login_index: 'number|null',
  evidence: 'string|null (scrubbed, non-secret codes preferred)',
  error_code: 'string|null',
  message: 'string|null (scrubbed)',
  duration_ms: 'number|null',
  verified: 'boolean',
  secrets_included: 'always false — formatter also redacts suspicious content'
};

module.exports = { buildReport, REPORT_SCHEMA, scrubText };
