/**
 * Linux keyring backend via secret-tool (libsecret), with an encrypted
 * file fallback for headless/dev when Secret Service is unavailable.
 *
 * Fallback encrypts secrets at rest (AES-256-GCM). The local key file is
 * mode 0600 — weaker than a locked desktop keyring; doctor warns.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVICE = 'alienpass-mcp';

function dataDir() {
  return path.join(os.homedir(), '.local', 'share', 'alienpass-mcp');
}

function fallbackPath() {
  const override = process.env.ALIENPASS_FALLBACK_STORE;
  if (override) return override;
  return path.join(dataDir(), 'store.vault');
}

function fallbackKeyPath() {
  const store = fallbackPath();
  return `${store}.key`;
}

function probeSecretService() {
  if (process.env.ALIENPASS_FORCE_FALLBACK === '1') {
    return { ok: false, reason: 'ALIENPASS_FORCE_FALLBACK=1' };
  }

  const which = spawnSync('secret-tool', ['lookup', 'service', '__alienpass_probe__'], {
    encoding: 'utf8'
  });
  if (which.error && which.error.code === 'ENOENT') {
    return { ok: false, reason: 'secret-tool_not_found' };
  }

  // Binary exists. Probe store+clear with a disposable attribute set.
  const probeUser = `__probe_${process.pid}__`;
  const store = spawnSync(
    'secret-tool',
    [
      'store',
      '--label',
      'alienpass-mcp probe',
      'service',
      SERVICE,
      'username',
      probeUser,
      'domain',
      '*',
      'kind',
      'probe'
    ],
    { input: 'probe', encoding: 'utf8' }
  );
  if (store.status !== 0) {
    return {
      ok: false,
      reason: 'secret_service_unavailable',
      detail: String(store.stderr || store.stdout || '').trim() || `status=${store.status}`
    };
  }

  spawnSync(
    'secret-tool',
    ['clear', 'service', SERVICE, 'username', probeUser, 'domain', '*', 'kind', 'probe'],
    { encoding: 'utf8' }
  );
  return { ok: true };
}

function ensureFallbackKey() {
  const keyFile = fallbackKeyPath();
  try {
    const existing = fs.readFileSync(keyFile);
    if (existing.length === 32) return existing;
  } catch {
    // create below
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}

function encryptPayload(key, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64')
  };
}

function decryptPayload(key, blob) {
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function readFallback() {
  const file = fallbackPath();
  if (!fs.existsSync(file)) return { entries: [] };

  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error('fallback_store_corrupt'), {
      code: 'fallback_store_corrupt',
      cause: error
    });
  }

  // Migrate legacy plaintext store.json → encrypted vault once.
  if (parsed && Array.isArray(parsed.entries) && !parsed.v) {
    const migrated = { entries: parsed.entries };
    writeFallback(migrated);
    return migrated;
  }

  if (!parsed || parsed.v !== 2) {
    throw Object.assign(new Error('unsupported_fallback_format'), {
      code: 'unsupported_fallback_format'
    });
  }

  try {
    return decryptPayload(ensureFallbackKey(), parsed);
  } catch (error) {
    throw Object.assign(new Error('fallback_decrypt_failed'), {
      code: 'fallback_decrypt_failed',
      cause: error
    });
  }
}

function writeFallback(data) {
  const file = fallbackPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const blob = encryptPayload(ensureFallbackKey(), { entries: data.entries || [] });
  fs.writeFileSync(file, JSON.stringify(blob, null, 2), { mode: 0o600 });
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
    backend: 'file-fallback-encrypted'
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
    throw Object.assign(
      new Error(`secret-tool store failed: ${result.stderr || result.stdout || result.status}`),
      { code: 'secret_tool_store_failed' }
    );
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
      return { value: String(result.stdout).replace(/\n$/, ''), error: null };
    }
    const errText = String(result.stderr || '').toLowerCase();
    if (
      errText.includes('cannot') ||
      errText.includes('unavailable') ||
      errText.includes('dbus') ||
      result.error
    ) {
      return {
        value: null,
        error: Object.assign(new Error('secret_service_unavailable'), {
          code: 'secret_service_unavailable',
          detail: String(result.stderr || result.error || '')
        })
      };
    }
    return { value: null, error: null };
  };

  const domain = attrs.domain || '*';
  const hit = tryLookup(domain);
  if (hit.error) throw hit.error;
  if (hit.value != null) return hit.value;
  if (domain !== '*') {
    const wild = tryLookup('*');
    if (wild.error) throw wild.error;
    return wild.value;
  }
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
  const probe = probeSecretService();
  const useSecretTool = probe.ok;

  return {
    backend: useSecretTool ? 'libsecret' : 'file-fallback-encrypted',
    backend_reason: useSecretTool ? null : probe.reason,
    backend_detail: useSecretTool ? null : probe.detail || null,
    insecure_relative_to_libsecret: !useSecretTool,
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
      return {
        backend: 'libsecret',
        note: 'Use auth_status for existence checks; full listing requires file-fallback or a custom schema browser.',
        accounts: []
      };
    }
  };
}

module.exports = {
  createKeyring,
  SERVICE,
  fallbackPath,
  probeSecretService
};
