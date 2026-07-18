#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const engine = require('./alienpass-engine');

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

  console.log(
    JSON.stringify({
      ok: true,
      engine: out.engine,
      sample_length: out.password.length,
      deterministic: true
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
