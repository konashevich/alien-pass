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

function createCredentialService(options = {}) {
  const mode = String(options.mode || process.env.ALIENPASS_MODE || 'compose').toLowerCase();
  const allowReveal =
    options.allowReveal != null
      ? Boolean(options.allowReveal)
      : process.env.ALIENPASS_ALLOW_REVEAL === '1';
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
    return {
      password: out.password,
      method: 'alienpass-v2-compose',
      login,
      parsedLogin: out.parsed,
      engine: out.engine,
      site_id: profile.id,
      username: out.parsed.login,
      _debug_input_string: assembled.inputString
    };
  }

  async function resolvePassword(args = {}) {
    const { username, domain, login_index, input_string, site, site_id } = args;

    if (mode === 'keyring') {
      const login = engine.withIndex(username, login_index == null ? 1 : login_index);
      const parsedLogin = engine.parseLoginString(login);
      const stored = keyring.lookup({
        username: parsedLogin.login,
        domain: domainOrStar(domain || site),
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
    let inputString = input_string && String(input_string).trim();
    if (!inputString) {
      inputString = keyring.lookup({
        username: parsedLogin.login,
        domain: domainOrStar(domain),
        kind: 'mnemonic'
      });
    }
    if (!inputString) {
      throw Object.assign(new Error('keyring_miss'), { code: 'keyring_miss' });
    }

    const out = await engine.generatePassword({ login, inputString });
    return {
      password: out.password,
      method: 'alienpass-v2',
      login,
      parsedLogin: out.parsed,
      engine: out.engine,
      username: out.parsed.login,
      _debug_input_string: inputString
    };
  }

  function authStatus({ username, domain, site, kind } = {}) {
    if (mode === 'compose' || kind === 'compose' || kind === 'master') {
      const profile = siteDirectory.resolve(site || domain || '');
      return {
        mode,
        master_present: siteDirectory.hasMaster(),
        site_id: profile ? profile.id : null,
        profile_present: Boolean(profile),
        username: username || (profile && profile.username) || null,
        keyring_backend: keyring.backend
      };
    }
    const resolvedKind = kind || (mode === 'keyring' ? 'password' : 'mnemonic');
    const secret = keyring.lookup({
      username: String(username || '').trim(),
      domain: domainOrStar(domain),
      kind: resolvedKind
    });
    return {
      username: String(username || '').trim(),
      domain: domainOrStar(domain),
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
    keyring,
    siteDirectory,
    methodLabel,
    resolvePassword,
    authStatus,
    listAccounts,
    domainOrStar,
    engine,
    fingerprint(value) {
      return keyring.fingerprint(value);
    }
  };
}

module.exports = { createCredentialService, domainOrStar };
