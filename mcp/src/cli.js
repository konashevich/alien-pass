#!/usr/bin/env node
/**
 * AlienPass local CLI — vault setup + browser sign-in.
 *
 * Examples:
 *   alienpass-cli init-master 'YourUniversalSecret'
 *   alienpass-cli add-site google-mail gmail accounts.google.com,mail.google.com --user you@x.com
 *   alienpass-cli sign-in https://example.com/login you@x.com
 *   alienpass-cli store-password you@x.com example.com 'ready-password'
 */
'use strict';

const path = require('node:path');
const { createCredentialService } = require('./credentials');
const { buildReport } = require('./report');
const { signInSession, resolveChromePath, cdpEndpoint } = require('./browser');

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function usage() {
  console.log(`AlienPass MCP CLI

Setup (compose mode):
  init-master <master_secret>
  add-site <id> <token> <host1,host2,...> [--user email] [--index N] [--casing last_upper] [--modifiers abc11]
  delete-site <id>
  list-sites
  auth-status [url-or-host]

Mode B:
  store-password <username> <domain|-> <password>

Legacy Mode A:
  store-mnemonic <username> <domain|-> <input_string>

Sign-in / derive:
  sign-in <url> [username] [--site-id id] [--index N] [--success-url fragment] [--success-selector css] [--headed]
  fill <url> [username]   (alias of sign-in)
  generate <username> --site <url> [--index N]   (requires ALIENPASS_ALLOW_REVEAL=1)

Misc:
  doctor
  help
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  const { flags, positional } = parseFlags(rest);
  const service = createCredentialService();
  const { siteDirectory, keyring, mode, allowReveal } = service;

  if (cmd === 'doctor') {
    print({
      ok: true,
      mode,
      allow_reveal: allowReveal,
      keyring_backend: keyring.backend,
      chrome_path: resolveChromePath(),
      cdp: cdpEndpoint(),
      master_present: mode === 'compose' ? siteDirectory.hasMaster() : null,
      vault_path: siteDirectory.path,
      node: process.version,
      platform: `${process.platform}-${process.arch}`
    });
    return;
  }

  if (cmd === 'init-master') {
    const master = positional.join(' ') || flags.secret;
    if (!master) throw new Error('master secret required');
    print(siteDirectory.setMaster(master));
    return;
  }

  if (cmd === 'add-site') {
    const [id, token, hostsCsv] = positional;
    if (!id || !token || !hostsCsv) throw new Error('usage: add-site <id> <token> <host1,host2>');
    print(
      siteDirectory.upsertSite({
        id,
        token,
        hosts: hostsCsv.split(',').map((h) => h.trim()).filter(Boolean),
        username: flags.user || flags.username || null,
        login_index: flags.index != null ? Number(flags.index) : 1,
        casing: flags.casing || 'last_upper',
        modifiers: flags.modifiers || ''
      })
    );
    return;
  }

  if (cmd === 'delete-site') {
    print(siteDirectory.deleteSite(positional[0]));
    return;
  }

  if (cmd === 'list-sites') {
    print(service.listAccounts());
    return;
  }

  if (cmd === 'auth-status') {
    print(
      service.authStatus({
        site: positional[0],
        username: flags.user,
        domain: flags.domain,
        kind: flags.kind
      })
    );
    return;
  }

  if (cmd === 'store-password') {
    const [username, domain, ...pwParts] = positional;
    keyring.store(
      { username, domain: domain === '-' ? '*' : domain, kind: 'password' },
      pwParts.join(' ')
    );
    print({ ok: true, kind: 'password', backend: keyring.backend });
    return;
  }

  if (cmd === 'store-mnemonic') {
    const [username, domain, ...parts] = positional;
    keyring.store(
      { username, domain: domain === '-' ? '*' : domain, kind: 'mnemonic' },
      parts.join(' ')
    );
    print({ ok: true, kind: 'mnemonic', backend: keyring.backend });
    return;
  }

  if (cmd === 'generate') {
    if (!allowReveal) {
      print({ ok: false, error_code: 'reveal_disabled' });
      process.exitCode = 2;
      return;
    }
    const username = positional[0] || flags.user;
    const resolved = await service.resolvePassword({
      username,
      site: flags.site || positional[1],
      domain: flags.domain,
      login_index: flags.index != null ? Number(flags.index) : undefined
    });
    print({
      ok: true,
      password: resolved.password,
      method: resolved.method,
      login: resolved.login,
      site_id: resolved.site_id || null,
      warning: 'Do not forward to a cloud agent.'
    });
    return;
  }

  if (cmd === 'sign-in' || cmd === 'fill') {
    const url = positional[0];
    const username = positional[1] || flags.user || flags.username;
    if (!url) throw new Error('url required');

    const started = Date.now();
    let resolved;
    try {
      resolved = await service.resolvePassword({
        username,
        site: url,
        domain: flags.domain,
        site_id: flags['site-id'] || flags.profile,
        login_index: flags.index != null ? Number(flags.index) : undefined
      });
    } catch (error) {
      print(
        buildReport({
          ok: false,
          site: url,
          username: username || null,
          method: service.methodLabel(),
          error_code: error.code || 'resolve_failed',
          message: error.message,
          duration_ms: Date.now() - started
        })
      );
      process.exitCode = 3;
      return;
    }

    const browserResult = await signInSession({
      url,
      username: resolved.username,
      password: resolved.password,
      username_selector: flags['user-selector'],
      password_selector: flags['pass-selector'],
      submit_selector: flags['submit-selector'],
      click_next_selector: flags['next-selector'],
      success_selector: flags['success-selector'],
      success_url_includes: flags['success-url'],
      headless: flags.headed ? false : undefined,
      timeout_ms: flags.timeout ? Number(flags.timeout) : undefined
    });

    const report = buildReport({
      ok: browserResult.ok,
      site: url,
      username: resolved.username,
      method: resolved.method,
      login_index: Number(resolved.parsedLogin.index),
      evidence: browserResult.evidence,
      error_code: browserResult.error_code,
      message: browserResult.ok ? null : browserResult.evidence,
      duration_ms: Date.now() - started
    });

    print({
      report,
      browser: {
        via: browserResult.via,
        url: browserResult.url,
        submitted: browserResult.submitted
      },
      site_id: resolved.site_id || null,
      password_fingerprint: service.fingerprint(resolved.password)
    });
    process.exitCode = browserResult.ok ? 0 : 4;
    return;
  }

  if (cmd === 'report-ok') {
    print(
      buildReport({
        ok: true,
        username: positional[0],
        site: positional[1],
        method: positional[2] || service.methodLabel(),
        evidence: 'cli_manual'
      })
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  print({ ok: false, error_code: error.code || 'cli_error', message: error.message });
  process.exit(1);
});
