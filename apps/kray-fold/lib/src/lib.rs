//! THE TK-FOLD — the SECOND implementation of the executable specification (Gate 1b).
//!
//! This crate is the Rust twin of `apps/kray-core/src/protocol/tk-fold.ts`. The law of Gate 1
//! (docs/TK-FOLD-DESIGN.md) is that this implementation reproduces EVERY field of EVERY golden
//! vector byte-for-byte — one spec, two implementations, zero drift. It runs identically on the
//! host (fast native checks) and inside the SP1 zkVM guest (the fold proof). Vetted crates only:
//! sha2, k256 (BIP-340 schnorr), bech32 — no hand-rolled cryptography.
//!
//! Scope note (honest): the lane's signature scheme here is `kraywallet` (BIP-340 over
//! SHA256(utf8(message)), address-bound by the taproot tweak). Any other scheme is refused at
//! admission — the golden vectors carry only `kraywallet`, and widening is an explicit spec change.

use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use k256::elliptic_curve::PrimeField;
use k256::{AffinePoint, EncodedPoint, ProjectivePoint, Scalar};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use signature::hazmat::PrehashVerifier;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

pub fn sha256hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// BIP-341 tagged hash: sha256(sha256(tag) || sha256(tag) || data).
fn tagged_hash(tag: &str, data: &[u8]) -> [u8; 32] {
    let th = Sha256::digest(tag.as_bytes());
    let mut h = Sha256::new();
    h.update(th);
    h.update(th);
    h.update(data);
    h.finalize().into()
}

/// The network's bech32 HRP — the same mapping as `scheme.ts` NETWORKS.
pub fn hrp_of(network: &str) -> Option<&'static str> {
    match network {
        "regtest" => Some("bcrt"),
        "signet" => Some("tb"),
        "main" => Some("bc"),
        _ => None,
    }
}

/// p2tr(internal x-only key) → bech32m address (BIP-341 key-path, no script tree) — the twin of
/// `btc.p2tr(xonly, undefined, NETWORKS[net]).address`. None on any malformed input (fail-closed).
pub fn p2tr_address(xonly: &[u8], hrp: &str) -> Option<String> {
    if xonly.len() != 32 {
        return None;
    }
    let mut compressed = [0u8; 33];
    compressed[0] = 0x02; // lift_x: the internal key is the even-Y point with this x
    compressed[1..].copy_from_slice(xonly);
    let encoded = EncodedPoint::from_bytes(compressed).ok()?;
    let point: Option<AffinePoint> = AffinePoint::from_encoded_point(&encoded).into();
    let p = ProjectivePoint::from(point?);
    let t = tagged_hash("TapTweak", xonly);
    let scalar: Option<Scalar> = Scalar::from_repr(t.into()).into();
    let q = (p + ProjectivePoint::GENERATOR * scalar?).to_affine();
    let q_encoded = q.to_encoded_point(true);
    let x = q_encoded.as_bytes().get(1..33)?; // identity encodes as a single 0x00 byte → None here
    let hrp = bech32::Hrp::parse(hrp).ok()?;
    bech32::segwit::encode(hrp, bech32::Fe32::P, x).ok() // Fe32::P == witness version 1
}

/// The twin of `verifyKrayWallet`: BIP-340 schnorr over SHA256(utf8(message)) — the Kray digest,
/// plain single SHA-256, NOT tagged — with the anti-spoof address binding. Fail-closed.
pub fn verify_kraywallet(address: &str, message: &str, signature_hex: &str, public_key_hex: &str, hrp: &str) -> bool {
    if signature_hex.len() != 128 || !signature_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    let Ok(sig_bytes) = hex::decode(signature_hex) else { return false };
    let Ok(raw) = hex::decode(public_key_hex) else { return false };
    // a 33-byte key MUST be a real compressed point (0x02/0x03) — same wall as the TS spec
    if raw.len() == 33 && raw[0] != 0x02 && raw[0] != 0x03 {
        return false;
    }
    let xonly: &[u8] = if raw.len() == 33 { &raw[1..] } else { &raw };
    if xonly.len() != 32 {
        return false;
    }
    match p2tr_address(xonly, hrp) {
        Some(derived) if derived == address => {}
        _ => return false, // the INTERNAL key must re-derive to exactly this address
    }
    let Ok(vk) = k256::schnorr::VerifyingKey::from_bytes(xonly) else { return false };
    let Ok(sig) = k256::schnorr::Signature::try_from(sig_bytes.as_slice()) else { return false };
    let digest = Sha256::digest(message.as_bytes());
    vk.verify_prehash(&digest, &sig).is_ok()
}

