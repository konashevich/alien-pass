#!/usr/bin/env node
/**
 * AlienPass MCP server (stdio) — local sign-in product.
 *
 * Attach ONLY to a local Cursor subagent / local-model profile.
 * Recommended agent env: ALIENPASS_AGENT_SAFE=1 (disables setup/reveal tools).
 */
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const { createCredentialService } = require('./credentials');
const { buildReport, REPORT_SCHEMA } = require('./report');
const { signInSession, fillCurrentPage, resolveChromePath, cdpEndpoint } = require('./browser');

const service = createCredentialService();
const { keyring, siteDirectory, allowReveal, allowRevealMnemonic, mode } = service;
const AGENT_SAFE = process.env.ALIENPASS_AGENT_SAFE === '1';

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function setupBlocked() {
  return textResult({
    ok: false,
    error_code: 'setup_disabled',
    message:
      'ALIENPASS_AGENT_SAFE=1 blocks vault mutation tools. Use the CLI for setup, or unset AGENT_SAFE for a setup profile.'
  });
}

const casingEnum = z.enum([
  'last_upper',
  'first_upper',
  'as_stored',
  'none',
  'all_lower',
  'all_upper'
]);

const server = new McpServer({
  name: 'alienpass-mcp',
  version: '1.0.1'
});

server.tool(
  'doctor',
  'Local environment diagnostics (no secrets).',
  {},
  async () =>
    textResult({
      mode,
      allow_reveal: allowReveal,
      allow_reveal_mnemonic: allowRevealMnemonic,
      agent_safe: AGENT_SAFE,
      keyring_backend: keyring.backend,
      keyring_reason: keyring.backend_reason || null,
      keyring_warning: keyring.insecure_relative_to_libsecret
        ? 'Encrypted file fallback is weaker than a locked desktop keyring'
        : null,
      chrome_path: resolveChromePath(),
      cdp: (() => {
        try {
          return cdpEndpoint();
        } catch (error) {
          return { error: error.code || error.message };
        }
      })(),
      master_present: mode === 'compose' ? siteDirectory.hasMaster() : null,
      vault_path: siteDirectory.path,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      note: 'Launch mode signs into a temporary Chrome unless ALIENPASS_CDP_URL points at Cursor/Chrome.'
    })
);

server.tool(
  'report_template',
  'Return the non-secret sign-in report schema safe to send to a cloud main agent.',
  {},
  async () =>
    textResult({
      schema: REPORT_SCHEMA,
      example: buildReport({
        ok: true,
        method: 'alienpass-v2-compose',
        evidence: 'url_includes:/dashboard',
        verified: true
      })
    })
);

server.tool(
  'auth_status',
  'Check whether secrets/profiles exist (no secret values returned).',
  {
    username: z.string().optional(),
    domain: z.string().optional(),
    site: z.string().optional(),
    kind: z.enum(['mnemonic', 'password', 'master', 'compose']).optional()
  },
  async (args) => textResult(service.authStatus(args))
);

server.tool(
  'list_accounts',
  'List non-secret account/profile metadata.',
  {},
  async () => textResult(service.listAccounts())
);

server.tool(
  'store_master_secret',
  'Store the universal mnemonic suffix used by compose mode. Disabled when ALIENPASS_AGENT_SAFE=1.',
  { master_secret: z.string() },
  async ({ master_secret }) => {
    if (AGENT_SAFE) return setupBlocked();
    return textResult(siteDirectory.setMaster(master_secret));
  }
);

server.tool(
  'upsert_site_profile',
  'Add/update an encrypted site profile. Disabled when ALIENPASS_AGENT_SAFE=1.',
  {
    id: z.string(),
    hosts: z.array(z.string()),
    token: z.string(),
    casing: casingEnum.optional(),
    modifiers: z.string().optional(),
    login_index: z.number().int().nonnegative().optional(),
    username: z.string().optional()
  },
  async (profile) => {
    if (AGENT_SAFE) return setupBlocked();
    return textResult(siteDirectory.upsertSite(profile));
  }
);

server.tool(
  'delete_site_profile',
  'Delete an encrypted site profile by id. Disabled when ALIENPASS_AGENT_SAFE=1.',
  { id: z.string() },
  async ({ id }) => {
    if (AGENT_SAFE) return setupBlocked();
    return textResult(siteDirectory.deleteSite(id));
  }
);

server.tool(
  'store_mnemonic',
  'Legacy Mode A: store a full AlienPass InputString. Disabled when ALIENPASS_AGENT_SAFE=1.',
  {
    username: z.string(),
    domain: z.string().optional(),
    input_string: z.string()
  },
  async ({ username, domain, input_string }) => {
    if (AGENT_SAFE) return setupBlocked();
    keyring.store(
      {
        username: String(username).trim(),
        domain: service.domainOrStar(service.normalizeHostname(domain || '*')),
        kind: 'mnemonic'
      },
      String(input_string).trim()
    );
    return textResult({
      ok: true,
      kind: 'mnemonic',
      username: String(username).trim(),
      domain: service.normalizeHostname(domain || '*'),
      backend: keyring.backend
    });
  }
);

