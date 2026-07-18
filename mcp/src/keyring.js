/**
 * Linux keyring backend via secret-tool (libsecret), with a file fallback
 * for headless/dev environments where Secret Service is unavailable.
 *
 * Prefer secret-tool on real Linux desktops (incl. arm64).
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVICE = 'alienpass-mcp';

function fallbackPath() {
  const override = process.env.ALIENPASS_FALLBACK_STORE;
  if (override) return override;
  return path.join(os.homedir(), '.local', 'share', 'alienpass-mcp', 'store.json');
}

function hasSecretTool() {
  if (process.env.ALIENPASS_FORCE_FALLBACK === '1') return false;
  const result = spawnSync('secret-tool', ['--version'], { encoding: 'utf8' });
  // secret-tool may not support --version; treat "not found" only as missing
  if (result.error && result.error.code === 'ENOENT') return false;
  return true;
}

function readFallback() {
  const file = fallbackPath();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function writeFallback(data) {
  const file = fallbackPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function entryKey(attrs) {
  return [attrs.kind, attrs.username, attrs.domain || '*'].join('\0');
}

function storeFallback(attrs, secret) {
  const data = readFallback();
  const key = entryKey(attrs);
  data.entries = (data.entries || []).filter((e) => entryKey(e.attrs) !== key);
  data.entries.push({
    attrs: {
      service: SERVICE,
      username: attrs.username,
      domain: attrs.domain || '*',
      kind: attrs.kind
    },
    secret
  });
  writeFallback(data);
}

function lookupFallback(attrs) {
  const data = readFallback();
  const exact = (data.entries || []).find(
    (e) =>
      e.attrs.kind === attrs.kind &&
      e.attrs.username === attrs.username &&
      e.attrs.domain === (attrs.domain || '*')
  );
  if (exact) return exact.secret;

  if (attrs.domain && attrs.domain !== '*') {
    const wildcard = (data.entries || []).find(
      (e) =>
        e.attrs.kind === attrs.kind &&
        e.attrs.username === attrs.username &&
        e.attrs.domain === '*'
    );
    if (wildcard) return wildcard.secret;
  }
  return null;
}

function listFallback() {
  return (readFallback().entries || []).map((e) => ({
    username: e.attrs.username,
    domain: e.attrs.domain,
    kind: e.attrs.kind,
    backend: 'file-fallback'
  }));
}

function secretToolStore(attrs, secret) {
  const args = [
    'store',
    '--label',
    `alienpass ${attrs.kind} ${attrs.username}@${attrs.domain || '*'}`,
    'service',
    SERVICE,
    'username',
    attrs.username,
    'domain',
    attrs.domain || '*',
    'kind',
    attrs.kind
  ];
  const result = spawnSync('secret-tool', args, {
    input: secret,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`secret-tool store failed: ${result.stderr || result.stdout || result.status}`);
  }
}

function secretToolLookup(attrs) {
  const tryLookup = (domain) => {
    const result = spawnSync(
      'secret-tool',
      [
        'lookup',
        'service',
        SERVICE,
        'username',
        attrs.username,
        'domain',
        domain,
        'kind',
        attrs.kind
      ],
      { encoding: 'utf8' }
    );
    if (result.status === 0 && result.stdout != null) {
      return String(result.stdout).replace(/\n$/, '');
    }
    return null;
  };

  const domain = attrs.domain || '*';
  const hit = tryLookup(domain);
  if (hit != null) return hit;
  if (domain !== '*') return tryLookup('*');
  return null;
}

function secretToolClear(attrs) {
  spawnSync(
    'secret-tool',
    [
      'clear',
      'service',
      SERVICE,
      'username',
      attrs.username,
      'domain',
      attrs.domain || '*',
      'kind',
      attrs.kind
    ],
    { encoding: 'utf8' }
  );
}

function createKeyring() {
  const useSecretTool = hasSecretTool();

  return {
    backend: useSecretTool ? 'libsecret' : 'file-fallback',
    store(attrs, secret) {
      if (!attrs.username) throw new Error('username is required');
      if (!attrs.kind) throw new Error('kind is required');
      if (secret == null || secret === '') throw new Error('secret must be non-empty');
      if (useSecretTool) secretToolStore(attrs, String(secret));
      else storeFallback(attrs, String(secret));
      return { ok: true, backend: this.backend };
    },
    lookup(attrs) {
      if (!attrs.username) throw new Error('username is required');
      if (!attrs.kind) throw new Error('kind is required');
      if (useSecretTool) return secretToolLookup(attrs);
      return lookupFallback(attrs);
    },
    clear(attrs) {
      if (useSecretTool) secretToolClear(attrs);
      else {
        const data = readFallback();
        const key = entryKey({
          kind: attrs.kind,
          username: attrs.username,
          domain: attrs.domain || '*'
        });
        data.entries = (data.entries || []).filter((e) => entryKey(e.attrs) !== key);
        writeFallback(data);
      }
      return { ok: true };
    },
    list() {
      if (!useSecretTool) return listFallback();
      // secret-tool has no portable list-all; return capability note
      return {
        backend: 'libsecret',
        note: 'Use auth_status for existence checks; full listing requires file-fallback or a custom schema browser.',
        accounts: []
      };
    },
    /** Constant-time-ish wipe helper for callers holding secrets in strings is best-effort in JS. */
    fingerprint(secret) {
      return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 12);
    }
  };
}

module.exports = { createKeyring, SERVICE };
