"""Integration tests for ERC-8312 metering clients."""

from unittest.mock import MagicMock

from eth_account import Account
from web3 import Web3

from agent_sdk.metering.erc8312.client import (
    BoundedAgentActionClient,
    BudgetSubstrateClient,
    ContestableEnvelopeClient,
)

# A fixed future expiry timestamp for all test envelopes
EXPIRES_AT = 2000000000


def test_set_status_waits_for_transaction_receipt():
    client = object.__new__(BoundedAgentActionClient)
    client._contract = MagicMock()
    client._w3 = MagicMock()
    tx_hash = bytes.fromhex("12" * 32)
    client._contract.functions.setStatus.return_value.transact.return_value = tx_hash

    client.set_status(bytes.fromhex("34" * 32), 2)

    client._w3.eth.wait_for_transaction_receipt.assert_called_once_with(tx_hash)


def _make_clients(deploy_contracts, anvil_rpc_url, anvil_account):
    (
        bounded_action_address,
        budget_address,
        contestable_address,
    ) = deploy_contracts("metering/ERC8312", "DeployERC8312")
    account = Account.from_key(anvil_account(1)["privateKey"])
    bounded_client = BoundedAgentActionClient(anvil_rpc_url, bounded_action_address, account)
    budget_client = BudgetSubstrateClient(anvil_rpc_url, budget_address)
    contestable_client = ContestableEnvelopeClient(anvil_rpc_url, contestable_address, account)
    # Separate bounded clients pointed at budget and contestable contracts
    budget_action_client = BoundedAgentActionClient(anvil_rpc_url, budget_address, account)
    contestable_action_client = BoundedAgentActionClient(anvil_rpc_url, contestable_address, account)
    return bounded_client, budget_client, contestable_client, budget_action_client, contestable_action_client


def test_registers_envelope_and_reads_metadata(deploy_contracts, anvil_rpc_url, anvil_account):
    bounded, _, _, _, _ = _make_clients(deploy_contracts, anvil_rpc_url, anvil_account)

    principal = anvil_account(1)["address"]
    capability_root = Web3.keccak(text="my-capability")

    envelope_id = bounded.register_envelope(principal, capability_root, EXPIRES_AT, b"")
    assert envelope_id is not None
    assert envelope_id != b"\x00" * 32

    env = bounded.get_envelope(envelope_id)
    assert env["principal"].lower() == principal.lower()
    assert env["capabilityRoot"] == capability_root
    assert env["status"] == 1  # Active


def test_advances_cursor(deploy_contracts, anvil_rpc_url, anvil_account):
    bounded, _, _, _, _ = _make_clients(deploy_contracts, anvil_rpc_url, anvil_account)

    principal = anvil_account(1)["address"]
    capability_root = Web3.keccak(text="cursor-test")

    envelope_id = bounded.register_envelope(principal, capability_root, EXPIRES_AT, b"")

    cursor0 = bounded.get_cursor(envelope_id)
    assert cursor0 == b"\x00" * 32

    witness = Web3.keccak(text="advance-1")
    prev_cursor, new_cursor = bounded.advance_cursor(envelope_id, witness)
    assert prev_cursor == cursor0
    assert new_cursor != b"\x00" * 32
    assert new_cursor != prev_cursor


def test_reads_status_and_is_active(deploy_contracts, anvil_rpc_url, anvil_account):
    bounded, _, _, _, _ = _make_clients(deploy_contracts, anvil_rpc_url, anvil_account)

    principal = anvil_account(1)["address"]
    capability_root = Web3.keccak(text="status-test")

    envelope_id = bounded.register_envelope(principal, capability_root, EXPIRES_AT, b"")

    assert bounded.is_active(envelope_id) is True
    assert bounded.get_status(envelope_id) == 1  # Active

    bounded.set_status(envelope_id, 2)  # Completed

    assert bounded.get_status(envelope_id) == 2  # Completed
    assert bounded.is_active(envelope_id) is False


def test_budget_substrate_bound_spent_remaining(deploy_contracts, anvil_rpc_url, anvil_account):
    _, budget, _, budget_action, _ = _make_clients(deploy_contracts, anvil_rpc_url, anvil_account)

    principal = anvil_account(1)["address"]
    capability_root = Web3.keccak(text="budget-test")

    # Register on the budget contract itself (not the standalone bounded action contract)
    envelope_id = budget_action.register_envelope(principal, capability_root, EXPIRES_AT, b"")

    cap, asset = budget.bound(envelope_id)
    assert cap > 0
    assert asset is not None

    assert budget.spent(envelope_id) == 0
    assert budget.remaining(envelope_id) == cap


def test_contest_and_resolve_to_active(deploy_contracts, anvil_rpc_url, anvil_account):
    _, _, contestable, _, contestable_action = _make_clients(deploy_contracts, anvil_rpc_url, anvil_account)

    principal = anvil_account(1)["address"]
    capability_root = Web3.keccak(text="contest-test")

    # Register on the contestable contract itself
    envelope_id = contestable_action.register_envelope(principal, capability_root, EXPIRES_AT, b"")

    contested_id, challenger = contestable.contest(envelope_id, b"evidence")
    assert contested_id == envelope_id

    status = contestable_action.get_status(envelope_id)
    assert status == 3  # Contested

    # Resolve back to Active
    resolved_id, outcome = contestable.resolve(envelope_id, 1, b"resolution")
    assert resolved_id == envelope_id
