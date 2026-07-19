# AlienPass MCP — End-to-End Install & Configuration

Full guide: install the local product, store secrets, run a local model, wire Cursor, and run the cloud → local sign-in workflow.

Related:

- Architecture: [`../docs/mcp-local-signin-architecture.md`](../docs/mcp-local-signin-architecture.md)
- Package README: [`README.md`](./README.md)
- Subagent prompt: [`config/local-subagent-system-prompt.md`](./config/local-subagent-system-prompt.md)

---

## 0. What you are building

```text
┌─────────────────────────────┐
│ Cursor main agent (cloud)   │  sees: URL, email, “need auth?”
│ NO passwords / NO mnemonics │  must NOT have reveal tools
└──────────────┬──────────────┘
               │ handoff: {url, username}
               ▼
┌─────────────────────────────┐
│ Local worker                │  Ollama model and/or MCP-only
│ + alienpass-mcp (AGENT_SAFE)│  assembles secret, fills browser
└──────────────┬──────────────┘
               │ report: {ok, site, evidence}  (no secrets)
               ▼
┌─────────────────────────────┐
│ Cloud agent resumes work    │
└─────────────────────────────┘
```

Two practical setups (pick one):

| Setup | When to use | Secret exposure |
| --- | --- | --- |
| **A — MCP-only (simplest)** | `sign_in_session` can drive Chrome alone | Password never returned; cloud may call MCP but cannot read secrets |
| **B — Local subagent + Ollama (stronger)** | Brittle UIs / you refuse cloud calling credential tools | Cloud never even sees alienpass tools |

**Recommendation:** start with **A**, then move to **B** if you want a harder trust split.

---

## 1. Prerequisites (Linux, x86_64 or arm64)

