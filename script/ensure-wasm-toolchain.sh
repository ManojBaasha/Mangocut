#!/usr/bin/env bash
# Verifies the Rust wasm toolchain. In CI/Vercel (CI or VERCEL set) it installs
# whatever is missing; locally it fails with instructions.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"

have_all() {
  command -v rustup >/dev/null 2>&1 \
    && command -v cargo >/dev/null 2>&1 \
    && rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$' \
    && command -v wasm-pack >/dev/null 2>&1
}

have_all && exit 0

if [ -z "${CI:-}" ] && [ -z "${VERCEL:-}" ]; then
  cat >&2 <<'MSG'
Missing Rust wasm toolchain. Install it with:
  bash script/setup-rust   (or: brew install rustup wasm-pack)
  rustup default stable && rustup target add wasm32-unknown-unknown
Then re-run this command.
MSG
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add wasm32-unknown-unknown
if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Installing wasm-pack..."
  curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
fi
have_all
