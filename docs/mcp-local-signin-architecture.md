# AlienPass Local Sign-In MCP — Architecture Concept

Local-only credential workflow for Cursor IDE: the cloud main agent never sees passwords or master secrets. A Linux (arm64-compatible) MCP server plus an optional local LLM subagent perform sign-in in the embedded browser and return a non-secret status report.

## 1. Problem

| Actor | Model | Sees passwords? |
| --- | --- | --- |
| Main agent (Cursor IDE) | Cloud proprietary | **Must not** |
| Sign-in subagent | Local (SmolLM / Gemma via Ollama) | Prefer not; acceptable only in-process if unavoidable |
| AlienPass / keyring MCP | Local process on `127.0.0.1` / stdio | Yes (necessary) |

The main agent can use the embedded browser for navigation and page understanding. As soon as authentication is required, it must hand off a **non-secret** task to a local worker and continue only after a success/failure report that contains no credentials.

## 2. Design goals

1. **Secrets never leave the machine** and never enter cloud model context.
2. **AlienPass v2.0** remains the deterministic generator (`Login` + `InputString` → PBKDF2 → alphabet formatting). Spec: [`alien_pass_mnemonic_2.0.md`](./alien_pass_mnemonic_2.0.md).
3. **Linux arm64 first**: Node.js + Web Crypto (or OpenSSL), `libsecret` / `secret-tool`, no proprietary cloud vault required for this path.
4. **Three storage modes**:
   - **Mode A / compose (recommended for AlienPass users):** encrypted site directory maps URL→associative token; keyring holds one universal master suffix; MCP assembles `cased(token)+master` into AlienPass `InputString` in-process.
   - **Mode A / legacy:** keyring holds a full ready-made `InputString` per username/domain.
   - **Mode B (Keyring-only simplification):** keyring holds the final site password; AlienPass is not used at runtime.
5. **MCP tools prefer injection over disclosure**: prefer “fill this password field” over “return the password string to the LLM”.
6. **Associative tokens are secret:** `gmail` vs `google` is human memory logic and must not live in a cleartext host map that agents can read.

## 3. Trust boundaries

```text
┌─────────────────────────────────────────────────────────────────┐
│ Cursor IDE                                                      │
│                                                                 │
│  ┌──────────────────────┐     non-secret handoff                │
│  │ Main agent (cloud)   │ ──────────────────────────────────┐   │
│  │ - browser observe    │                                   │   │
│  │ - NO alienpass MCP   │                                   ▼   │
│  │ - NO keyring MCP     │     ┌───────────────────────────────┐ │
│  └──────────────────────┘     │ Local subagent (Ollama)       │ │
│                               │ - browser click / type UX     │ │
│                               │ - call local MCP only         │ │
│                               └───────────────┬───────────────┘ │
│                                               │ stdio MCP       │
│                                               ▼                 │
│                               ┌───────────────────────────────┐ │
│                               │ alienpass-mcp (this process)  │ │
│                               │ - keyring (libsecret)         │ │
│                               │ - AlienPass v2 derive         │ │
│                               │ - CDP fill / or password out  │ │
│                               └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Hard rule:** attach `alienpass-mcp` only to the local subagent (or a dedicated local agent profile). Do not register it on the cloud main agent’s MCP list. If the main agent can call `generate_password`, the design has already failed.

## 4. End-to-end workflow

### 4.1 Happy path

1. Main agent opens or inspects a site in the embedded browser.
2. It detects an unauthenticated state (login form, redirect to IdP, session cookie missing).
3. It spawns / tasks a **local** subagent with a payload that contains **only**:
   - `url` (or “use already-open tab”)
   - `username` / email (public identifier)
   - optional `login_index` (AlienPass `,N` suffix, default `1`)
   - optional `account_id` / domain hint for keyring lookup
   - instruction: “sign in and report status; never echo secrets”
4. Local subagent:
   - ensures the page is open;
   - locates username / password fields (DOM or accessibility tree);
   - calls MCP `fill_login` (preferred) or Mode B `fill_stored_password`;
   - submits the form;
   - waits for a post-login signal (URL change, absence of login form, known dashboard selector);
   - returns a report to the main agent.
5. Main agent resumes work. It never received the password.

### 4.2 Report contract (safe for cloud)

```json
{
  "ok": true,
  "site": "https://example.com/app",
  "username": "you@example.com",
  "method": "alienpass-v2",
  "login_index": 1,
  "evidence": "url_changed_to_/dashboard",
  "duration_ms": 4200
}
```

On failure, return `ok: false` plus a **non-secret** reason (`selector_not_found`, `keyring_miss`, `challenge_2fa`, `wrong_password_likely`). Never include password, mnemonic, or keyring payload.

### 4.3 What the local LLM is for

The local model handles **brittle UI**: cookie banners, weird form layouts, “continue with email” multi-step flows. Cryptography and secret I/O stay in the MCP process.

If UI automation is reliable enough for your sites, collapse further: main agent calls a single local MCP tool `sign_in_session({ url, username })` with **no LLM in the middle**. That is the strongest leak resistance.

## 5. Secret storage layout (Linux keyring + encrypted site directory)

### 5.1 Mode A / compose — associative mnemonic assembly (your real model)

AlienPass does not receive a single pre-baked string from the agent. The MCP **assembles** the secret part of `InputString` under the hood:

```text
secretPart   = applyCasing(siteToken) + masterSecret
               e.g. last_upper("gmail") + "Tower35"  →  "gmaiLTower35"
