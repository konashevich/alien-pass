# Local model status (this cloud agent host)

- Host: x86_64 (no RK3588 NPU)
- Ollama: installed, serving on `127.0.0.1:11434`
- Pulled: `qwen2.5:1.5b` (segfaults on this hypervisor — do not use here)
- Working stand-in: `smollm2:360m` (OpenAI `/v1/chat/completions` verified)
- For FriendlyElec RK3588 NPU: use **Qwen2.5-1.5B-Instruct** via RKLLama — see `docs/rk3588-local-model.md`

Verify:

```bash
bash mcp/scripts/rk3588/verify-openai.sh http://127.0.0.1:11434/v1 smollm2:360m
```