/// The lane's OWN signed domain — byte-identical to `tkFoldSendMessage` in the TS spec.
pub fn tk_fold_send_message(network: &str, from: &str, to: &str, amount: u128, nonce: u64) -> String {
    format!("kray-core.tk-fold-send.v1|net={network}|from={from}|to={to}|amount={amount}|nonce={nonce}")
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LaneTransfer {
    pub from: String,
    pub to: String,
    pub amount: String,
    pub nonce: u64,
    #[serde(default, rename = "publicKey")]
    pub public_key: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub scheme: Option<String>,
}

#[derive(Clone, Default)]
pub struct LaneState {
    pub balances: BTreeMap<String, u128>,
    pub nonces: BTreeMap<String, u64>,
}

impl LaneState {
    pub fn total(&self) -> u128 {
        self.balances.values().sum()
    }
}

/// The lane root — byte-identical to the TS `laneRoot`: sorted non-zero balances, `|nonces`,
/// sorted non-zero nonces, `|lanetotal:Σ`, joined by newlines, SHA-256 hex.
pub fn lane_root(s: &LaneState) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (a, b) in &s.balances {
        if *b != 0 {
            parts.push(format!("{a}:{b}"));
        }
    }
    parts.push("|nonces".into());
    for (a, n) in &s.nonces {
        if *n != 0 {
            parts.push(format!("{a}:{n}"));
        }
    }
    parts.push(format!("|lanetotal:{}", s.total()));
    sha256hex(&parts.join("\n"))
}

