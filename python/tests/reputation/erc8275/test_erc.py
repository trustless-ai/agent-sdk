import pytest
from eth_account import Account
from web3 import Web3

from agent_sdk.reputation.erc8275.client import AgentReputationClient
from agent_sdk.reputation.erc8275.recompute import compute_win_rate


def _make_client(deploy_contract, anvil_rpc_url, anvil_acct_fn):
    contract_address = Web3.to_checksum_address(
        deploy_contract("reputation/ERC8275", "DeployERC8275")
    )
    account = Account.from_key(anvil_acct_fn(1)["privateKey"])
    client = AgentReputationClient(anvil_rpc_url, contract_address, account)
    return client


class TestAgentReputationClient:
    """Integration tests for ERC-8275 Agent Reputation client."""

    def _agent_id(self, label: str) -> str:
        return Web3.to_hex(Web3.keccak(text=label))

    def _order_id(self, label: str) -> str:
        return Web3.to_hex(Web3.keccak(text=label))

    def test_get_reputation_default(self, deploy_contract, anvil_rpc_url, anvil_account):
        client = _make_client(deploy_contract, anvil_rpc_url, anvil_account)
        agent_id = self._agent_id("test-agent")

        rep = client.get_reputation(agent_id)
        assert rep.completed_orders == 0
        assert rep.disputed_orders == 0
        assert rep.total_volume == 0
        assert rep.last_active_at == 0
        assert rep.score == 0

    def test_get_decay_weight_default(self, deploy_contract, anvil_rpc_url, anvil_account):
        client = _make_client(deploy_contract, anvil_rpc_url, anvil_account)
        agent_id = self._agent_id("test-agent")

        weight = client.get_decay_weight(agent_id)
        assert weight == 0

    def test_verify_outcome_unknown(self, deploy_contract, anvil_rpc_url, anvil_account):
        client = _make_client(deploy_contract, anvil_rpc_url, anvil_account)
        order_id = self._order_id("test-order")
        proof = b"\x00" * 32

        valid = client.verify_outcome(order_id, proof)
        assert valid is False

    def test_compute_win_rate(self, deploy_contract, anvil_rpc_url, anvil_account):
        """Recompute-to-verify: computeWinRate from public inputs (no contract needed)."""
        assert compute_win_rate(16, 15) == 5161
        assert compute_win_rate(10, 0) == 10000
        assert compute_win_rate(0, 10) == 0

        with pytest.raises(ValueError):
            compute_win_rate(0, 0)
