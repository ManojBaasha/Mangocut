#!/usr/bin/env bash
# Verifies the Rust wasm toolchain. In CI/Vercel (CI or VERCEL set) it installs
# whatever is missing, with wasm-pack pinned to WASM_PACK_VERSION; locally it
# fails with instructions (any wasm-pack version is accepted locally).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"

# Keep in sync with .github/workflows/bun-ci.yml (its cache key names it).
WASM_PACK_VERSION="0.15.1"

provisioning() {
  [ -n "${CI:-}" ] || [ -n "${VERCEL:-}" ]
}

have_wasm_pack() {
  command -v wasm-pack >/dev/null 2>&1 || return 1
  if provisioning; then
    # CI/Vercel builds use exactly the pinned version.
    wasm-pack --version 2>/dev/null | tr -d "\r" | grep -q " ${WASM_PACK_VERSION}\$"
  fi
}

have_all() {
  command -v rustup >/dev/null 2>&1 \
    && command -v cargo >/dev/null 2>&1 \
    && rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$' \
    && have_wasm_pack
}

have_all && exit 0

if ! provisioning; then
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
if ! have_wasm_pack; then
  echo "Installing wasm-pack ${WASM_PACK_VERSION} (cargo install, compiles from source)..."
  cargo install wasm-pack --locked --version "${WASM_PACK_VERSION}" --force
fi
have_all
