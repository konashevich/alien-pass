#!/usr/bin/env node
/**
 * AlienPass MCP server (stdio).
 *
 * Attach ONLY to a local Cursor subagent / local-model profile.
 * Never register this server on a cloud proprietary agent that must not see secrets.
 *
 * Env:
 *   ALIENPASS_MODE=alienpass|keyring   (default: alienpass)
 *   ALIENPASS_ALLOW_REVEAL=0|1         (default: 0)
 *   ALIENPASS_FORCE_FALLBACK=1         (use file store instead of libsecret)
 *   ALIENPASS_FALLBACK_STORE=path      (override file store path)
 */
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const engine = require('./alienpass-engine');
const { createKeyring } = require('./keyring');
const { buildReport, REPORT_SCHEMA } = require('./report');

const MODE = (process.env.ALIENPASS_MODE || 'alienpass').toLowerCase();
const ALLOW_REVEAL = process.env.ALIENPASS_ALLOW_REVEAL === '1';
const keyring = createKeyring();

function textResult(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }]
  };
}

function domainOrStar(domain) {
  const d = String(domain || '').trim();
  return d || '*';
}

async function resolvePassword({ username, domain, login_index, input_string }) {
  const login = engine.withIndex(username, login_index == null ? 1 : login_index);

  if (MODE === 'keyring') {
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
  'Check whether a keyring entry exists for username+domain (no secret returned).',
  {
    username: z.string().describe('Email / login base without ,index'),
    domain: z.string().optional().describe('Site domain; defaults to *'),
    kind: z.enum(['mnemonic', 'password']).optional()
  },
  async ({ username, domain, kind }) => {
    const resolvedKind = kind || (MODE === 'keyring' ? 'password' : 'mnemonic');
    const secret = keyring.lookup({
      username: String(username).trim(),
      domain: domainOrStar(domain),
      kind: resolvedKind
    });
    return textResult({
      username: String(username).trim(),
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
  'List known accounts when using the file fallback store. Libsecret backend returns a capability note.',
  {},
  async () => textResult(keyring.list())
);

server.tool(
  'store_mnemonic',
  'Store AlienPass InputString (mnemonic/command string) in the keyring for Mode A.',
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
    login_index: z.number().int().nonnegative().optional(),
    input_string: z.string().optional().describe('Optional override; otherwise keyring mnemonic')
  },
  async ({ username, domain, login_index, input_string }) => {
    if (!ALLOW_REVEAL) {
      return textResult({
        ok: false,
        error_code: 'reveal_disabled',
        message:
          'ALIENPASS_ALLOW_REVEAL=0. Use fill_login / fill_stored_password, or enable reveal only for local CLI debugging.'
      });
    }
    try {
      const resolved = await resolvePassword({ username, domain, login_index, input_string });
      return textResult({
        ok: true,
        password: resolved.password,
        method: resolved.method,
        login: resolved.login,
        engine: resolved.engine || null,
        warning: 'Password revealed to caller. Do not forward to a cloud agent.'
      });
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          username,
          method: MODE === 'keyring' ? 'keyring' : 'alienpass-v2',
          error_code: error.code || 'generate_failed',
          message: error.message
        })
      );
    }
  }
);

server.tool(
  'fill_login',
  'Mode A preferred path: derive AlienPass password and describe injection. CDP wire-up is Phase 5; returns a safe report plus fill plan without the password when reveal is off.',
  {
    username: z.string(),
    domain: z.string().optional(),
    login_index: z.number().int().nonnegative().optional(),
    site: z.string().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional()
  },
  async ({
    username,
    domain,
    login_index,
    site,
    username_selector,
    password_selector,
    submit_selector
  }) => {
    const started = Date.now();
    try {
      const resolved = await resolvePassword({ username, domain, login_index });
      // Phase 5: attach to Cursor/Chromium CDP and type into selectors without returning password.
      const injection = {
        status: 'planned_not_connected',
        note: 'CDP injection not yet wired. Local subagent may use browser tools with a one-shot local reveal only if unavoidable.',
        username_selector: username_selector || 'input[type=email], input[name=username], input[name=email]',
        password_selector: password_selector || 'input[type=password]',
        submit_selector: submit_selector || 'button[type=submit]',
        username_value: engine.parseLoginString(resolved.login).login,
        password_ready: true,
        password_fingerprint: keyring.fingerprint(resolved.password)
      };

      const report = buildReport({
        ok: true,
        site: site || null,
        username: engine.parseLoginString(resolved.login).login,
        method: resolved.method,
        login_index: Number(resolved.parsedLogin.index),
        evidence: 'password_materialized_injection_pending_cdp',
        duration_ms: Date.now() - started
      });

      const payload = { report, injection };
      if (ALLOW_REVEAL) {
        payload.password = resolved.password;
        payload.warning = 'Reveal enabled; strip before any cloud handoff.';
      }
      return textResult(payload);
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          site: site || null,
          username,
          method: MODE === 'keyring' ? 'keyring' : 'alienpass-v2',
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
    method: z.enum(['alienpass-v2', 'keyring']).optional(),
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