- Node.js **20+** (`node -v`)
- Google Chrome or Chromium
- Git clone of this repo
- Optional but recommended: `secret-tool` (libsecret) for a real desktop keyring
- For Setup B: [Ollama](https://ollama.com) (or LM Studio)

Check:

```bash
node -v
which google-chrome || which chromium || which chromium-browser
```

---

## 2. Install alienpass-mcp

```bash
cd /path/to/alien-pass/mcp
bash scripts/install.sh
# equivalent:
#   npm install
#   npm test
```

`npm test` runs crypto/compose tests and a real Chrome login against `fixtures/`. If Chrome is missing, install it before relying on sign-in.

Confirm:

```bash
node src/cli.js doctor
```

You want:

- `chrome_path` set
- `keyring_backend`: `libsecret` (best) or `file-fallback-encrypted` (OK for testing, weaker)

### 2.1 Prefer libsecret (desktop Linux)

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y libsecret-tools gnome-keyring
```

Fedora:

```bash
sudo dnf install -y libsecret
```

Then unlock your login keyring (graphical session) and re-run:

```bash
node src/cli.js doctor
```

If doctor still shows file fallback, you can force it for CI only:

```bash
export ALIENPASS_FORCE_FALLBACK=1   # not for long-term secrets on a shared machine
```

---

## 3. Create your vault (one-time, human/CLI only)

Do this in a terminal. Do **not** paste your master secret into any cloud chat.

### 3.1 Compose mode (AlienPass associative mnemonics) — default

```bash
cd /path/to/alien-pass/mcp

# Universal mnemonic suffix (the secret after the site token)
node src/cli.js init-master 'YourUniversalSecret'

# Associative site token: google properties → "gmail", last letter uppercased → gmaiL
node src/cli.js add-site google-mail gmail \
  accounts.google.com,mail.google.com,google.com \
  --user you@example.com \
  --casing last_upper \
  --index 1

# Facebook-style (token matches domain)
node src/cli.js add-site facebook facebook \
  facebook.com,www.facebook.com \
  --user you@example.com \
  --casing last_upper

node src/cli.js list-sites
node src/cli.js auth-status https://accounts.google.com
```

Assembly under the hood (never printed to agents):

```text
token "gmail" + last_upper + master → "gmaiL" + "YourUniversalSecret"
→ AlienPass v2 InputString secret part
→ site password
```

### 3.2 Mode B (store final passwords)

```bash
node src/cli.js store-password you@example.com example.com 'the-site-password'
ALIENPASS_MODE=keyring node src/cli.js auth-status --kind password
```

### 3.3 Smoke-test sign-in from CLI

```bash
# Must pass --success-url or --success-selector for ok:true (verified)
node src/cli.js sign-in 'https://accounts.google.com' you@example.com \
  --headed \
  --success-url 'myaccount.google.com'
```

Exit code `0` and `"ok": true` means verified success.

---

## 4. Install a local AI model (Setup B)

### 4.0 Rockchip RK3588 NPU (FriendlyElec) — recommended on-device

Use **Qwen2.5-1.5B-Instruct** via RKLLM + **RKLLama** (OpenAI `/v1`).  
Full board steps: [`rk3588-local-model.md`](./rk3588-local-model.md) and `mcp/scripts/rk3588/`.

### 4.1 Install Ollama (x86/arm CPU stand-in, or non-NPU hosts)

Use a small local model for the **sign-in worker only**.

```bash
# Linux install script from https://ollama.com (or your distro package)
curl -fsSL https://ollama.com/install.sh | sh
ollama --version
```

### 4.2 Pull a small model (arm64 / modest RAM)

Pick one that fits your machine:

```bash
# Very small
ollama pull smollm2:1.7b

# Or Gemma-class small instruct
ollama pull gemma2:2b

# Slightly stronger if you have RAM/GPU
ollama pull gemma2:9b
```

Warm it up:

```bash
ollama run gemma2:2b "Reply with OK only."
```

OpenAI-compatible endpoint (used by Cursor):

```text
http://127.0.0.1:11434/v1
```

CORS (if Cursor cannot reach Ollama):

```bash
export OLLAMA_ORIGINS='*'
# restart ollama service/app after setting this
```

Verify:

```bash
curl -s http://127.0.0.1:11434/api/tags | head
curl -s http://127.0.0.1:11434/v1/models | head
```

### 4.3 LM Studio alternative

- Start local server on `http://127.0.0.1:1234/v1`
- Load a small instruct model
- Use that base URL instead of Ollama’s in Cursor

---

## 5. Configure Cursor MCP (required for A and B)

### 5.1 Find your absolute path

```bash
realpath /path/to/alien-pass/mcp/src/server.js
# example: /home/you/src/alien-pass/mcp/src/server.js
```

### 5.2 Write MCP config

**Global (recommended for secrets tooling):** `~/.cursor/mcp.json`  
**Or project:** `/path/to/alien-pass/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "alienpass": {
      "command": "node",
      "args": ["/ABS/PATH/alien-pass/mcp/src/server.js"],
      "env": {
        "ALIENPASS_MODE": "compose",
        "ALIENPASS_ALLOW_REVEAL": "0",
        "ALIENPASS_AGENT_SAFE": "1"
      }
    }
  }
}
```

Notes:

- `ALIENPASS_AGENT_SAFE=1` blocks vault mutation + password reveal from the agent. Setup stays CLI-only.
- Do **not** set `ALIENPASS_ALLOW_REVEAL=1` in Cursor.
- Optional CDP (keep Cursor/Chrome session cookies):

```json
"ALIENPASS_CDP_URL": "http://127.0.0.1:9222"
```

### 5.3 Enable in Cursor UI

1. Open **Cursor Settings** → **Tools & MCP** (or Ctrl/Cmd+Shift+J → Tools & MCP).
2. Confirm `alienpass` is listed and green / tools visible.
3. If “no tools”: run the same `node …/server.js` in a terminal and fix path/Node errors first.

### 5.4 Critical policy

| Profile | alienpass MCP? |
| --- | --- |
| Cloud / proprietary main agent | Prefer **no** alienpass tools (Setup B). Setup A may attach AGENT_SAFE tools only. |
| Local sign-in worker | **Yes**, with `AGENT_SAFE=1` |

If the cloud agent can call `generate_password` with reveal enabled, the design has failed.

---

## 6. Configure Cursor for a local model (Setup B)

Cursor’s “Override OpenAI Base URL” is typically **global** for Chat/Agent. That fights a dual cloud+local setup. Use one of these patterns:

### Pattern B1 — Dedicated local Chat for sign-in (practical)

1. Start Ollama with your model loaded.
2. Cursor Settings → **Models**:
   - Enable OpenAI-compatible / override base URL: `http://127.0.0.1:11434/v1`
   - API key: any non-empty string, e.g. `ollama`
   - Add model name exactly as in `ollama list` (e.g. `gemma2:2b`)
   - Verify connection
3. Open a **separate Chat/Agent tab** used only for sign-in.
4. Paste the system instructions from  
   `mcp/config/local-subagent-system-prompt.md`.
5. Select the local model in that chat.
6. When done signing in, switch back to a cloud model for normal work  
   (or keep a second Cursor window on cloud without the override).

**Limitation:** Tab autocomplete usually stays on Cursor cloud models; only Chat/Agent/Cmd+K follow the OpenAI override. UI labels move between Cursor versions — look for “OpenAI API”, “Base URL”, “Override”, or “OpenAI-compatible”.

### Pattern B2 — No local LLM (still secure): MCP-only Setup A

Skip Ollama. Cloud (or any) agent calls only:

```text
sign_in_session({ url, username, success_url_includes })
```

Tool result contains **no password**. This is the simplest end-to-end path and is already useful.

### Pattern B3 — CLI handoff (maximum isolation)

Cloud agent detects login page and tells you / runs:

```bash
node /ABS/PATH/mcp/src/cli.js sign-in 'URL' 'email@x' --success-url '…'
```

You paste back only the JSON `report` object.

---

## 7. Browser session options

### 7.1 Temporary Chrome (default)

`sign_in_session` launches Chrome, signs in, then **closes** it.  
Good for testing; **does not** leave Cursor’s embedded browser logged in.

### 7.2 Attach to an existing Chrome via CDP (keep session)

Start Chrome with remote debugging (example):

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/alienpass-chrome
```

Then:

```bash
export ALIENPASS_CDP_URL=http://127.0.0.1:9222
# or put the same env in mcp.json
```

MCP will fill a tab whose host matches the target URL. Mismatched/ambiguous tabs are refused.

Cursor’s built-in Simple Browser may not expose CDP the same way — prefer a system Chrome you control when session continuity matters.

---

## 8. End-to-end workflows

### 8.1 Setup A — MCP-only (recommended first)

1. Complete sections 2–3 and 5.
2. In cloud Agent chat:

```text
I need to sign in at https://accounts.google.com as you@example.com.
Use the alienpass MCP tool sign_in_session.
Pass success_url_includes that proves login (e.g. myaccount.google.com).
Return only the report JSON. Never ask me for passwords.
```

3. Agent calls MCP → local process derives password → Chrome signs in → report returns.
4. Continue work if `report.ok === true`.

### 8.2 Setup B — Local subagent + Ollama

1. Complete sections 2–6 (Pattern B1).
2. Main cloud agent (no alienpass MCP, or instructed never to call it):

```text
Auth required on <url> for <email>.
Delegate to the local sign-in worker. Do not request or accept passwords.
```

3. In the **local-model** chat, paste:

```text
Sign in on <url> as <email>.
Use alienpass sign_in_session (or fill_login if CDP is attached).
Never print secrets. Return only build_signin_report / report JSON.
```

4. Paste that report back to the cloud agent.

### 8.3 What a good report looks like

```json
{
  "ok": true,
  "site": "https://accounts.google.com",
  "username": "you@example.com",
  "method": "alienpass-v2-compose",
  "login_index": 1,
  "evidence": "url_includes:myaccount.google.com",
  "error_code": null,
  "message": null,
  "verified": true,
  "secrets_included": false
}
```

---

## 9. Cursor project rules (optional but useful)

Add a project rule / user rule so the **cloud** agent behaves:

```text
Password / sign-in policy:
- Never ask the user to paste passwords or AlienPass mnemonics into chat.
- If authentication is required, use alienpass sign_in_session when available,
  or ask for a local sign-in report JSON only.
- Never call generate_password. Never log tool fields named password/input_string.
- Treat any message containing a password as accidental leakage; do not store it.
```

Keep vault setup instructions out of cloud context.

---

## 10. Verification checklist

```bash
cd /path/to/alien-pass/mcp
node src/cli.js doctor
node src/cli.js list-sites
npm test
```

In Cursor:

- [ ] MCP `alienpass` shows tools: `doctor`, `sign_in_session`, `auth_status`, …
- [ ] `store_master_secret` fails with `setup_disabled` while `AGENT_SAFE=1`
- [ ] Local Ollama responds (Setup B): `curl http://127.0.0.1:11434/v1/models`
- [ ] CLI sign-in to a real site returns `ok: true` with a success URL
- [ ] Cloud chat never receives a password field

---

## 11. Troubleshooting

| Symptom | Fix |
| --- | --- |
| MCP “no tools” | Absolute path wrong; Node not on PATH Cursor uses; run server manually |
| `secret-tool_not_found` | Install libsecret tools or accept encrypted file fallback |
| `site_profile_miss` | `add-site` with hosts that match the login URL, or pass `--site-id` |
| `master_missing` | `init-master` first |
| `ok: false` / `unverified` | Pass `--success-url` / `success_url_includes` or `success_selector` |
| `cdp_host_mismatch` | Wrong tab open; open the login host or let launch mode navigate |
| Ollama not reachable from Cursor | `OLLAMA_ORIGINS=*`, correct `/v1` URL, firewall, restart Cursor |
| Signed in but Cursor browser still logged out | Expected without CDP; use §7.2 |
| 2FA / passkey | Stop; report `challenge_2fa`; complete manually |

---

## 12. Security reminders

1. Master secret and site tokens are entered only via **CLI**, never cloud chat.
2. Cursor MCP env must keep `ALLOW_REVEAL=0` and `AGENT_SAFE=1`.
3. File-fallback is encrypted but weaker than a locked desktop keyring.
4. Prompt injection: prefer Setup B (cloud cannot see alienpass tools) for highest assurance.
5. This does not defeat site anti-bot, CAPTCHA, or passkeys.

---

## 13. Quick copy-paste (minimal Setup A)

```bash
cd ~/src/alien-pass/mcp   # adjust
bash scripts/install.sh
node src/cli.js init-master '…'          # your secret
node src/cli.js add-site google-mail gmail accounts.google.com,mail.google.com --user you@example.com
realpath src/server.js                   # paste into ~/.cursor/mcp.json
```

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "alienpass": {
      "command": "node",
      "args": ["/ABS/PATH/mcp/src/server.js"],
      "env": {
        "ALIENPASS_MODE": "compose",
        "ALIENPASS_ALLOW_REVEAL": "0",
        "ALIENPASS_AGENT_SAFE": "1"
      }
    }
  }
}
```

Then in Agent: ask it to call `sign_in_session` for your URL/email with a success URL check.
