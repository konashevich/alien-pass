#!/usr/bin/env bash
# Prepare an RKLLama model directory with Modelfile + .rkllm artifact.
set -euo pipefail

MODEL_DIR="${1:-}"
RKLLM_SRC="${2:-}"

if [[ -z "$MODEL_DIR" ]]; then
  echo "Usage: $0 <model-dir> [path-to.rkllm]"
  echo "Example: $0 ~/rkllama-models/Qwen2.5-1.5B-Instruct ~/Downloads/Qwen*.rkllm"
  exit 1
fi

mkdir -p "$MODEL_DIR"
NAME="$(basename "$MODEL_DIR")"

cat > "$MODEL_DIR/Modelfile" <<EOF
NAME="${NAME}"
HUGGINGFACE_PATH="Qwen/Qwen2.5-1.5B-Instruct"
EOF

if [[ -n "$RKLLM_SRC" ]]; then
  if [[ ! -f "$RKLLM_SRC" ]]; then
    echo "RKLLM file not found: $RKLLM_SRC" >&2
    exit 1
  fi
  cp -f "$RKLLM_SRC" "$MODEL_DIR/$(basename "$RKLLM_SRC")"
fi

echo "Model directory ready:"
ls -lah "$MODEL_DIR"
echo
echo "If no .rkllm is present yet, download one, e.g.:"
echo "  huggingface-cli download Azurastar2903/Qwen2.5-1.5B-Instruct-rk3588-1.2.1 --local-dir $MODEL_DIR"
