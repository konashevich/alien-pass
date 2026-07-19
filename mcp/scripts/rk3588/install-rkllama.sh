#!/usr/bin/env bash
# Install RKLLama on FriendlyElec / RK3588 (aarch64) for NPU LLM serving.
set -euo pipefail

ROOT="${HOME}/rkllama"
VENV="${HOME}/rkllama-venv"

echo "==> Checking architecture (expect aarch64)"
uname -m

if [[ ! -e /sys/kernel/debug/rknpu/version ]]; then
  echo "WARNING: /sys/kernel/debug/rknpu/version missing — NPU debugfs may need root or driver."
else
  echo -n "NPU driver: "
  sudo cat /sys/kernel/debug/rknpu/version || true
fi

sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv git curl

python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -U pip wheel

if [[ ! -d "$ROOT/.git" ]]; then
  git clone https://github.com/notpunchnox/rkllama.git "$ROOT"
else
  git -C "$ROOT" pull --ff-only || true
fi

cd "$ROOT"
pip install .

mkdir -p "${HOME}/rkllama-models"
echo "RKLLama installed."
echo "Activate: source $VENV/bin/activate"
echo "Models dir: ${HOME}/rkllama-models"
echo "Next: place a Qwen2.5-1.5B-Instruct .rkllm model, then run start-rkllama.sh"
