#!/usr/bin/env bash
# Start RKLLama serving models for Cursor OpenAI-compatible clients.
set -euo pipefail

MODELS_DIR="${1:-$HOME/rkllama-models}"
MODEL_NAME="${2:-Qwen2.5-1.5B-Instruct}"
VENV="${HOME}/rkllama-venv"
PORT="${RKLLAMA_PORT:-8080}"
HOST="${RKLLAMA_HOST:-0.0.0.0}"

if [[ ! -d "$VENV" ]]; then
  echo "Missing $VENV — run install-rkllama.sh first" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

export RKLLAMA_MODELS_PATH="$MODELS_DIR"
export RKLLAMA_PLATFORM_PROCESSOR="${RKLLAMA_PLATFORM_PROCESSOR:-rk3588}"

echo "Models: $MODELS_DIR"
echo "Default model hint: $MODEL_NAME"
echo "OpenAI base URL for Cursor: http://127.0.0.1:${PORT}/v1"

# RKLLama CLI entrypoints vary by version; try common ones.
if command -v rkllama >/dev/null 2>&1; then
  exec rkllama serve --host "$HOST" --port "$PORT" --models "$MODELS_DIR"
fi

if python -c "import rkllama" >/dev/null 2>&1; then
  # Fallback: module CLI if packaged that way
  if python -m rkllama --help >/dev/null 2>&1; then
    exec python -m rkllama serve --host "$HOST" --port "$PORT" --models "$MODELS_DIR"
  fi
fi

echo "Could not find 'rkllama' CLI after install. Check: pip show rkllama" >&2
echo "Manual: cd ~/rkllama && rkllama --help" >&2
exit 1
