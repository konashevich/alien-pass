# RK3588 NPU local model for AlienPass MCP

**Chosen model:** `Qwen2.5-1.5B-Instruct` (W8A8 / W4A16 RKLLM build for RK3588)

| Why this one | Detail |
| --- | --- |
| Size | ~1.5B — fits RK3588 6 TOPS NPU with ~1–2 GB RAM |
| Capability | Stronger instruction/tool following than TinyLlama/SmolLM for MCP sign-in |
| Official support | Listed by FriendlyELEC + Rockchip `rknn-llm` |
| Speed (board) | ~11–15 tok/s class on NPU (FriendlyELEC / Radxa tables) |
| Cursor bridge | Serve via **RKLLama** OpenAI-compatible `/v1` |

**Upgrade path if you have RAM headroom:** `Qwen2.5-3B-Instruct` (~1.8 GB, slower). Avoid 7B+ for interactive MCP subagent work.

---

## Important: this cloud workspace is x86_64

The Cursor cloud agent host has **no Rockchip NPU**. Here we run the **same model family** with Ollama on CPU as a stand-in so MCP/Cursor wiring can be tested.

On your **FriendlyElec RK3588 board**, use the NPU path below (RKLLM + RKLLama).

---

## A. On the FriendlyElec RK3588 board (native NPU)

### A1. Check NPU driver

```bash
sudo cat /sys/kernel/debug/rknpu/version
# Need: RKNPU driver: v0.9.8 (or newer)
sudo cat /sys/kernel/debug/rknpu/load
```

