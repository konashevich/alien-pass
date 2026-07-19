#!/usr/bin/env bash
# Verify OpenAI-compatible endpoint (RKLLama :8080 or Ollama :11434).
set -euo pipefail

BASE="${1:-http://127.0.0.1:11434/v1}"
MODEL="${2:-qwen2.5:1.5b}"

echo "==> GET $BASE/models"
curl -fsS "$BASE/models" | head -c 800
echo
echo
echo "==> chat/completions ($MODEL)"
curl -fsS "$BASE/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK only.\"}],\"max_tokens\":16}" \
  | head -c 1200
echo
