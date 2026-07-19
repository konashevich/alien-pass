#!/usr/bin/env node
/**
 * End-to-end sign-in against fixtures/login.html (headed optional).
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createCredentialService } = require('./credentials');
const { signInSession, resolveChromePath } = require('./browser');
const engine = require('./alienpass-engine');
const { assembleInputString } = require('./mnemonic-compose');

async function main() {
  if (!resolveChromePath()) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no_chrome' }));
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alienpass-e2e-'));
  process.env.ALIENPASS_FORCE_FALLBACK = '1';
  process.env.ALIENPASS_FALLBACK_STORE = path.join(tmpRoot, 'store.json');
  process.env.ALIENPASS_SITE_VAULT = path.join(tmpRoot, 'sites.vault');
  process.env.ALIENPASS_MODE = 'compose';
  process.env.ALIENPASS_BROWSER_HEADLESS = '1';

  const service = createCredentialService({ mode: 'compose' });
  service.siteDirectory.setMaster('Tower35');
  service.siteDirectory.upsertSite({
    id: 'fixture-login',
    token: 'gmail',
    hosts: ['localhost', 'fixture.local'],
    casing: 'last_upper',
    username: 'test@me.com',
    login_index: 1
  });

  const assembled = assembleInputString({
    siteToken: 'gmail',
    masterSecret: 'Tower35',
    casing: 'last_upper'
  });
  const derived = await engine.generatePassword({
    login: 'test@me.com,1',
    inputString: assembled.inputString
  });

  // file:// pages don't match host profiles — pass password via login.html?expect=
  // while still resolving through compose for fingerprint parity.
  const loginPath = path.join(__dirname, '..', 'fixtures', 'login.html');
  const loginUrl =
    pathToFileURL(loginPath).href + '?expect=' + encodeURIComponent(derived.password);

  const resolved = await service.resolvePassword({
    username: 'test@me.com',
    site: 'https://localhost/login',
    login_index: 1
  });
  assert.strictEqual(resolved.password, derived.password);

  const browserResult = await signInSession({
    url: loginUrl,
    username: resolved.username,
    password: resolved.password,
    success_url_includes: 'dashboard.html',
    headless: true,
    timeout_ms: 30000
  });

  assert.strictEqual(browserResult.ok, true, JSON.stringify(browserResult));
  assert.match(browserResult.url, /dashboard\.html/);

  // Mode B path
  process.env.ALIENPASS_MODE = 'keyring';
  const modeB = createCredentialService({
    mode: 'keyring',
    keyring: service.keyring,
    siteDirectory: service.siteDirectory
  });
  modeB.keyring.store(
    { username: 'test@me.com', domain: 'localhost', kind: 'password' },
    'fixture-password'
  );
  const loginB = pathToFileURL(loginPath).href;
  const resolvedB = await modeB.resolvePassword({
    username: 'test@me.com',
    domain: 'localhost'
  });
  const browserB = await signInSession({
    url: loginB,
    username: resolvedB.username,
    password: resolvedB.password,
    success_url_includes: 'dashboard.html',
    headless: true,
    timeout_ms: 30000
  });
  assert.strictEqual(browserB.ok, true, JSON.stringify(browserB));

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      ok: true,
      compose_signin: true,
      keyring_signin: true,
      via: browserResult.via
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