If the driver is old, update the FriendlyElec image / kernel per [FriendlyELEC NPU wiki](https://wiki.friendlyelec.com/wiki/index.php/NPU).

### A2. Install userspace (if needed)

```bash
# If your image packages it:
sudo apt update
sudo apt install -y rknpu2-rk3588 || true
```

Or copy `librknnrt.so` / `rknn_server` from Rockchip `rknn-toolkit2` aarch64 runtime as in the FriendlyELEC wiki.

### A3. Get a preconverted `.rkllm` model

Recommended HF packs (match your RKLLM runtime version):

- [Azurastar2903/Qwen2.5-1.5B-Instruct-rk3588-1.2.1](https://huggingface.co/Azurastar2903/Qwen2.5-1.5B-Instruct-rk3588-1.2.1) (RKLLM 1.2.1)
- [c01zaut/Qwen2.5-1.5B-Instruct-RK3588-1.1.4](https://huggingface.co/c01zaut/Qwen2.5-1.5B-Instruct-RK3588-1.1.4) (RKLLM 1.1.4)
- Or FriendlyELEC cloud drive: `09_Other files/RKLLM models` via http://dl.friendlyelec.com/

```bash
# On the board (example with huggingface-cli)
pip3 install -U "huggingface_hub[cli]"
mkdir -p ~/rkllama-models/Qwen2.5-1.5B-Instruct
cd ~/rkllama-models/Qwen2.5-1.5B-Instruct
huggingface-cli download Azurastar2903/Qwen2.5-1.5B-Instruct-rk3588-1.2.1 \
  --local-dir . --include "*.rkllm"
```

Create `Modelfile` (RKLLama needs Hugging Face tokenizer repo):

```bash
cat > ~/rkllama-models/Qwen2.5-1.5B-Instruct/Modelfile <<'EOF'
NAME="Qwen2.5-1.5B-Instruct"
HUGGINGFACE_PATH="Qwen/Qwen2.5-1.5B-Instruct"
EOF
# Ensure the .rkllm file sits in the same directory
ls -lh ~/rkllama-models/Qwen2.5-1.5B-Instruct/
```

Or use the helper:

```bash
bash /path/to/alien-pass/mcp/scripts/rk3588/setup-model-dir.sh \
  ~/rkllama-models/Qwen2.5-1.5B-Instruct \
  /path/to/Qwen2.5-1.5B-Instruct_*.rkllm
```

### A4. Install RKLLama (OpenAI + Ollama-compatible server)

```bash
sudo apt install -y python3-pip python3-venv git
python3 -m venv ~/rkllama-venv
source ~/rkllama-venv/bin/activate
git clone https://github.com/notpunchnox/rkllama.git ~/rkllama
cd ~/rkllama
pip install .
```

Or use the packaged script:

```bash
bash /path/to/alien-pass/mcp/scripts/rk3588/install-rkllama.sh
```

Start the server (port **8080** by default for many RKLLama builds; confirm with `--help`):

```bash
bash /path/to/alien-pass/mcp/scripts/rk3588/start-rkllama.sh \
  ~/rkllama-models \
  Qwen2.5-1.5B-Instruct
```

Verify:

```bash
curl -s http://127.0.0.1:8080/v1/models | head
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen2.5-1.5B-Instruct",
    "messages": [{"role":"user","content":"Reply with OK only."}],
    "max_tokens": 16
  }'
```

Optional NPU clocks (performance, more heat):

```bash
bash /path/to/alien-pass/mcp/scripts/rk3588/fix-npu-freq.sh
```

### A5. Point Cursor (on the board, or LAN) at RKLLama

Cursor Settings → Models → OpenAI-compatible / override base URL:

| Field | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:8080/v1` (or `http://BOARD_IP:8080/v1`) |
| API key | `rkllama` (any non-empty string) |
| Model | `Qwen2.5-1.5B-Instruct` (exact RKLLama name) |

Use a **dedicated Chat** for the sign-in worker with  
`mcp/config/local-subagent-system-prompt.md`.

MCP (`~/.cursor/mcp.json`) stays as in the main install guide with `ALIENPASS_AGENT_SAFE=1`.

---

## B. On this x86 cloud/dev host (stand-in, no NPU)

```bash
# After Ollama install:
ollama pull qwen2.5:1.5b
# If qwen2.5:1.5b crashes on your hypervisor (seen on some cloud VMs), use:
ollama pull smollm2:360m

ollama run qwen2.5:1.5b "Reply with OK only."
# or: ollama run smollm2:360m "Reply with OK only."

bash mcp/scripts/rk3588/verify-openai.sh http://127.0.0.1:11434/v1 qwen2.5:1.5b
```

Cursor base URL: `http://127.0.0.1:11434/v1`, model `qwen2.5:1.5b` (or `smollm2:360m`).

Same AlienPass MCP tools work; only the inference backend differs (CPU vs NPU). **On the FriendlyElec board, prefer Qwen2.5-1.5B via RKLLama — not Ollama — for real NPU acceleration.**

---

## C. Wire to AlienPass MCP tasks

Local worker prompt (short):

```text
You are the local sign-in worker. Use alienpass MCP sign_in_session / auth_status.
Never print passwords. Return only the report JSON.
```

Example handoff:

```text
Sign in at https://accounts.google.com as you@example.com.
Call sign_in_session with success_url_includes=myaccount.google.com.
```

Keep context short on RK3588 (prefer ≤2–4k tokens). Long agent transcripts overflow RKLLM max context.

---

## D. Scripts in this repo

| Script | Role |
| --- | --- |
| `mcp/scripts/rk3588/install-rkllama.sh` | venv + clone + pip install RKLLama |
| `mcp/scripts/rk3588/setup-model-dir.sh` | Modelfile + place `.rkllm` |
| `mcp/scripts/rk3588/start-rkllama.sh` | Start server for Cursor |
| `mcp/scripts/rk3588/fix-npu-freq.sh` | Optional NPU performance governors |
| `mcp/scripts/rk3588/verify-openai.sh` | Hit `/v1/models` + chat |

---

## E. Convert your own model (optional, on an x86 PC)

If you prefer official conversion instead of community `.rkllm` files, use Rockchip `rknn-llm` toolkit on Ubuntu x86_64 per FriendlyELEC §6.3 / Radxa RKLLM docs, target `rk3588`, `num_npu_core=3`, quant `w8a8` or `w4a16`, export `Qwen2.5-1.5B-Instruct_….rkllm`, then copy to the board.