server.tool(
  'store_password',
  'Mode B: store a final site password. Disabled when ALIENPASS_AGENT_SAFE=1.',
  {
    username: z.string(),
    domain: z.string().optional(),
    password: z.string()
  },
  async ({ username, domain, password }) => {
    if (AGENT_SAFE) return setupBlocked();
    keyring.store(
      {
        username: String(username).trim(),
        domain: service.domainOrStar(service.normalizeHostname(domain || '*')),
        kind: 'password'
      },
      String(password)
    );
    return textResult({
      ok: true,
      kind: 'password',
      username: String(username).trim(),
      domain: service.normalizeHostname(domain || '*'),
      backend: keyring.backend
    });
  }
);

server.tool(
  'generate_password',
  'Derive/fetch password. Requires ALIENPASS_ALLOW_REVEAL=1. Never returns mnemonic unless ALIENPASS_ALLOW_REVEAL_MNEMONIC=1.',
  {
    username: z.string().optional(),
    domain: z.string().optional(),
    site: z.string().optional(),
    site_id: z.string().optional(),
    login_index: z.number().int().nonnegative().optional(),
    input_string: z.string().optional()
  },
  async (args) => {
    if (AGENT_SAFE || !allowReveal) {
      return textResult({
        ok: false,
        error_code: AGENT_SAFE ? 'setup_disabled' : 'reveal_disabled',
        message: 'Use sign_in_session / fill_login. Reveal is disabled for agent-safe mode.'
      });
    }
    try {
      const resolved = await service.resolvePassword(args);
      const payload = {
        ok: true,
        password: resolved.password,
        method: resolved.method,
        login: resolved.login,
        site_id: resolved.site_id || null,
        warning: 'Password revealed to caller. Do not forward to a cloud agent.'
      };
      if (allowRevealMnemonic && resolved._debug_input_string) {
        payload.input_string = resolved._debug_input_string;
        payload.warning += ' Mnemonic reveal also enabled.';
      }
      return textResult(payload);
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          username: args.username || null,
          method: service.methodLabel(),
          error_code: error.code || 'generate_failed',
          message: error.message
        })
      );
    }
  }
);

server.tool(
  'fill_login',
  'Assemble credentials and fill a matching CDP page, or fall back to sign_in_session when a site URL is provided.',
  {
    username: z.string().optional(),
    domain: z.string().optional(),
    site: z.string().optional(),
    site_id: z.string().optional(),
    login_index: z.number().int().nonnegative().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional(),
    submit: z.boolean().optional(),
    success_selector: z.string().optional(),
    success_url_includes: z.string().optional()
  },
  async (args) => {
    const started = Date.now();
    try {
      const resolved = await service.resolvePassword({
        username: args.username,
        domain: args.domain,
        site: args.site || args.domain,
        site_id: args.site_id,
        login_index: args.login_index
      });

      let finalBrowser = await fillCurrentPage({
        username: resolved.username,
        password: resolved.password,
        username_selector: args.username_selector,
        password_selector: args.password_selector,
        submit_selector: args.submit_selector,
        submit: args.submit !== false,
        site: args.site || args.domain,
        expectedHost: service.normalizeHostname(args.site || args.domain || '')
      });

      if (!finalBrowser.ok && finalBrowser.error_code === 'cdp_required' && args.site) {
        finalBrowser = await signInSession({
          url: args.site,
          username: resolved.username,
          password: resolved.password,
          username_selector: args.username_selector,
          password_selector: args.password_selector,
          submit_selector: args.submit_selector,
          success_selector: args.success_selector,
          success_url_includes: args.success_url_includes
        });
      }

      const verified = Boolean(finalBrowser.verified);
      const report = buildReport({
        ok: finalBrowser.ok && (verified || finalBrowser.evidence === 'filled_credentials'),
        site: args.site || args.domain || finalBrowser.url || null,
        username: resolved.username,
        method: resolved.method,
        login_index: Number(resolved.parsedLogin.index),
        evidence: finalBrowser.evidence,
        error_code: finalBrowser.error_code,
        message: finalBrowser.ok ? null : finalBrowser.evidence,
        duration_ms: Date.now() - started,
        verified
      });

      return textResult({
        report,
        injection: {
          status: finalBrowser.ok ? 'filled' : 'failed',
          via: finalBrowser.via || null,
          url: finalBrowser.url || null,
          site_id: resolved.site_id || null
        }
      });
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          site: args.site || args.domain || null,
          username: args.username || null,
          method: service.methodLabel(),
          error_code: error.code || 'fill_failed',
          message: error.message,
          duration_ms: Date.now() - started,
          verified: false
        })
      );
    }
  }
);

