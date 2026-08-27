/* tslint:disable */
/* eslint-disable */

/**
 * Verify a Groth16-wrapped SP1 fold proof. `sp1_vk_hash` is the program's verifying-key hash
 * (`0x…`, as `vk.bytes32()` emits) — it pins WHICH program was proven, so a proof of any other
 * guest (even a valid one) is refused. Returns true iff the proof verifies. Fail-closed.
 */
export function verify_groth16(proof: Uint8Array, public_inputs: Uint8Array, sp1_vk_hash: string): boolean;
