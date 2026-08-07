//! governing_convention_hash — pin-at-issuance, resolve-at-verification for ERC-8275 winRateBps.
//!
//! A computation rule (formula + representation + rounding mode) is content-addressed:
//!
//! ```text
//! governing_convention_hash = "0x" + sha256(JCS(convention_spec))
//! ```
//!
//! because number formatting and rounding are exactly where two honest implementations diverge
//! without disagreeing on the inputs (1 win / 31 losses = 312.5 bps -> 313 half-up vs 312
//! half-even). A producer pins the hash at issuance; a verifier resolves it and recomputes under
//! *that* convention. Tri-state, fail-closed: an unknown hash is `Unverifiable`, never a silent pass.
//!
//! Binds the convention this SDK produces — `win_rate.bps.v0`. The spec object and derived hash are
//! byte-identical to trustless-ai/recompute-kit conformance/convention-hash-v0; the hash is DERIVED
//! from the spec (reproduce, don't trust) and self-checked against the locked identity in tests.

use alloc::format;
use alloc::string::String;
use super::recompute::compute_win_rate;
use sha2::{Digest, Sha256};

/// The `win_rate.bps.v0` convention spec as sorted (key, value) pairs — byte-identical to
/// recompute-kit convention-hash-v0. The hash is DERIVED from this, never hardcoded.
pub const WIN_RATE_BPS_V0_SPEC: &[(&str, &str)] = &[
    ("erc", "ERC-8275"),
    (
        "formula",
        "winRateBps = (gated_wins*20000 + total) // (2*total), total = wins+losses",
    ),
    ("id", "win_rate.bps.v0"),
    ("quantity", "erc8275.win_rate"),
    ("representation", "integer basis points, 0..10000"),
    (
        "rounding_mode",
        "round-half-up (half-away-from-zero), exact integer division — never a float round()",
    ),
    (
        "source",
        "agent-sdk#5 @87b08f3 reputation/erc8275 — Python/Rust/TS identical; winRateBps live on babyblueviper /ledger",
    ),
];

/// Locked identity (recompute-kit convention-hash-v0) — reproduced from the spec, not trusted.
pub const WIN_RATE_BPS_V0_HASH: &str =
    "0x0501b75db8e9ef4ef67c74efcfbe2a200b0a7e5aea5ca62f778c91c119e68daf";

/// RFC-8785 JCS for a flat string map: sorted keys, compact separators, raw UTF-8. Pairs are
/// already in sorted-key order. Valid because the locked spec contains no JSON-escape characters
/// (any that did would break the hash self-check).
fn canon(pairs: &[(&str, &str)]) -> String {
    let mut s = String::from("{");
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('"');
        s.push_str(k);
        s.push_str("\":\"");
        s.push_str(v);
        s.push('"');
    }
    s.push('}');
    s
}

/// Content-address a convention spec: `"0x" + sha256(JCS(spec))`.
pub fn governing_convention_hash(pairs: &[(&str, &str)]) -> String {
    let digest = Sha256::digest(canon(pairs).as_bytes());
    let mut hex = String::with_capacity(2 + digest.len() * 2);
    hex.push_str("0x");
    for b in digest {
        hex.push_str(&format!("{:02x}", b));
    }
    hex
}

/// Pin-at-issuance: `(winRateBps, governing_convention_hash)`. `None` iff wins == losses == 0.
pub fn pin_win_rate_bps(wins: u64, losses: u64) -> Option<(u64, &'static str)> {
    compute_win_rate(wins, losses).map(|v| (v, WIN_RATE_BPS_V0_HASH))
}

/// Tri-state verdict, fail-closed.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Verified,
    Rejected,
    Unverifiable,
}

/// Resolve-at-verification: verified iff the persisted value equals the recompute under the pinned
/// convention; rejected iff it resolves but disagrees; unverifiable iff the hash is not one this SDK
/// produces (never a silent pass).
pub fn verify_win_rate(value: u64, convention_hash: &str, wins: u64, losses: u64) -> Verdict {
    if !convention_hash.eq_ignore_ascii_case(WIN_RATE_BPS_V0_HASH) {
        return Verdict::Unverifiable;
    }
    match compute_win_rate(wins, losses) {
        Some(r) if r == value => Verdict::Verified,
        _ => Verdict::Rejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_reproduces_locked_identity() {
        assert_eq!(governing_convention_hash(WIN_RATE_BPS_V0_SPEC), WIN_RATE_BPS_V0_HASH);
    }

    #[test]
    fn pin_at_issuance() {
        assert_eq!(pin_win_rate_bps(1, 31), Some((313, WIN_RATE_BPS_V0_HASH)));
    }

    #[test]
    fn convention_hash_v0_vectors() {
        let h = WIN_RATE_BPS_V0_HASH;
        // bps golden + ties -> verified
        for (w, l, v) in [(0, 15, 0), (16, 0, 10000), (1, 2, 3333), (16, 15, 5161),
                          (0, 10, 0), (1, 31, 313), (9, 23, 2813)] {
            assert_eq!(verify_win_rate(v, h, w, l), Verdict::Verified, "{w}/{l}");
        }
        // half-even value under bps -> rejected
        assert_eq!(verify_win_rate(312, h, 1, 31), Verdict::Rejected);
        // unknown convention -> unverifiable
        let unknown = format!("0x{}", "de".repeat(32));
        assert_eq!(verify_win_rate(9500, &unknown, 19, 1), Verdict::Unverifiable);
    }
}
