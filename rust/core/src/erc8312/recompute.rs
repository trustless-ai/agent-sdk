/// ERC-8312 (StatefulBound variant): (reserved + confirmed) <= cap.
pub fn check_stateful_bound(reserved: u64, confirmed: u64, cap: u64) -> bool {
    reserved.saturating_add(confirmed) <= cap
}

/// ERC-8312 (Orbmis/headroom variant): aggregate <= cap.
pub fn check_cursor_headroom(aggregate: u64, cap: u64) -> bool {
    aggregate <= cap
}

/// ERC-8312 §IBudgetSubstrate: remaining = cap - spent.
/// Returns 0 if spent exceeds cap (exhausted or inactive envelope).
pub fn compute_remaining_headroom(cap: u64, spent: u64) -> u64 {
    cap.saturating_sub(spent)
}

/// ERC-8312 §IBudgetSubstrate: verify that reported remaining matches cap - spent.
/// remaining(id) is recomputed, never trusted.
pub fn verify_remaining(cap: u64, spent: u64, reported_remaining: u64) -> bool {
    spent <= cap && compute_remaining_headroom(cap, spent) == reported_remaining
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector from recompute-kit "8312/cap-conservation": holds
    #[test]
    fn golden_holds() {
        assert!(check_stateful_bound(100, 0, 150));
    }

    /// Golden vector: headroom
    #[test]
    fn golden_headroom() {
        assert!(check_cursor_headroom(0, 8000));
    }

    /// Golden vector: breach
    #[test]
    fn golden_breach() {
        assert!(!check_stateful_bound(100, 60, 150));
    }

    #[test]
    fn exact_cap_holds() {
        assert!(check_stateful_bound(100, 50, 150));
    }

    #[test]
    fn zero_aggregate_always_holds() {
        assert!(check_cursor_headroom(0, 0));
        assert!(check_cursor_headroom(0, 1));
    }

    /// Spec-aligned: remaining = cap - spent (IBudgetSubstrate)
    #[test]
    fn remaining_headroom_normal() {
        assert_eq!(compute_remaining_headroom(150, 60), 90);
    }

    #[test]
    fn remaining_headroom_exhausted() {
        assert_eq!(compute_remaining_headroom(150, 200), 0);
    }

    #[test]
    fn remaining_headroom_full() {
        assert_eq!(compute_remaining_headroom(150, 0), 150);
    }

    /// Golden vector "8312/budget-substrate — budget-headroom": cap=150, spent=60, remaining=90 → holds
    #[test]
    fn budget_headroom_holds() {
        assert_eq!(compute_remaining_headroom(150, 60), 90);
        assert!(verify_remaining(150, 60, 90));
    }

    /// Golden vector "8312/budget-substrate — budget-headroom-breach": spent > cap → rejects
    #[test]
    fn budget_headroom_breach() {
        assert_eq!(compute_remaining_headroom(150, 200), 0);
        assert!(!verify_remaining(150, 200, 0));
    }

    /// Golden vector "8312/budget-substrate — budget-substrate-misreport": reports 100 but cap - spent = 90 → rejects
    #[test]
    fn budget_substrate_misreport() {
        assert!(!verify_remaining(150, 60, 100));
    }
}

#[cfg(test)]
mod golden_vector_tests {
    use super::*;
    use serde_json::Value;

    const VECTORS_STR: &str = include_str!("../../../../testkit/vectors/erc8312.vectors.json");

    #[test]
    fn golden_vectors() {
        let data: Value = serde_json::from_str(VECTORS_STR).unwrap();
        for v in data["vectors"].as_array().unwrap() {
            let step = v["step"].as_str().unwrap();
            let expected = v["expected"].as_bool().unwrap();
            match step {
                "8312/cap-conservation" => {
                    let inputs = &v["inputs"];
                    if inputs.get("reserved").is_some() {
                        assert_eq!(
                            check_stateful_bound(
                                inputs["reserved"].as_u64().unwrap(),
                                inputs["confirmed"].as_u64().unwrap(),
                                inputs["cap"].as_u64().unwrap(),
                            ),
                            expected
                        );
                    } else {
                        assert_eq!(
                            check_cursor_headroom(
                                inputs["aggregate"].as_u64().unwrap(),
                                inputs["cap"].as_u64().unwrap(),
                            ),
                            expected
                        );
                    }
                }
                "8312/budget-substrate" => {
                    let inputs = &v["inputs"];
                    assert_eq!(
                        verify_remaining(
                            inputs["cap"].as_u64().unwrap(),
                            inputs["spent"].as_u64().unwrap(),
                            inputs["remaining"].as_u64().unwrap(),
                        ),
                        expected
                    );
                }
                _ => panic!("unknown step {}", step),
            }
        }
    }
}
