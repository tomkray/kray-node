//! THE TK-FOLD VERIFIER (WASM) — the validator-burden law, delivered.
//!
//! A thin wasm-bindgen wrapper over the vetted `sp1-verifier` crate: verifies a Groth16-wrapped
//! fold proof (bn254) against its public values and the program's vkey hash. Built once with
//! `wasm-pack build --target nodejs --release`; the resulting `pkg/` is pure JS + WASM — a node
//! operator NEVER needs Rust, Go, Docker or any toolchain to check a fold proof (Gate 2 law:
//! a toolchain-free verifier is a CONSENSUS requirement, fail-closed).

use sp1_verifier::Groth16Verifier;
use wasm_bindgen::prelude::*;

/// Verify a Groth16-wrapped SP1 fold proof. `sp1_vk_hash` is the program's verifying-key hash
/// (`0x…`, as `vk.bytes32()` emits) — it pins WHICH program was proven, so a proof of any other
/// guest (even a valid one) is refused. Returns true iff the proof verifies. Fail-closed.
#[wasm_bindgen]
pub fn verify_groth16(proof: &[u8], public_inputs: &[u8], sp1_vk_hash: &str) -> bool {
    Groth16Verifier::verify(proof, public_inputs, sp1_vk_hash, *sp1_verifier::GROTH16_VK_BYTES).is_ok()
}
