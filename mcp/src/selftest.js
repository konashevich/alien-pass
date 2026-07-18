#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('./alienpass-engine');
const { applyCasing, assembleInputString, matchSiteProfile } = require('./mnemonic-compose');
const { createKeyring } = require('./keyring');
const { createSiteDirectory } = require('./site-directory');

async function main() {
  const parsed = engine.parseCommandString('abc11:WeirdSiteTower');
  assert.strictEqual(parsed.alphabet, 'abc');
  assert.strictEqual(parsed.length, 11);
  assert.strictEqual(parsed.secret, 'WeirdSiteTower');

  const login = engine.parseLoginString('test@me.com,1');
  assert.strictEqual(login.salt, 'test@me.com,1');

  const out = await engine.generatePassword({
    login: 'test@me.com,1',
    inputString: 'GmailTower'
  });
  assert.strictEqual(out.password.length, 14);
  assert.match(out.password[0], /[A-Z]/);
  assert.match(out.password[1], /[a-z]/);
  assert.match(out.password[2], /[0-9]/);
  assert.match(out.password[3], /[!@_-]/);

  const again = await engine.generatePassword({
    login: 'test@me.com,1',
    inputString: 'GmailTower'
  });
  assert.strictEqual(out.password, again.password);

  assert.strictEqual(applyCasing('gmail', 'last_upper'), 'gmaiL');
  assert.strictEqual(applyCasing('facebook', 'last_upper'), 'facebooK');

  const assembled = assembleInputString({
    siteToken: 'gmail',
    masterSecret: 'Tower35',
    casing: 'last_upper',
    modifiers: 'abc11'
  });
  assert.strictEqual(assembled.secretPart, 'gmaiLTower35');
  assert.strictEqual(assembled.inputString, 'abc11:gmaiLTower35');

  const matched = matchSiteProfile(
    [
      { id: 'google-mail', hosts: ['accounts.google.com', 'mail.google.com'], token: 'gmail' },
      { id: 'facebook', hosts: ['facebook.com'], token: 'facebook' }
    ],
    'https://mail.google.com/mail/u/0/'
  );
  assert.strictEqual(matched.id, 'google-mail');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alienpass-compose-'));
  process.env.ALIENPASS_FORCE_FALLBACK = '1';
  process.env.ALIENPASS_FALLBACK_STORE = path.join(tmpRoot, 'store.json');
  process.env.ALIENPASS_SITE_VAULT = path.join(tmpRoot, 'sites.vault');

  const keyring = createKeyring();
  const directory = createSiteDirectory(keyring);
  directory.setMaster('Tower35');
  directory.upsertSite({
    id: 'google-mail',
    hosts: ['accounts.google.com', 'mail.google.com', 'google.com'],
    token: 'gmail',
    casing: 'last_upper',
    modifiers: '',
    login_index: 1,
    username: 'test@me.com'
  });

  const pub = directory.listPublic();
  assert.strictEqual(pub.sites.length, 1);
  assert.strictEqual(pub.sites[0].has_token, true);
  assert.strictEqual(pub.sites[0].token, undefined);

  const profile = directory.resolve('https://accounts.google.com/signin');
  assert.ok(profile);
  const composed = assembleInputString({
    siteToken: profile.token,
    masterSecret: directory.getMaster(),
    casing: profile.casing,
    modifiers: profile.modifiers
  });
  assert.strictEqual(composed.inputString, 'gmaiLTower35');

  const derived = await engine.generatePassword({
    login: 'test@me.com,1',
    inputString: composed.inputString
  });
  assert.strictEqual(derived.password.length, 14);

  // vault file must not contain cleartext token
  const vaultRaw = fs.readFileSync(process.env.ALIENPASS_SITE_VAULT, 'utf8');
  assert.doesNotMatch(vaultRaw, /gmail/);
  assert.doesNotMatch(vaultRaw, /Tower35/);

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(
    JSON.stringify({
      ok: true,
      engine: out.engine,
      sample_length: out.password.length,
      deterministic: true,
      compose: true,
      composed_sample: 'gmaiLTower35',
      vault_hides_token: true
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