/// STRICT canonical decimal — the digits `BigInt.prototype.toString` emits and nothing else.
/// (The TS spec's `BigInt(x)` also accepts hex/whitespace forms; the golden vectors only ever
/// carry canonical decimal, and Gate 2 hardens the TS door to this same strictness.)
fn parse_amount(s: &str) -> Option<u128> {
    if s.is_empty() || s.len() > 39 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if s.len() > 1 && s.starts_with('0') {
        return None;
    }
    s.parse::<u128>().ok()
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
pub struct PublicOutputs {
    pub network: String,
    #[serde(rename = "preRoot")]
    pub pre_root: String,
    #[serde(rename = "postRoot")]
    pub post_root: String,
    #[serde(rename = "diffsHash")]
    pub diffs_hash: String,
    #[serde(rename = "laneTotal")]
    pub lane_total: String,
    pub applied: usize,
    pub refused: usize,
    pub deferred: usize,
}

pub struct FoldOutcome {
    pub post: LaneState,
    pub diff_balances: Vec<(String, String)>,
    pub diff_nonces: Vec<(String, u64)>,
    pub public: PublicOutputs,
}

/// THE FOLD — one breath, the Rust twin of `foldBreath`. Deterministic in (network, pre, the SET
/// of transfers); every law in the same order as the TS spec: admission → orderWindow → apply →
/// conservation → diffs.
pub fn fold_breath(network: &str, pre: &LaneState, transfers: &[LaneTransfer]) -> FoldOutcome {
    let pre_root = lane_root(pre);
    let hrp = hrp_of(network).expect("unknown network");
    let mut refused: usize = 0;

    // ── 1. ADMISSION — the signature first, over the lane's own domain ──
    struct Admitted {
        key: String,
        idx: usize,
        amount: u128,
    }
    // the canonical nonce domain is [0, 2^53) — the TS twin's Number.isSafeInteger wall; a u64
    // beyond it must refuse HERE too, or the two implementations would split on one act
    const NONCE_MAX: u64 = 9_007_199_254_740_991;
    let mut admitted: Vec<Admitted> = Vec::new();
    for (idx, t) in transfers.iter().enumerate() {
        if t.nonce > NONCE_MAX {
            refused += 1;
            continue;
        }
        let Some(amount) = parse_amount(&t.amount) else {
            refused += 1;
            continue;
        };
        let msg = tk_fold_send_message(network, &t.from, &t.to, amount, t.nonce);
        let ok = match (&t.public_key, &t.signature, &t.scheme) {
            (Some(pk), Some(sig), Some(sch)) if sch == "kraywallet" => verify_kraywallet(&t.from, &msg, sig, pk, hrp),
            _ => false,
        };
        if !ok {
            refused += 1;
            continue;
        }
        admitted.push(Admitted { key: sha256hex(&msg), idx, amount });
    }

    // ── 2. ORDER — the orderWindow schedule, ported law-for-law from window-order.ts ──
    // dedup by signed-identity key (keep the first arrival — outputs never depend on which twin wins)
    let mut by_key: Vec<&Admitted> = Vec::new();
    let mut seen = HashSet::new();
    for a in &admitted {
        if seen.insert(a.key.clone()) {
            by_key.push(a);
        }
    }
    // min-key candidate per (from, nonce) — a double-spend at one nonce resolves to the smaller key
    let mut candidate: HashMap<&str, BTreeMap<u64, &Admitted>> = HashMap::new();
    for a in &by_key {
        let t = &transfers[a.idx];
        let slot = candidate.entry(t.from.as_str()).or_default();
        match slot.get(&t.nonce) {
            Some(cur) if cur.key <= a.key => {}
            _ => {
                slot.insert(t.nonce, a);
            }
        }
    }
    // greedy: always take the smallest-key ELIGIBLE act; taking one act unlocks its account's next
    let mut heap: BinaryHeap<Reverse<(String, usize, u128)>> = BinaryHeap::new();
    let mut froms: Vec<&str> = candidate.keys().copied().collect();
    froms.sort(); // seeding order is irrelevant (the heap orders by key) — sorted for determinism anyway
    for from in froms {
        let n = *pre.nonces.get(from).unwrap_or(&0);
        if let Some(c) = candidate.get(from).and_then(|m| m.get(&n)) {
            heap.push(Reverse((c.key.clone(), c.idx, c.amount)));
        }
    }
    let mut ordered: Vec<(usize, u128)> = Vec::new();
    let mut taken: HashSet<String> = HashSet::new();
    while let Some(Reverse((key, idx, amount))) = heap.pop() {
        if !taken.insert(key) {
            continue;
        }
        let t = &transfers[idx];
        ordered.push((idx, amount));
        if let Some(next) = candidate.get(t.from.as_str()).and_then(|m| m.get(&(t.nonce + 1))) {
            heap.push(Reverse((next.key.clone(), next.idx, next.amount)));
        }
    }
    let window_deferred = by_key.iter().filter(|a| !taken.contains(&a.key)).count();

    // ── 3. APPLY — validate-then-mutate in the fixed order; a refusal mutates nothing ──
    let mut post = pre.clone();
    let mut applied: usize = 0;
    let mut deferred = window_deferred;
    let mut touched: HashSet<String> = HashSet::new();
    for (idx, amount) in ordered {
        let t = &transfers[idx];
        let exp = *post.nonces.get(&t.from).unwrap_or(&0);
        if t.nonce != exp {
            deferred += 1; // an earlier sibling was refused — its chain waits
            continue;
        }
        if amount == 0 {
            refused += 1;
            continue;
        }
        if t.from == t.to {
            refused += 1;
            continue;
        }
        let from_bal = *post.balances.get(&t.from).unwrap_or(&0);
        if from_bal < amount {
            refused += 1;
            continue;
        }
        post.balances.insert(t.from.clone(), from_bal - amount);
        let to_bal = *post.balances.get(&t.to).unwrap_or(&0);
        post.balances.insert(t.to.clone(), to_bal + amount);
        post.nonces.insert(t.from.clone(), exp + 1);
        touched.insert(t.from.clone());
        touched.insert(t.to.clone());
        applied += 1;
    }

    // ── 5. CONSERVATION — a pure-transfer breath can never mint or destroy ──
    assert_eq!(post.total(), pre.total(), "tk-fold: conservation broke (impossible by construction; halt)");

    // ── 4. DIFFS — the net effect, sorted: address → NEW balance / nonce ──
    let mut touched_sorted: Vec<String> = touched.into_iter().collect();
    touched_sorted.sort();
    let diff_balances: Vec<(String, String)> = touched_sorted
        .iter()
        .map(|a| (a.clone(), post.balances.get(a).unwrap_or(&0).to_string()))
        .collect();
    let diff_nonces: Vec<(String, u64)> = touched_sorted
        .iter()
        .filter(|a| post.nonces.get(*a).unwrap_or(&0) != pre.nonces.get(*a).unwrap_or(&0))
        .map(|a| (a.clone(), *post.nonces.get(a).unwrap_or(&0)))
        .collect();
    let mut lines: Vec<String> = vec!["tk-fold-diffs.v1".into()];
    for (a, b) in &diff_balances {
        lines.push(format!("b|{a}|{b}"));
    }
    for (a, n) in &diff_nonces {
        lines.push(format!("n|{a}|{n}"));
    }
    let diffs_hash = sha256hex(&lines.join("\n"));
    let public = PublicOutputs {
        network: network.to_string(),
        pre_root,
        post_root: lane_root(&post),
        diffs_hash,
        lane_total: post.total().to_string(),
        applied,
        refused,
        deferred,
    };
    FoldOutcome { post, diff_balances, diff_nonces, public }
}

/// The guest's input — a golden vector minus its `expected` block.
#[derive(Serialize, Deserialize)]
pub struct VectorInput {
    pub network: String,
    pub pre: VectorPre,
    pub transfers: Vec<LaneTransfer>,
}

#[derive(Serialize, Deserialize)]
pub struct VectorPre {
    pub balances: Vec<(String, String)>,
    pub nonces: Vec<(String, u64)>,
}

impl VectorInput {
    pub fn pre_state(&self) -> LaneState {
        let mut s = LaneState::default();
        for (a, b) in &self.pre.balances {
            s.balances.insert(a.clone(), parse_amount(b).expect("pre balance"));
        }
        for (a, n) in &self.pre.nonces {
            s.nonces.insert(a.clone(), *n);
        }
        s
    }
}