server.tool(
  'fill_stored_password',
  'Mode B: load stored password and fill/sign-in.',
  {
    username: z.string(),
    domain: z.string().optional(),
    site: z.string().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional(),
    success_selector: z.string().optional(),
    success_url_includes: z.string().optional()
  },
  async (args) => {
    const started = Date.now();
    try {
      const keyringService = createCredentialService({
        mode: 'keyring',
        keyring,
        siteDirectory
      });

      const resolved = await keyringService.resolvePassword({
        username: args.username,
        domain: args.domain || args.site,
        site: args.site
      });

      let browserResult = await fillCurrentPage({
        username: resolved.username,
        password: resolved.password,
        username_selector: args.username_selector,
        password_selector: args.password_selector,
        submit_selector: args.submit_selector,
        submit: true,
        site: args.site || args.domain,
        expectedHost: service.normalizeHostname(args.site || args.domain || '')
      });
      if (!browserResult.ok && browserResult.error_code === 'cdp_required' && args.site) {
        browserResult = await signInSession({
          url: args.site,
          username: resolved.username,
          password: resolved.password,
          username_selector: args.username_selector,
          password_selector: args.password_selector,
          submit_selector: args.submit_selector,
          success_selector: args.success_selector,
          success_url_includes: args.success_url_includes
        });
      }

      return textResult({
        report: buildReport({
          ok: browserResult.ok && Boolean(browserResult.verified),
          site: args.site || args.domain || null,
          username: resolved.username,
          method: 'keyring',
          evidence: browserResult.evidence,
          error_code: browserResult.error_code,
          duration_ms: Date.now() - started,
          verified: Boolean(browserResult.verified)
        }),
        injection: {
          status: browserResult.ok ? 'filled' : 'failed',
          via: browserResult.via || null
        }
      });
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          site: args.site || null,
          username: args.username,
          method: 'keyring',
          error_code: error.code || 'fill_failed',
          message: error.message,
          duration_ms: Date.now() - started,
          verified: false
        })
      );
    }
  }
);

server.tool(
  'sign_in_session',
  'Full local sign-in: resolve credentials secretly, browser fill/submit, return cloud-safe report only.',
  {
    url: z.string(),
    username: z.string().optional(),
    domain: z.string().optional(),
    site_id: z.string().optional(),
    login_index: z.number().int().nonnegative().optional(),
    username_selector: z.string().optional(),
    password_selector: z.string().optional(),
    submit_selector: z.string().optional(),
    next_selector: z.string().optional(),
    success_selector: z.string().optional(),
    success_url_includes: z.string().optional(),
    headed: z.boolean().optional(),
    timeout_ms: z.number().int().positive().optional()
  },
  async (args) => {
    const started = Date.now();
    try {
      const resolved = await service.resolvePassword({
        username: args.username,
        domain: args.domain,
        site: args.url,
        site_id: args.site_id,
        login_index: args.login_index
      });

      const browserResult = await signInSession({
        url: args.url,
        username: resolved.username,
        password: resolved.password,
        username_selector: args.username_selector,
        password_selector: args.password_selector,
        submit_selector: args.submit_selector,
        click_next_selector: args.next_selector,
        success_selector: args.success_selector,
        success_url_includes: args.success_url_includes,
        headless: args.headed ? false : undefined,
        timeout_ms: args.timeout_ms
      });

      const report = buildReport({
        ok: browserResult.ok,
        site: args.url,
        username: resolved.username,
        method: resolved.method,
        login_index: Number(resolved.parsedLogin.index),
        evidence: browserResult.evidence,
        error_code: browserResult.error_code,
        message: browserResult.ok ? null : browserResult.evidence,
        duration_ms: Date.now() - started,
        verified: Boolean(browserResult.verified)
      });

      return textResult({
        report,
        browser: {
          via: browserResult.via,
          final_url: browserResult.url,
          submitted: browserResult.submitted
        },
        site_id: resolved.site_id || null,
        secrets_included: false
      });
    } catch (error) {
      return textResult(
        buildReport({
          ok: false,
          site: args.url,
          username: args.username || null,
          method: service.methodLabel(),
          error_code: error.code || 'sign_in_failed',
          message: error.message,
          duration_ms: Date.now() - started,
          verified: false
        })
      );
    }
  }
);

server.tool(
  'build_signin_report',
  'Format a cloud-safe sign-in report. Free-form fields are scrubbed for suspicious secret-like content.',
  {
    ok: z.boolean(),
    site: z.string().optional(),
    username: z.string().optional(),
    method: z.enum(['alienpass-v2', 'alienpass-v2-compose', 'keyring']).optional(),
    login_index: z.number().optional(),
    evidence: z.string().optional(),
    error_code: z.string().optional(),
    message: z.string().optional(),
    duration_ms: z.number().optional(),
    verified: z.boolean().optional()
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
