/**
 * AlienPass v2.0 engine for Node (Web Crypto / globalThis.crypto).
 * Must stay algorithm-compatible with ../alienpass-v2.js and
 * docs/alien_pass_mnemonic_2.0.md.
 */
'use strict';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const NUMS = '0123456789';
const SYMBOLS = '!@_-';
const MIX_DEFAULT = UPPER + LOWER + NUMS + SYMBOLS;
const MIX_ABC = UPPER + LOWER + NUMS;
const INPUT_REGEX = /^(?:(abc|pin)?(\d{1,2})?\:)?(.*)$/;
const ENGINE_VERSION = 'v2.0.2';
const DEFAULT_LENGTH = 14;
const MIN_LENGTH = 4;
const MAX_LENGTH = 64;
const ITERATIONS = 600000;

function clampLength(rawLength) {
  const parsed = Number.parseInt(rawLength, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LENGTH;
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, parsed));
}

function parseCommandString(inputString) {
  const normalized = String(inputString || '');
  const match = normalized.match(INPUT_REGEX) || [];
  return {
    alphabet: match[1] || 'default',
    length: clampLength(match[2]),
    secret: match[3] || ''
  };
}

function parseLoginString(loginString) {
  const normalized = String(loginString || '').trim();
  const separatorIndex = normalized.lastIndexOf(',');

  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    throw new Error('Login must end with ,<index>, for example email@example.com,1.');
  }

  const login = normalized.slice(0, separatorIndex).trim();
  const index = normalized.slice(separatorIndex + 1).trim();

  if (!login || !/^\d+$/.test(index)) {
    throw new Error('Login must end with ,<index>, for example email@example.com,1.');
  }

  return {
    login,
    index,
    salt: `${login},${index}`
  };
}

function getCharsetForIndex(alphabet, index) {
  if (alphabet === 'pin') return NUMS;
  if (alphabet === 'abc') {
    if (index === 0) return UPPER;
    if (index === 1) return LOWER;
    if (index === 2) return NUMS;
    return MIX_ABC;
  }
  if (index === 0) return UPPER;
  if (index === 1) return LOWER;
  if (index === 2) return NUMS;
  if (index === 3) return SYMBOLS;
  return MIX_DEFAULT;
}

function formatPassword(hashBytes, parsedConfig) {
  const source = hashBytes instanceof Uint8Array ? hashBytes : new Uint8Array(hashBytes);
  let password = '';
  for (let index = 0; index < parsedConfig.length; index += 1) {
    const charset = getCharsetForIndex(parsedConfig.alphabet, index);
    const charIndex = source[index] % charset.length;
    password += charset[charIndex];
  }
  return password;
}

async function deriveHashBytes(secret, salt) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || !cryptoApi.subtle) {
    throw new Error('Web Crypto PBKDF2 is unavailable in this environment.');
  }

  const encoder = new TextEncoder();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    MAX_LENGTH * 8
  );

  return new Uint8Array(derivedBits);
}

/**
 * @param {{ login: string, inputString: string }} options
 */
async function generatePassword(options) {
  const inputString = String(options && options.inputString ? options.inputString : '').trim();
  const loginInput = String(options && options.login ? options.login : '').trim();

  if (!loginInput) throw new Error('Login is required.');

  const parsed = parseCommandString(inputString);
  const parsedLogin = parseLoginString(loginInput);

  if (!parsed.secret) {
    throw new Error('The secret part of the command string cannot be empty.');
  }

  const hashBytes = await deriveHashBytes(parsed.secret, parsedLogin.salt);
  return {
    parsed: {
      ...parsed,
      login: parsedLogin.login,
      index: parsedLogin.index
    },
    password: formatPassword(hashBytes, parsed),
    salt: parsedLogin.salt,
    engine: ENGINE_VERSION
  };
}

function withIndex(username, index = 1) {
  const base = String(username || '').trim();
  if (!base) throw new Error('Username is required.');
  if (base.includes(',')) return base;
  const n = Number.parseInt(String(index), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('login_index must be a non-negative integer.');
  }
  return `${base},${n}`;
}

module.exports = {
  ENGINE_VERSION,
  ITERATIONS,
  DEFAULT_LENGTH,
  MIN_LENGTH,
  MAX_LENGTH,
  parseCommandString,
  parseLoginString,
  generatePassword,
  withIndex
};
