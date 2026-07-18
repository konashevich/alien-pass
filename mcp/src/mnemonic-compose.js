/**
 * Composed AlienPass mnemonic (Mode A / compose).
 *
 * Human model:
 *   InputString secret = applyCasing(siteToken) + masterSecret
 *   e.g. token "gmail" + casing last_upper + master "Tower35"
 *        → "gmaiLTower35"
 *
 * Optional modifiers prefix (AlienPass grammar):
 *   "abc11:" + assembled → "abc11:gmaiLTower35"
 *
 * Site token is associative (gmail ≠ google.com). That mapping is secret
 * material and must never be returned to cloud or local LLM tools.
 */
'use strict';

const CASING = {
  none: (token) => String(token),
  as_stored: (token) => String(token),
  last_upper: (token) => {
    const s = String(token);
    if (!s) return s;
    return s.slice(0, -1).toLowerCase() + s.slice(-1).toUpperCase();
  },
  first_upper: (token) => {
    const s = String(token);
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  },
  all_lower: (token) => String(token).toLowerCase(),
  all_upper: (token) => String(token).toUpperCase()
};

function applyCasing(token, rule = 'last_upper') {
  const fn = CASING[rule] || CASING.last_upper;
  return fn(token);
}

/**
 * @param {{
 *   siteToken: string,
 *   masterSecret: string,
 *   casing?: string,
 *   modifiers?: string
 * }} parts
 * @returns {{ inputString: string, secretPart: string }}
 */
function assembleInputString(parts) {
  const siteToken = String(parts.siteToken || '');
  const masterSecret = String(parts.masterSecret || '');
  if (!siteToken) throw Object.assign(new Error('site_token_missing'), { code: 'site_token_missing' });
  if (!masterSecret) throw Object.assign(new Error('master_missing'), { code: 'master_missing' });

  const secretPart = applyCasing(siteToken, parts.casing || 'last_upper') + masterSecret;
  let modifiers = String(parts.modifiers || '').trim();
  if (modifiers && !modifiers.endsWith(':')) {
    // Allow "abc11" as shorthand for "abc11:"
    if (/^(abc|pin)?\d{0,2}$/.test(modifiers)) modifiers = `${modifiers}:`;
  }
  const inputString = modifiers ? `${modifiers}${secretPart}` : secretPart;
  return { inputString, secretPart };
}

/**
 * Resolve which site profile matches a URL / host.
 * Profiles are expected to carry hosts[] without exposing tokens in logs.
 */
function matchSiteProfile(profiles, urlOrHost) {
  const raw = String(urlOrHost || '').trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    if (raw.includes('://')) host = new URL(raw).hostname.toLowerCase();
  } catch {
    host = raw.replace(/^https?:\/\//, '').split('/')[0];
  }
  host = host.replace(/^www\./, '');

  const list = Array.isArray(profiles) ? profiles : [];
  let best = null;
  let bestLen = -1;
  for (const profile of list) {
    const hosts = profile.hosts || [];
    for (const h of hosts) {
      const needle = String(h || '')
        .toLowerCase()
        .replace(/^www\./, '');
      if (!needle) continue;
      if (host === needle || host.endsWith(`.${needle}`)) {
        if (needle.length > bestLen) {
          best = profile;
          bestLen = needle.length;
        }
      }
    }
    if (profile.id && host === String(profile.id).toLowerCase()) {
      if (String(profile.id).length > bestLen) {
        best = profile;
        bestLen = String(profile.id).length;
      }
    }
  }
  return best;
}

module.exports = {
  CASING,
  applyCasing,
  assembleInputString,
  matchSiteProfile
};