InputString  = [optional modifiers] + secretPart
               e.g. "abc11:" + "gmaiLTower35"        →  "abc11:gmaiLTower35"
Password     = AlienPassV2(Login=email,index , InputString)
```

Why a directory is required:

- The “domain” fragment inside the mnemonic is **associative**, not algorithmic.
- Sometimes it equals the public hostname (`facebook` ↔ facebook.com).
- Sometimes it does not (`gmail` for Google properties because historically only mail was used).
- That map is itself secret material: storing `accounts.google.com → gmail` in cleartext would leak how you build mnemonics.

What is stored where:

| Piece | Where | Cleartext to agents? |
| --- | --- | --- |
| Universal master suffix | libsecret `kind=master` | No |
| AES vault key | libsecret `kind=vault_key` | No |
| Site profiles (`id`, `hosts[]`, `token`, casing, modifiers, index) | Encrypted file `sites.vault` (AES-256-GCM) | No (public list shows id/hosts/`has_token` only) |
| Casing rule default (`last_upper`, …) | Inside vault / config | Algorithm is public; tokens stay secret |
| Final site password | Not stored | N/A — ephemeral |

Protected-mode assembly (yes, this is the “тайный” compute path):

1. Local subagent calls `fill_login({ site: url, username })` only.
2. MCP unlocks keyring → loads vault key → decrypts site directory in memory.
3. Matches host → profile → reads `token` + `master`.
4. Applies casing, concatenates, runs AlienPass v2.
5. Injects password (or holds it for CDP); wipes buffers.
6. Returns cloud-safe report. **Never** returns token, master, or assembled `InputString` unless `ALIENPASS_ALLOW_REVEAL=1` for local debug.

There is no need for a separate TEE/HSM for v1: the MCP process + OS keyring lock + `ALLOW_REVEAL=0` is the protected mode. Optional later hardening: polkit confirm on first unlock per session, or a tiny helper binary that only exposes `fill` over a local socket.

### 5.2 Mode A / legacy — full InputString in keyring

| Attribute | Value |
| --- | --- |
| `kind` | `mnemonic` |
| secret value | Full InputString, e.g. `gmaiLTower35` or `abc11:WeirdSiteTower` |

Use only if you do not need the associative directory.

### 5.3 Mode B — stored passwords

| Attribute | Value |
| --- | --- |
| `kind` | `password` |
| secret value | Final site password |

No AlienPass derivation.

Optional: store AlienPass index per site inside the encrypted profile so the cloud agent only passes email + URL.

## 6. MCP tool surface

Prefer tools that **act** over tools that **reveal**.

### Core (both modes)

| Tool | Purpose | Returns secret? |
| --- | --- | --- |
| `list_accounts` | List usernames / domains / kinds | No |
| `auth_status` | Whether a keyring entry exists for username+domain | No |
| `report_template` | Echo the safe report schema | No |

### Mode A — AlienPass v2 (compose + legacy)

| Tool | Purpose | Returns secret? |
| --- | --- | --- |
| `store_master_secret` | Save universal mnemonic suffix | No |
| `upsert_site_profile` | Save encrypted host→token profile | No |
| `fill_login` | Assemble + derive + inject | **No** |
| `generate_password` | Reveal derive result (gated) | **Yes if enabled** |
| `store_mnemonic` | Legacy full InputString | No |

Generation must match v2:

- Salt = `Login` with comma index, e.g. `you@example.com,1`
- PBKDF2-HMAC-SHA256, 600000 iterations, 64-byte derive then format per alphabet rules
- `InputString` grammar: `^(?:(abc|pin)?(\d{1,2})?\:)?(.*)$`
- In compose mode the `(.*)` secret part is `cased(token)+master`, built only inside MCP.

### Mode B — keyring-only simplification

| Tool | Purpose | Returns secret? |
| --- | --- | --- |
| `fill_stored_password` | Read password from keyring; inject into page | **No** |
| `store_password` | Save site password (migration / sites AlienPass cannot express) | No |
| `get_password` | Debug only; disabled by default via config | Yes if enabled |

**Recommendation:** implement Mode B first if your goal is “stop leaking passwords to the cloud agent” with minimal moving parts. Add Mode A when you want zero long-term password storage and AlienPass determinism.

## 7. Browser integration options

### Option 1 — Subagent drives Cursor browser tools (user’s described flow)

- Local LLM receives username + MCP fill tools.
- Risk: if the LLM uses a generic `type_text` tool and the MCP returns the password, the password enters local context (still better than cloud, worse than injection).
- Mitigate with `fill_login` that talks to the same browser CDP endpoint Cursor uses, so the LLM only passes CSS/xpath selectors.

### Option 2 — MCP owns Playwright/CDP session

- `sign_in_session` opens Chromium, fills, submits, returns report.
- Local LLM optional.
- Cleaner isolation; more work to share cookies with Cursor’s embedded browser.

### Option 3 — Hybrid (recommended conceptually)

- Cursor embedded browser stays the session owner (cookies visible to main agent after login).
- MCP connects to that browser’s debug port **only for credential field injection**.
- Local LLM orchestrates clicks; MCP never returns the password string.

## 8. Cursor wiring (conceptual)

### 8.1 MCP config (local profile only)

```json
{
  "mcpServers": {
    "alienpass": {
      "command": "node",
      "args": ["/absolute/path/to/alien-pass/mcp/src/server.js"],
      "env": {
        "ALIENPASS_MODE": "compose",
        "ALIENPASS_ALLOW_REVEAL": "0",
        "ALIENPASS_KEYRING_COLLECTION": "login"
      }
    }
  }
}
```

For Mode B set `ALIENPASS_MODE=keyring`. For legacy full-mnemonic Mode A set `ALIENPASS_MODE=alienpass`.

### 8.2 Agent split

- **Main (cloud):** browser observe/navigate; may call a **thin** `request_local_signin` bridge that only forwards `{url, username}`; must not list alienpass tools.
- **Subagent (local model):** system prompt forbids printing secrets; tools = browser + alienpass MCP.

### 8.3 Local model host (arm64 Linux)

- Ollama (or llama.cpp server) with `smollm`, `gemma2:2b` / `gemma3` class models that fit the device.
- Cursor pointed at that OpenAI-compatible endpoint for the subagent only.
- No requirement that AlienPass crypto run inside the LLM.

## 9. Linux arm64 compatibility notes

| Component | arm64 stance |
| --- | --- |
| Node.js 20+ / Web Crypto PBKDF2 | Supported (same algorithm as `alienpass-v2.js`) |
| `@modelcontextprotocol/sdk` | Pure JS / widely used on aarch64 |
| `secret-tool` + `libsecret` | Distro packages on Debian/Ubuntu/Fedora aarch64 |
| AES-256-GCM site vault | Node `crypto` (OpenSSL) on aarch64 |
| Ollama local models | Works on arm64; pick model size for RAM |
| Native `keytar` | Avoid as primary; optional. Prefer `secret-tool` subprocess for fewer native build issues |

No Android/WebView dependency for this MCP path; it reuses the v2 algorithm only.

## 10. Threat model (short)

| Threat | Mitigation |
| --- | --- |
| Cloud model exfiltrates password | Never attach reveal/fill MCP to cloud agent; reports are non-secret |
| Local model learns associative map | Encrypted vault; `list_accounts` omits tokens; reveal disabled |
| Local model logs password | Prefer `sign_in_session`; `ALIENPASS_ALLOW_REVEAL=0`; no fingerprints |
| Agent mutates vault | `ALIENPASS_AGENT_SAFE=1` blocks setup tools; use CLI for setup |
| Cleartext site→token file on disk | AES-GCM vault; key in libsecret (or encrypted file fallback) |
| File fallback weaker than keyring | Encrypted at rest + doctor warning; prefer libsecret |
| Wrong-tab CDP fill | Host-matched tab selection; refuse ambiguous/mismatched targets |
| False “signed in” | `ok:true` only with explicit success selector/URL |
| Malicious page steals typed password | Same as normal browser login; user/site risk unchanged |
| MCP process dump | OS user isolation; keyring locked when session locked |
| Prompt injection | Agent-safe tool surface + local system prompt + reveal disabled |
| 2FA / passkeys | Report `unverified` / challenge; stop |

## 11. Implementation phases

1. **Skeleton MCP** — stdio server, Mode B `store_password` / `fill_stored_password` stubs, safe report helper.
2. **Keyring backend** — `secret-tool` integration on Linux.
3. **AlienPass v2 port** — share algorithm with `alienpass-v2.js` (Node Web Crypto).
4. **Mode A compose** — encrypted site directory, master secret, casing assembly, `fill_login`.
5. **Browser injection** — CDP attach / Playwright launch; `sign_in_session` implemented.
6. **Cursor profiles** — document local subagent + MCP; deny cloud attachment.
7. **Optional later** — polkit confirm-on-unlock; tighter sandbox helper binary.

## 12. Why not only keyring? Why not only AlienPass?

- **Keyring-only (Mode B):** smallest design that solves the stated leak. You already store secrets; the MCP is a gate so the cloud agent never reads them.
- **AlienPass compose (Mode A):** matches human associative mnemonics: one protected master + small encrypted token directory; site passwords stay ephemeral; rotation via `,index` or token/master change.
- **AlienPass legacy:** full InputString per site in keyring — simpler, but duplicates the master suffix everywhere.

You can run both: Mode A compose for AlienPass sites; Mode B for inherited passwords you have not migrated.

## 13. Non-goals (for this concept)

- Replacing the Android/Capacitor app or IndexedDB vault UI.
- Syncing mnemonics to Google Drive from the MCP.
- Teaching the cloud agent to “be careful” with passwords (policy, not a boundary).
- Guaranteeing sign-in on every site (CAPTCHA, bank anti-bot, passkeys need humans).

## 14. Reference mapping to repo

| Repo artifact | Role in this design |
| --- | --- |
| `docs/alien_pass_mnemonic_2.0.md` | Normative crypto / grammar |
| `alienpass-v2.js` | Reference implementation to port/reuse in `mcp/` |
| `mcp/` | Local stdio MCP server (Linux arm64) |
| Cursor MCP + local model config | Operator wiring; not shipped as cloud config |

---

**Bottom line:** split agents at the secret boundary. Cloud agent detects “need auth” and only learns “auth done”. Local MCP assembles associative AlienPass mnemonics (encrypted site tokens + keyring master) or fetches Mode B passwords, then injects credentials on-device.
