#!/usr/bin/env node
/**
 * AlienPass MCP server (stdio).
 *
 * Attach ONLY to a local Cursor subagent / local-model profile.
 * Never register this server on a cloud proprietary agent that must not see secrets.
 *
 * Env:
 *   ALIENPASS_MODE=compose|alienpass|keyring  (default: compose)
 *   ALIENPASS_ALLOW_REVEAL=0|1                (default: 0)
 *   ALIENPASS_FORCE_FALLBACK=1                (file keyring instead of libsecret)
 *   ALIENPASS_FALLBACK_STORE=path
 *   ALIENPASS_SITE_VAULT=path                 (encrypted site directory)
 */
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const engine = require('./alienpass-engine');
const { createKeyring } = require('./keyring');
const { buildReport, REPORT_SCHEMA } = require('./report');
const { assembleInputString } = require('./mnemonic-compose');
const { createSiteDirectory } = require('./site-directory');

const MODE = (process.env.ALIENPASS_MODE || 'compose').toLowerCase();
const ALLOW_REVEAL = process.env.ALIENPASS_ALLOW_REVEAL === '1';
const keyring = createKeyring();
const siteDirectory = createSiteDirectory(keyring);

function textResult(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }]
  };
}

function domainOrStar(domain) {
  const d = String(domain || '').trim();
  return d || '*';
}

function methodLabel() {
  if (MODE === 'keyring') return 'keyring';
  if (MODE === 'compose') return 'alienpass-v2-compose';
  return 'alienpass-v2';
}

/**
 * Compose path: site token (encrypted directory) + master (keyring) → InputString.
 * Never expose token/master/assembled mnemonic to tool callers unless reveal is on.
 */
async function resolveComposedPassword({ username, site, login_index, input_string }) {
  if (input_string && String(input_string).trim()) {
    const login = engine.withIndex(username, login_index == null ? 1 : login_index);
    const out = await engine.generatePassword({ login, inputString: String(input_string).trim() });
    return {
      password: out.password,
      method: 'alienpass-v2',
      login,
      parsedLogin: out.parsed,
      engine: out.engine,
      site_id: null
    };
  }

  const profile = siteDirectory.resolve(site || '');
  if (!profile) {
    const err = new Error('site_profile_miss');
    err.code = 'site_profile_miss';
    throw err;
  }

  const master = siteDirectory.getMaster();
  if (!master) {
    const err = new Error('master_missing');
    err.code = 'master_missing';
    throw err;
  }

  const assembled = assembleInputString({
    siteToken: profile.token,
    masterSecret: master,
    casing: profile.casing,
    modifiers: profile.modifiers
  });

  const index = login_index == null ? profile.login_index == null ? 1 : profile.login_index : login_index;
  const user = username || profile.username;
  if (!user) {
    const err = new Error('username_required');
    err.code = 'username_required';
    throw err;
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
    // retained only for gated reveal debugging — callers must not log this
    _debug_input_string: assembled.inputString
  };
}

async function resolvePassword({ username, domain, login_index, input_string, site }) {
  if (MODE === 'keyring') {
    const login = engine.withIndex(username, login_index == null ? 1 : login_index);
    const stored = keyring.lookup({
      username: engine.parseLoginString(login).login,
      domain: domainOrStar(domain),
      kind: 'password'
    });
    if (!stored) {
      const err = new Error('keyring_miss');
      err.code = 'keyring_miss';
      throw err;
    }
    return { password: stored, method: 'keyring', login, parsedLogin: engine.parseLoginString(login) };
  }

  if (MODE === 'compose') {
    return resolveComposedPassword({ username, site: site || domain, login_index, input_string });
  }

  // Legacy Mode A: full InputString stored per username/domain
  const login = engine.withIndex(username, login_index == null ? 1 : login_index);
  let inputString = input_string && String(input_string).trim();
  if (!inputString) {
    inputString = keyring.lookup({
      username: engine.parseLoginString(login).login,
      domain: domainOrStar(domain),
      kind: 'mnemonic'
    });
  }
  if (!inputString) {
    const err = new Error('keyring_miss');
    err.code = 'keyring_miss';
    throw err;
  }

  const out = await engine.generatePassword({ login, inputString });
  return {
    password: out.password,
    method: 'alienpass-v2',
    login,
    parsedLogin: out.parsed,
    engine: out.engine
  };
}

const server = new McpServer({
  name: 'alienpass-mcp',
  version: '0.1.0'
});

server.tool(
  'report_template',
  'Return the non-secret sign-in report schema safe to send to a cloud main agent.',
  {},
  async () => textResult({ schema: REPORT_SCHEMA, example: buildReport({ ok: true, method: 'alienpass-v2' }) })
);

