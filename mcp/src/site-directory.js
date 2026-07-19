/**
 * Encrypted site directory for composed mnemonics.
 *
 * On disk (mode 0600): AES-256-GCM ciphertext.
 * Vault key lives in the keyring (kind=vault_key), never beside the file in cleartext.
 *
 * Profile fields (all inside ciphertext):
 *   id, hosts[], token, casing?, modifiers?, login_index?, username?
 *
 * Public metadata that agents may see: only whether a host is "known" via
 * auth_status / resolve_site — never token or master.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { matchSiteProfile } = require('./mnemonic-compose');

const VAULT_KIND = 'vault_key';
const MASTER_KIND = 'master';
const VAULT_USERNAME = '_vault';
const MASTER_USERNAME = '_master';

function vaultPath() {
  const override = process.env.ALIENPASS_SITE_VAULT;
  if (override) return override;
  return path.join(os.homedir(), '.local', 'share', 'alienpass-mcp', 'sites.vault');
}

function ensureVaultKey(keyring) {
  let keyB64 = keyring.lookup({
    username: VAULT_USERNAME,
    domain: '*',
    kind: VAULT_KIND
  });
  if (!keyB64) {
    keyB64 = crypto.randomBytes(32).toString('base64');
    keyring.store(
      { username: VAULT_USERNAME, domain: '*', kind: VAULT_KIND },
      keyB64
    );
  }
  return Buffer.from(keyB64, 'base64');
}

function encryptJson(key, obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64')
  };
}

function decryptJson(key, blob) {
  if (!blob || blob.v !== 1) throw new Error('unsupported_vault_format');
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function readVaultFile() {
  const file = vaultPath();
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error('site_vault_corrupt'), {
      code: 'site_vault_corrupt',
      cause: error,
      path: file
    });
  }
  if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.ct || !parsed.tag) {
    throw Object.assign(new Error('unsupported_vault_format'), {
      code: 'unsupported_vault_format',
      path: file
    });
  }
  return parsed;
}

function writeVaultFile(blob) {
  const file = vaultPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(blob, null, 2), { mode: 0o600 });
}

function emptyDirectory() {
  return { version: 1, sites: [], default_casing: 'last_upper' };
}

function createSiteDirectory(keyring) {
  return {
    path: vaultPath(),

    load() {
      const key = ensureVaultKey(keyring);
      const blob = readVaultFile();
      if (!blob) return emptyDirectory();
      try {
        return decryptJson(key, blob);
      } catch (error) {
        throw Object.assign(new Error('site_vault_decrypt_failed'), {
          code: 'site_vault_decrypt_failed',
          cause: error,
          path: vaultPath()
        });
      }
    },

    save(directory) {
      const key = ensureVaultKey(keyring);
      writeVaultFile(encryptJson(key, directory));
      return { ok: true, path: vaultPath(), sites: (directory.sites || []).length };
    },

    upsertSite(profile) {
      if (!profile || !profile.id) throw new Error('site id is required');
      if (!profile.token) throw new Error('site token is required');
      const dir = this.load();
      const id = String(profile.id).trim();
      dir.sites = (dir.sites || []).filter((s) => s.id !== id);
      dir.sites.push({
        id,
        hosts: Array.isArray(profile.hosts) ? profile.hosts.map(String) : [],
        token: String(profile.token),
        casing: profile.casing || dir.default_casing || 'last_upper',
        modifiers: profile.modifiers || '',
        login_index: profile.login_index == null ? 1 : profile.login_index,
        username: profile.username || null
      });
      return this.save(dir);
    },

    deleteSite(id) {
      const dir = this.load();
      const before = (dir.sites || []).length;
      dir.sites = (dir.sites || []).filter((s) => s.id !== String(id).trim());
      const saved = this.save(dir);
      return { ...saved, deleted: before !== dir.sites.length, id: String(id).trim() };
    },

    listPublic() {
      const dir = this.load();
      return {
        default_casing: dir.default_casing || 'last_upper',
        sites: (dir.sites || []).map((s) => ({
          id: s.id,
          hosts: s.hosts || [],
          has_token: Boolean(s.token),
          casing: s.casing || dir.default_casing || 'last_upper',
          modifiers: s.modifiers ? '[set]' : '',
          login_index: s.login_index == null ? 1 : s.login_index,
          username: s.username || null
        }))
      };
    },

    resolve(urlOrHost) {
      const dir = this.load();
      return matchSiteProfile(dir.sites || [], urlOrHost);
    },

    resolveByUsername(username) {
      const user = String(username || '').trim().toLowerCase();
      if (!user) return null;
      const dir = this.load();
      const matches = (dir.sites || []).filter(
        (s) => String(s.username || '').trim().toLowerCase() === user
      );
      if (matches.length === 1) return matches[0];
      return null;
    },

    resolveById(id) {
      const dir = this.load();
      return (dir.sites || []).find((s) => s.id === String(id).trim()) || null;
    },

    resolveFlexible({ site, username, site_id } = {}) {
      if (site_id) {
        const byId = this.resolveById(site_id);
        if (byId) return byId;
      }
      if (site) {
        const byHost = this.resolve(site);
        if (byHost) return byHost;
      }
      if (username) {
        const byUser = this.resolveByUsername(username);
        if (byUser) return byUser;
      }
      return null;
    },

    getMaster() {
      return keyring.lookup({
        username: MASTER_USERNAME,
        domain: '*',
        kind: MASTER_KIND
      });
    },

    setMaster(secret) {
      if (!secret) throw new Error('master secret required');
      keyring.store(
        { username: MASTER_USERNAME, domain: '*', kind: MASTER_KIND },
        String(secret)
      );
      return { ok: true, kind: MASTER_KIND };
    },

    hasMaster() {
      return Boolean(this.getMaster());
    }
  };
}

module.exports = {
  createSiteDirectory,
  VAULT_KIND,
  MASTER_KIND,
  vaultPath
};
