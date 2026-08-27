#!/usr/bin/env node
/**
 * THE VALIDATOR'S MOMENT (Gate 2 bridge) — verify a REAL Groth16-wrapped fold proof in PURE Node:
 *   node wasm-verify.mjs [proofs/fold-groth16-v2.json]
 *
 * No Rust, no Go, no Docker, no toolchain: just the vendored `verifier-wasm/pkg` (JS + 255 KB of
 * WASM, built once at the forge from the vetted `sp1-verifier` crate). This is exactly what the
 * reducer will run at Gate 2 on every `fold-seal`, on apply AND on replay — fail-closed.
 * The committed public values are bincode(String) of the fold's public-outputs JSON: an 8-byte LE
 * length prefix, then utf8 — decoded here so the human sees WHAT the proof states.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { verify_groth16 } = require(join(HERE, 'verifier-wasm/pkg/kray_fold_verifier_wasm.js'))

const artifactPath = process.argv[2] ?? join(HERE, 'proofs/fold-groth16-v2.json')
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
const proof = Buffer.from(artifact.proof, 'hex')
const publicValues = Buffer.from(artifact.publicValues, 'hex')

console.log(`\n╔═ TK-FOLD — a validator's verification, pure Node (zero toolchain) ═╗\n`)
console.log(`  artifact   ${artifactPath}`)
console.log(`  vector     ${artifact.vector}`)
console.log(`  proof      ${proof.length} bytes (constant-size Groth16 over bn254)`)
console.log(`  vkey hash  ${artifact.vkeyHash} (pins WHICH program was proven)`)

const t0 = process.hrtime.bigint()
const ok = verify_groth16(proof, publicValues, artifact.vkeyHash)
const ms = Number(process.hrtime.bigint() - t0) / 1e6

// decode bincode(String): u64 LE length + utf8 — the fold's public outputs, human-readable
const len = Number(publicValues.readBigUInt64LE(0))
const outputs = JSON.parse(publicValues.subarray(8, 8 + len).toString('utf8'))

console.log(`\n  verified   ${ok ? 'TRUE' : 'FALSE'} in ${ms.toFixed(1)} ms\n`)
console.log('  what the proof states (the public outputs):')
for (const [k, v] of Object.entries(outputs)) console.log(`    ${k.padEnd(10)} ${v}`)

// tamper exam: one flipped byte anywhere must kill it — fail-closed, not fail-quiet
const tampered = Buffer.from(proof)
tampered[tampered.length - 1] ^= 0x01
const t1 = process.hrtime.bigint()
const bad = verify_groth16(tampered, publicValues, artifact.vkeyHash)
const ms2 = Number(process.hrtime.bigint() - t1) / 1e6
console.log(`\n  tamper exam: one flipped byte → verified ${bad} in ${ms2.toFixed(1)} ms (must be false)`)

const wrongVk = '0x' + '11'.repeat(32)
const bad2 = verify_groth16(proof, publicValues, wrongVk)
console.log(`  wrong-program exam: alien vkey hash → verified ${bad2} (must be false)`)

if (!ok || bad || bad2) { console.log('\n  ✗ FAIL'); process.exit(1) }
console.log('\n═ the fold proof verifies in pure Node — clone, install, run: the validator-burden law is REAL ═\n')
