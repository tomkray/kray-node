//! THE TK-FOLD BENCH (Gate 1b) — the golden-vector crossing and the first real fold proofs.
//!
//! ```shell
//! cargo run --release -- --execute            # guest reproduces EVERY golden vector byte-for-byte
//! cargo run --release -- --prove --vector 1   # a REAL fold proof of one vector, then verified
//! ```
//!
//! The vectors are the frozen `apps/kray-core/src/test/vectors/tk-fold.golden.json` — generated
//! and guarded by the TypeScript reference. The Gate 1 exit criterion (docs/TK-FOLD-DESIGN.md):
//! every field of every vector, byte-for-byte, from a SECOND implementation.

use clap::Parser;
use kray_fold_lib::{fold_breath, VectorInput};
use serde_json::Value;
use sp1_sdk::{
    blocking::{ProveRequest, Prover, ProverClient},
    include_elf, Elf, HashableKey, ProvingKey, SP1Stdin,
};

const FOLD_ELF: Elf = include_elf!("kray-fold-program");

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long)]
    execute: bool,

    #[arg(long)]
    prove: bool,

    /// which golden vector to prove (index into the frozen file)
    #[arg(long, default_value = "1")]
    vector: usize,

    /// wrap into a constant-size Groth16 proof (requires --features wrap and a Go toolchain)
    #[arg(long)]
    groth16: bool,

    /// save the (groth16) proof + public values + vkey hash as JSON — the artifact the
    /// npm/WASM verifier checks inside the Node reducer (the validator-burden law's bridge)
    #[arg(long)]
    save: Option<String>,

    /// THE FOLDER'S DOOR (Gate 3 tooling): prove an ARBITRARY breath — a JSON file with
    /// {network, pre, transfers} (the golden-vector input shape). The expected outputs are
    /// re-derived here by the Rust twin itself, so the guest is still checked against a second
    /// computation, never trusted on its own word.
    #[arg(long)]
    input: Option<String>,

    #[arg(long, default_value = "../../kray-core/src/test/vectors/tk-fold.golden.json")]
    vectors: String,
}

/// One vector's guest input (network+pre+transfers) and its frozen expectations.
fn split(v: &Value) -> (String, Value) {
    let input = serde_json::json!({
        "network": v["network"],
        "pre": v["pre"],
        "transfers": v["transfers"],
    });
    (serde_json::to_string(&input).unwrap(), v["expected"].clone())
}

fn check(name: &str, got: &str, expected: &Value) -> bool {
    let g: Value = serde_json::from_str(got).expect("guest public outputs");
    let fields = [
        ("preRoot", "preRoot"),
        ("postRoot", "postRoot"),
        ("diffsHash", "diffsHash"),
        ("applied", "applied"),
        ("refused", "refused"),
        ("deferred", "deferred"),
    ];
    let mut ok = true;
    for (gk, ek) in fields {
        if g[gk] != expected[ek] {
            println!("  ✗ {name}: {gk} mismatch — guest {} vs frozen {}", g[gk], expected[ek]);
            ok = false;
        }
    }
    ok
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let args = Args::parse();
    if args.execute == args.prove {
        eprintln!("Error: specify either --execute or --prove");
        std::process::exit(1);
    }

    let raw = std::fs::read_to_string(&args.vectors).expect("golden vectors file");
    let vectors: Vec<Value> = serde_json::from_str(&raw).expect("golden vectors json");
    let client = ProverClient::from_env();

    if args.execute {
        println!("\n╔═ TK-FOLD GATE 1b — the guest crosses the golden vectors ═╗\n");
        let mut all = true;
        for v in &vectors {
            let name = v["name"].as_str().unwrap_or("?");
            let (input, expected) = split(v);
            let mut stdin = SP1Stdin::new();
            stdin.write(&input);
            let (mut output, report) = client.execute(FOLD_ELF, stdin).run().expect("execution failed");
            let public: String = output.read::<String>();
            let ok = check(name, &public, &expected);
            println!(
                "  {} {name} — {} cycles",
                if ok { "✓" } else { "✗" },
                report.total_instruction_count()
            );
            all &= ok;
        }
        if !all {
            std::process::exit(1);
        }
        println!("\n═ every golden vector reproduced byte-for-byte by the second implementation ═\n");
    } else {
        // THE FOLDER'S PATH (--input): prove an arbitrary breath, expectations re-derived by the
        // Rust twin itself. THE BENCH PATH (--vector): prove a frozen golden vector.
        let (name, input, expected) = if let Some(path) = &args.input {
            let raw_in = std::fs::read_to_string(path).expect("breath input file");
            let vector: VectorInput = serde_json::from_str(&raw_in).expect("malformed breath input");
            let outcome = fold_breath(&vector.network, &vector.pre_state(), &vector.transfers);
            let expected = serde_json::to_value(&outcome.public).expect("twin outputs");
            (format!("breath {path}"), raw_in, expected)
        } else {
            let v = &vectors[args.vector];
            let name = v["name"].as_str().unwrap_or("?").to_string();
            let (input, expected) = split(v);
            (name, input, expected)
        };
        println!("\n╔═ TK-FOLD — a REAL fold proof: {name} ═╗\n");
        let mut stdin = SP1Stdin::new();
        stdin.write(&input);

        let pk = client.setup(FOLD_ELF).expect("setup failed");
        let t0 = std::time::Instant::now();
        let request = client.prove(&pk, stdin);
        let mut proof = if args.groth16 { request.groth16().run() } else { request.compressed().run() }.expect("proving failed");
        let proving = t0.elapsed();

        let t1 = std::time::Instant::now();
        client.verify(&proof, pk.verifying_key(), None).expect("verification failed");
        let verifying = t1.elapsed();

        if let Some(path) = &args.save {
            if !args.groth16 {
                eprintln!("--save requires --groth16 (only the wrapped proof has portable bytes)");
                std::process::exit(1);
            }
            let artifact = serde_json::json!({
                "vector": name,
                "mode": "groth16",
                "proof": hex_encode(&proof.bytes()),
                "publicValues": hex_encode(proof.public_values.as_slice()),
                "vkeyHash": pk.verifying_key().bytes32(),
            });
            std::fs::write(path, serde_json::to_string_pretty(&artifact).unwrap()).expect("write proof artifact");
            println!("  proof artifact saved → {path}");
        }

        let public: String = proof.public_values.read::<String>();
        let ok = check(&name, &public, &expected);
        println!("\n  fold proof generated in {proving:?}, verified in {verifying:?}");
        println!("  public outputs match the frozen vector: {}", if ok { "YES" } else { "NO" });
        if !ok {
            std::process::exit(1);
        }
        println!("\n═ the fold proof is REAL: a verifier that never saw the transfers now knows the transition is lawful ═\n");
    }
}
