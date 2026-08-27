//! THE TK-FOLD GUEST — the fold proof's program (Gate 1b).
//!
//! Runs the executable specification (`kray-fold-lib`, the Rust twin of `tk-fold.ts`) inside the
//! SP1 zkVM and COMMITS the public outputs. A verified proof of this program states, with no
//! trust in the folder: "there exists a set of transfers, every one carrying a valid BIP-340
//! signature over the lane's own domain, whose canonical orderWindow application to the state
//! with root `preRoot` yields the state with root `postRoot`, whose net effect hashes to
//! `diffsHash`, and whose total Ӿ is exactly `laneTotal`". The transfers themselves stay private
//! to the proof; the diffs live on the journal beside it — total knowledge, folded.

#![no_main]
sp1_zkvm::entrypoint!(main);

use kray_fold_lib::{fold_breath, VectorInput};

pub fn main() {
    let input = sp1_zkvm::io::read::<String>();
    let vector: VectorInput = serde_json::from_str(&input).expect("malformed vector input");
    let pre = vector.pre_state();
    let outcome = fold_breath(&vector.network, &pre, &vector.transfers);
    let public = serde_json::to_string(&outcome.public).expect("public outputs");
    sp1_zkvm::io::commit(&public);
}
