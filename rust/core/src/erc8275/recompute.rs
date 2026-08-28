/// ERC-8275: compute win rate in basis points from commit-gated wins and losses.
///
/// winRate = round_half_up(wins * 10000 / (wins + losses))
/// Formula: (2*wins*10000 + total) / (2*total) — exact integer division, half-away-from-zero.
/// Never a float round() — identical across all languages by construction.
///
/// Golden vector: wins=16, losses=15 → 5161 (0.5161).
/// Rounding-tie: wins=1, losses=31 → 313 (0.0313), matches canonical ROUND_HALF_UP.
///
/// # Errors
/// Returns `None` if both wins and losses are zero (division by zero).
pub fn compute_win_rate(wins: u64, losses: u64) -> Option<u64> {
    let total = wins.checked_add(losses)?;
    if total == 0 {
        return None;
    }
    // (2*wins*10000 + total) / (2*total)
    // = wins*10000/total + 1/2 if the fractional part is exactly 0.5 → half-up
    let num = wins.checked_mul(20000)?;
    Some((num + total) / (2 * total))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector: wins=16, losses=15 → 5161 (0.5161)
    #[test]
    fn golden_win_rate() {
        assert_eq!(compute_win_rate(16, 15), Some(5161));
    }

    #[test]
    fn zero_wins_is_zero() {
        assert_eq!(compute_win_rate(0, 10), Some(0));
    }

    #[test]
    fn all_wins_is_10000() {
        assert_eq!(compute_win_rate(10, 0), Some(10000));
    }

    #[test]
    fn both_zero_returns_none() {
        assert_eq!(compute_win_rate(0, 0), None);
    }

    #[test]
    fn integer_division_truncates() {
        // 1/3 = 0.3333... → 3333 basis points
        assert_eq!(compute_win_rate(1, 2), Some(3333));
    }

    /// Rounding-tie vector: wins=1, losses=31 → 1/32 = 0.03125 → 313 (ROUND_HALF_UP)
    #[test]
    fn rounding_tie_half_up() {
        assert_eq!(compute_win_rate(1, 31), Some(313));
    }

    /// Another tie: 57/743 ≈ 0.076716... → 767 (ROUND_HALF_UP)
    #[test]
    fn rounding_tie_57_743() {
        assert_eq!(compute_win_rate(57, 686), Some(767));
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use crate::erc8275::conventions::WIN_RATE_BPS_V0_HASH;
    use serde_json::Value;

    const VECTORS_STR: &str =
        include_str!("../../../../testkit/vectors/erc8275-reputation-bps-v0.vectors.json");

    #[test]
    fn golden_vectors() {
        let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            match step {
                "8275/reputation-bps" => {
                    let wins = v["inputs"]["commit_gated_wins"].as_u64().unwrap();
                    let losses = v["inputs"]["commit_gated_losses"].as_u64().unwrap();
                    assert_eq!(
                        v["governing_convention_hash"].as_str().unwrap(),
                        WIN_RATE_BPS_V0_HASH
                    );
                    let expected = v["expected"].as_u64().unwrap();
                    assert_eq!(compute_win_rate(wins, losses), Some(expected));
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
