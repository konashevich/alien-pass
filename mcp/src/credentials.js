/**
 * Shared credential resolution for MCP + CLI.
 */
'use strict';

const engine = require('./alienpass-engine');
const { createKeyring } = require('./keyring');
const { assembleInputString } = require('./mnemonic-compose');
const { createSiteDirectory } = require('./site-directory');

function domainOrStar(domain) {
  const d = String(domain || '').trim();
  return d || '*';
}

/**
 * Normalize a URL, host, or bare domain into a keyring/site hostname.
 */
function normalizeHostname(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '*') return '*';
  if (raw.startsWith('file:')) return 'file';
  try {
    if (raw.includes('://')) {
      return new URL(raw).hostname.toLowerCase().replace(/^www\./, '') || '*';
    }
  } catch {
    // fall through
  }
  const host = raw
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .toLowerCase()
    .replace(/^www\./, '');
  return host || '*';
}

function lookupDomain(domain, site) {
  if (domain && String(domain).trim()) return normalizeHostname(domain);
  if (site && String(site).trim()) return normalizeHostname(site);
  return '*';
}

function createCredentialService(options = {}) {
  const mode = String(options.mode || process.env.ALIENPASS_MODE || 'compose').toLowerCase();
  const allowReveal =
    options.allowReveal != null
      ? Boolean(options.allowReveal)
      : process.env.ALIENPASS_ALLOW_REVEAL === '1';
  const allowRevealMnemonic = process.env.ALIENPASS_ALLOW_REVEAL_MNEMONIC === '1';
  const keyring = options.keyring || createKeyring();
  const siteDirectory = options.siteDirectory || createSiteDirectory(keyring);

  function methodLabel() {
    if (mode === 'keyring') return 'keyring';
    if (mode === 'compose') return 'alienpass-v2-compose';
    return 'alienpass-v2';
  }

  async function resolveComposedPassword({ username, site, login_index, input_string, site_id }) {
    if (input_string && String(input_string).trim()) {
      const login = engine.withIndex(username, login_index == null ? 1 : login_index);
      const out = await engine.generatePassword({
        login,
        inputString: String(input_string).trim()
      });
      return {
        password: out.password,
        method: 'alienpass-v2',
        login,
        parsedLogin: out.parsed,
        engine: out.engine,
        site_id: null,
        username: out.parsed.login
      };
    }

    const profile = siteDirectory.resolveFlexible({
      site: site || '',
      username,
      site_id
    });
    if (!profile) {
      throw Object.assign(new Error('site_profile_miss'), { code: 'site_profile_miss' });
    }

    const master = siteDirectory.getMaster();
    if (!master) {
      throw Object.assign(new Error('master_missing'), { code: 'master_missing' });
    }

    const assembled = assembleInputString({
      siteToken: profile.token,
      masterSecret: master,
      casing: profile.casing,
      modifiers: profile.modifiers
    });

    const index =
      login_index == null ? (profile.login_index == null ? 1 : profile.login_index) : login_index;
    const user = username || profile.username;
    if (!user) {
      throw Object.assign(new Error('username_required'), { code: 'username_required' });
    }

    const login = engine.withIndex(user, index);
    const out = await engine.generatePassword({ login, inputString: assembled.inputString });
    const result = {
      password: out.password,
      method: 'alienpass-v2-compose',
      login,
      parsedLogin: out.parsed,
      engine: out.engine,
      site_id: profile.id,
      username: out.parsed.login
    };
    // Never attach mnemonic unless an explicit separate debug gate is set.
    if (allowRevealMnemonic) result._debug_input_string = assembled.inputString;
    return result;
  }

  async function resolvePassword(args = {}) {
    const { username, domain, login_index, input_string, site, site_id } = args;

    if (mode === 'keyring') {
      const login = engine.withIndex(username, login_index == null ? 1 : login_index);
      const parsedLogin = engine.parseLoginString(login);
      const host = lookupDomain(domain, site);
      const stored = keyring.lookup({
        username: parsedLogin.login,
        domain: domainOrStar(host),
        kind: 'password'
      });
      if (!stored) {
        throw Object.assign(new Error('keyring_miss'), { code: 'keyring_miss' });
      }
      return {
        password: stored,
        method: 'keyring',
        login,
        parsedLogin,
        username: parsedLogin.login
      };
    }

    if (mode === 'compose') {
      return resolveComposedPassword({
        username,
        site: site || domain,
        login_index,
        input_string,
        site_id
      });
    }

    const login = engine.withIndex(username, login_index == null ? 1 : login_index);
    const parsedLogin = engine.parseLoginString(login);
    const host = lookupDomain(domain, site);
    let inputString = input_string && String(input_string).trim();
    if (!inputString) {
      inputString = keyring.lookup({
        username: parsedLogin.login,
        domain: domainOrStar(host),
        kind: 'mnemonic'
      });
    }
    if (!inputString) {
      throw Object.assign(new Error('keyring_miss'), { code: 'keyring_miss' });
    }

    const out = await engine.generatePassword({ login, inputString });
    const result = {
      password: out.password,
      method: 'alienpass-v2',
      login,
      parsedLogin: out.parsed,
      engine: out.engine,
      username: out.parsed.login
    };
    if (allowRevealMnemonic) result._debug_input_string = inputString;
    return result;
  }

  function authStatus({ username, domain, site, kind } = {}) {
    if (mode === 'compose' || kind === 'compose' || kind === 'master') {
      const profile = siteDirectory.resolveFlexible({
        site: site || domain || '',
        username
      });
      return {
        mode,
        master_present: siteDirectory.hasMaster(),
        site_id: profile ? profile.id : null,
        profile_present: Boolean(profile),
        username: username || (profile && profile.username) || null,
        keyring_backend: keyring.backend,
        keyring_warning: keyring.insecure_relative_to_libsecret
          ? 'file-fallback-encrypted is weaker than a locked desktop keyring'
          : null
      };
    }
    const resolvedKind = kind || (mode === 'keyring' ? 'password' : 'mnemonic');
    const host = lookupDomain(domain, site);
    const secret = keyring.lookup({
      username: String(username || '').trim(),
      domain: domainOrStar(host),
      kind: resolvedKind
    });
    return {
      username: String(username || '').trim(),
      domain: domainOrStar(host),
      kind: resolvedKind,
      present: Boolean(secret),
      backend: keyring.backend,
      mode
    };
  }

  function listAccounts() {
    if (mode === 'compose') {
      return {
        mode,
        master_present: siteDirectory.hasMaster(),
        directory: siteDirectory.listPublic(),
        keyring_backend: keyring.backend
      };
    }
    return keyring.list();
  }

  return {
    mode,
    allowReveal,
    allowRevealMnemonic,
    keyring,
    siteDirectory,
    methodLabel,
    resolvePassword,
    authStatus,
    listAccounts,
    domainOrStar,
    normalizeHostname,
    engine
  };
}

module.exports = { createCredentialService, domainOrStar, normalizeHostname };