server.tool(
  'auth_status',
  'Check whether secrets/profiles exist (no secret values returned).',
  {
    username: z.string().optional().describe('Email / login base without ,index'),
    domain: z.string().optional().describe('Site domain or URL host'),
    site: z.string().optional().describe('URL or host for compose mode profile resolve'),
    kind: z.enum(['mnemonic', 'password', 'master', 'compose']).optional()
  },
  async ({ username, domain, site, kind }) => {
    if (MODE === 'compose' || kind === 'compose' || kind === 'master') {
      const profile = siteDirectory.resolve(site || domain || '');
      return textResult({
        mode: MODE,
        master_present: siteDirectory.hasMaster(),
        site_id: profile ? profile.id : null,
        profile_present: Boolean(profile),
        username: username || (profile && profile.username) || null
      });
    }
    const resolvedKind = kind || (MODE === 'keyring' ? 'password' : 'mnemonic');
    const secret = keyring.lookup({
      username: String(username || '').trim(),
      domain: domainOrStar(domain),
      kind: resolvedKind
    });
    return textResult({
      username: String(username || '').trim(),
      domain: domainOrStar(domain),
      kind: resolvedKind,
      present: Boolean(secret),
      backend: keyring.backend,
      mode: MODE
    });
  }
);

server.tool(
  'list_accounts',
  'List non-secret account/profile metadata. Compose mode lists encrypted directory public fields only.',
  {},
  async () => {
    if (MODE === 'compose') {
      return textResult({
        mode: MODE,
        master_present: siteDirectory.hasMaster(),
        directory: siteDirectory.listPublic(),
        keyring_backend: keyring.backend
      });
    }
    return textResult(keyring.list());
  }
);

server.tool(
  'store_master_secret',
  'Store the universal mnemonic suffix used by compose mode (protected; never returned by list/auth tools).',
  {
    master_secret: z.string().describe('Universal secret appended after the cased site token')
  },
  async ({ master_secret }) => textResult(siteDirectory.setMaster(master_secret))
);

server.tool(
  'upsert_site_profile',
  'Add/update an encrypted site profile: associative token + host matchers. Token is secret; not listed in cleartext.',
  {
    id: z.string().describe('Stable site id, e.g. google-mail or facebook'),
    hosts: z.array(z.string()).describe('Hostnames that map to this associative token'),
    token: z.string().describe('Associative domain element, usually lowercase, e.g. gmail'),
    casing: z
      .enum(['last_upper', 'first_upper', 'as_stored', 'none', 'all_lower', 'all_upper'])
      .optional(),
    modifiers: z.string().optional().describe('Optional AlienPass prefix like abc11 or abc11:'),
    login_index: z.number().int().nonnegative().optional(),
    username: z.string().optional()
  },
  async (profile) => textResult(siteDirectory.upsertSite(profile))
);

server.tool(
  'store_mnemonic',
  'Legacy Mode A: store a full AlienPass InputString in the keyring (not used by compose mode).',
  {
    username: z.string(),
    domain: z.string().optional(),
    input_string: z.string().describe('AlienPass InputString, e.g. GmailTower or abc11:WeirdSiteTower')
  },
  async ({ username, domain, input_string }) => {
    keyring.store(
      {
        username: String(username).trim(),
        domain: domainOrStar(domain),
        kind: 'mnemonic'
      },
      String(input_string).trim()
    );
    return textResult({
      ok: true,
      kind: 'mnemonic',
      username: String(username).trim(),
      domain: domainOrStar(domain),
      backend: keyring.backend
    });
  }
);

server.tool(
  'store_password',
  'Store a final site password in the keyring (Mode B simplification).',
  {
    username: z.string(),
    domain: z.string().optional(),
    password: z.string()
  },
  async ({ username, domain, password }) => {
    keyring.store(
      {
        username: String(username).trim(),
        domain: domainOrStar(domain),
        kind: 'password'
      },
      String(password)
    );
    return textResult({
      ok: true,
      kind: 'password',
      username: String(username).trim(),
      domain: domainOrStar(domain),
      backend: keyring.backend
    });
  }
);

server.tool(
  'generate_password',
  'Derive or fetch a password. Disabled unless ALIENPASS_ALLOW_REVEAL=1. Prefer fill_login.',
  {
    username: z.string(),
    domain: z.string().optional(),
    site: z.string().optional().describe('URL/host for compose profile resolve'),
    login_index: z.number().int().nonnegative().optional(),
    input_string: z.string().optional().describe('Optional full InputString override (debug)')
  },
  async ({ username, domain, site, login_index, input_string }) => {
    if (!ALLOW_REVEAL) {
      return textResult({
        ok: false,
        error_code: 'reveal_disabled',
        message:
          'ALIENPASS_ALLOW_REVEAL=0. Use fill_login / fill_stored_password, or enable reveal only for local CLI debugging.'
      });
    }
    try {
      const resolved = await resolvePassword({ username, domain, site, login_index, input_string });
      const payload = {
        ok: true,
        password: resolved.password,
        method: resolved.method,
        login: resolved.login,
        site_id: resolved.site_id || null,
        engine: resolved.engine || null,
        warning: 'Password revealed to caller. Do not forward to a cloud agent.'
      };
      if (resolved._debug_input_string) {
        payload.input_string = resolved._debug_input_string;
        payload.warning += ' Also reveals assembled InputString.';
      }
      return textResult(payload);
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          username,
          method: methodLabel(),
          error_code: error.code || 'generate_failed',
          message: error.message
        })
      );
    }
  }
);

