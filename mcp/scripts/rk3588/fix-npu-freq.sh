#!/usr/bin/env bash
# Optional: raise RK3588 NPU clocks (needs root; increases heat).
set -euo pipefail

if [[ ! -d /sys/class/devfreq/fdab0000.npu ]]; then
  echo "NPU devfreq node not found (fdab0000.npu). Skipping." >&2
  exit 0
fi

echo userspace | sudo tee /sys/class/devfreq/fdab0000.npu/governor >/dev/null
echo 800000000 | sudo tee /sys/class/devfreq/fdab0000.npu/min_freq >/dev/null
echo 1000000000 | sudo tee /sys/class/devfreq/fdab0000.npu/max_freq >/dev/null
echo -n "NPU freq: "
cat /sys/class/devfreq/fdab0000.npu/cur_freq
echo -n "NPU load: "
sudo cat /sys/kernel/debug/rknpu/load || true
