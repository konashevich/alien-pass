#!/usr/bin/env node
/**
 * Terminal CLI for the same backends (no MCP). Useful for local debugging
 * and for a subagent that prefers shell tool calls over MCP.
 *
 * Examples:
 *   ALIENPASS_FORCE_FALLBACK=1 node src/cli.js store-mnemonic you@x.com '*' 'GmailTower'
 *   ALIENPASS_FORCE_FALLBACK=1 ALIENPASS_ALLOW_REVEAL=1 node src/cli.js generate you@x.com 1 example.com
 *   ALIENPASS_FORCE_FALLBACK=1 node src/cli.js store-password you@x.com example.com 's3cret'
 */
'use strict';

const engine = require('./alienpass-engine');
const { createKeyring } = require('./keyring');
const { buildReport } = require('./report');

const keyring = createKeyring();
const ALLOW_REVEAL = process.env.ALIENPASS_ALLOW_REVEAL === '1';

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`Commands:
  store-mnemonic <username> <domain|-> <input_string>
  store-password <username> <domain|-> <password>
  auth-status <username> <domain|-> [mnemonic|password]
  generate <username> [login_index] [domain]
  report-ok <username> <site> [alienpass-v2|keyring]
`);
    process.exit(0);
  }

  if (cmd === 'store-mnemonic') {
    const [username, domain, ...rest] = args;
    const input = rest.join(' ');
    keyring.store(
      { username, domain: domain === '-' ? '*' : domain, kind: 'mnemonic' },
      input
    );
    console.log(JSON.stringify({ ok: true, kind: 'mnemonic', backend: keyring.backend }));
    return;
  }

  if (cmd === 'store-password') {
    const [username, domain, ...rest] = args;
    keyring.store(
      { username, domain: domain === '-' ? '*' : domain, kind: 'password' },
      rest.join(' ')
    );
    console.log(JSON.stringify({ ok: true, kind: 'password', backend: keyring.backend }));
    return;
  }

  if (cmd === 'auth-status') {
    const [username, domain, kind] = args;
    const resolvedKind = kind || 'mnemonic';
    const secret = keyring.lookup({
      username,
      domain: domain === '-' ? '*' : domain,
      kind: resolvedKind
    });
    console.log(
      JSON.stringify({
        present: Boolean(secret),
        kind: resolvedKind,
        backend: keyring.backend
      })
    );
    return;
  }

  if (cmd === 'generate') {
    if (!ALLOW_REVEAL) {
      console.error(JSON.stringify({ ok: false, error_code: 'reveal_disabled' }));
      process.exit(2);
    }
    const [username, loginIndex, domain] = args;
    const login = engine.withIndex(username, loginIndex || 1);
    const mnemonic = keyring.lookup({
      username: engine.parseLoginString(login).login,
      domain: !domain || domain === '-' ? '*' : domain,
      kind: 'mnemonic'
    });
    if (!mnemonic) {
      console.error(JSON.stringify({ ok: false, error_code: 'keyring_miss' }));
      process.exit(3);
    }
    const out = await engine.generatePassword({ login, inputString: mnemonic });
    console.log(JSON.stringify({ ok: true, password: out.password, login, engine: out.engine }));
    return;
  }

  if (cmd === 'report-ok') {
    const [username, site, method] = args;
    console.log(
      JSON.stringify(
        buildReport({
          ok: true,
          username,
          site,
          method: method || 'alienpass-v2',
          evidence: 'cli_manual'
        })
      )
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