server.tool(
  'fill_login',
  'Preferred AlienPass path (compose or legacy): materialize password and prepare injection. Does not return secrets when reveal is off.',
  {
    username: z.string().optional(),
    domain: z.string().optional(),
    site: z.string().optional().describe('Page URL or host — required for compose mode'),
    login_index: z.number().int().nonnegative().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional()
  },
  async ({
    username,
    domain,
    site,
    login_index,
    username_selector,
    password_selector,
    submit_selector
  }) => {
    const started = Date.now();
    try {
      const resolved = await resolvePassword({
        username,
        domain,
        site: site || domain,
        login_index
      });
      const injection = {
        status: 'planned_not_connected',
        note: 'CDP injection not yet wired. Assembly happened inside MCP protected process.',
        username_selector: username_selector || 'input[type=email], input[name=username], input[name=email]',
        password_selector: password_selector || 'input[type=password]',
        submit_selector: submit_selector || 'button[type=submit]',
        username_value: engine.parseLoginString(resolved.login).login,
        password_ready: true,
        password_fingerprint: keyring.fingerprint(resolved.password),
        site_id: resolved.site_id || null
      };

      const report = buildReport({
        ok: true,
        site: site || domain || null,
        username: engine.parseLoginString(resolved.login).login,
        method: resolved.method,
        login_index: Number(resolved.parsedLogin.index),
        evidence: 'password_materialized_injection_pending_cdp',
        duration_ms: Date.now() - started
      });

      const payload = { report, injection };
      if (ALLOW_REVEAL) {
        payload.password = resolved.password;
        if (resolved._debug_input_string) payload.input_string = resolved._debug_input_string;
        payload.warning = 'Reveal enabled; strip before any cloud handoff.';
      }
      return textResult(payload);
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          site: site || domain || null,
          username: username || null,
          method: methodLabel(),
          error_code: error.code || 'fill_failed',
          message: error.message,
          duration_ms: Date.now() - started
        })
      );
    }
  }
);

server.tool(
  'fill_stored_password',
  'Mode B preferred path: load site password from keyring for injection (same CDP placeholder as fill_login).',
  {
    username: z.string(),
    domain: z.string().optional(),
    site: z.string().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional()
  },
  async (args) => {
    const started = Date.now();
    const login = engine.withIndex(args.username, 1);
    const parsedLogin = engine.parseLoginString(login);
    const password = keyring.lookup({
      username: parsedLogin.login,
      domain: domainOrStar(args.domain),
      kind: 'password'
    });
    if (!password) {
      return textResult(
        buildReport({
          ok: false,
          site: args.site || null,
          username: parsedLogin.login,
          method: 'keyring',
          error_code: 'keyring_miss',
          message: 'No stored password for username/domain',
          duration_ms: Date.now() - started
        })
      );
    }
    const payload = {
      report: buildReport({
        ok: true,
        site: args.site || null,
        username: parsedLogin.login,
        method: 'keyring',
        evidence: 'password_materialized_injection_pending_cdp',
        duration_ms: Date.now() - started
      }),
      injection: {
        status: 'planned_not_connected',
        username_selector:
          args.username_selector || 'input[type=email], input[name=username], input[name=email]',
        password_selector: args.password_selector || 'input[type=password]',
        submit_selector: args.submit_selector || 'button[type=submit]',
        username_value: parsedLogin.login,
        password_ready: true,
        password_fingerprint: keyring.fingerprint(password)
      }
    };
    if (ALLOW_REVEAL) {
      payload.password = password;
      payload.warning = 'Reveal enabled; strip before any cloud handoff.';
    }
    return textResult(payload);
  }
);

server.tool(
  'build_signin_report',
  'Local subagent helper: format a cloud-safe sign-in report after browser success/failure.',
  {
    ok: z.boolean(),
    site: z.string().optional(),
    username: z.string().optional(),
    method: z.enum(['alienpass-v2', 'alienpass-v2-compose', 'keyring']).optional(),
    login_index: z.number().optional(),
    evidence: z.string().optional(),
    error_code: z.string().optional(),
    message: z.string().optional(),
    duration_ms: z.number().optional()
  },
  async (fields) => textResult(buildReport(fields))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
