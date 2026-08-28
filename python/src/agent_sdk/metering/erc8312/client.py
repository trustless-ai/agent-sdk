"""Typed clients for ERC-8312: Bounded Agent Actions, Budget Substrate, and
Contestable Envelope interfaces."""

from __future__ import annotations

from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.logs import DISCARD
from web3.middleware import SignAndSendRawMiddlewareBuilder

from .abi import (
    BOUNDED_AGENT_ACTION_ABI,
    BUDGET_SUBSTRATE_ABI,
    CONTESTABLE_ENVELOPE_ABI,
)


class BoundedAgentActionClient:
    """Typed client for IBoundedAgentAction (envelope lifecycle)."""

    def __init__(self, rpc_url: str, address: str, account: LocalAccount):
        self._w3 = Web3(Web3.HTTPProvider(rpc_url))
        self._w3.middleware_onion.add(SignAndSendRawMiddlewareBuilder.build(account))
        self._w3.eth.default_account = account.address
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(address), abi=BOUNDED_AGENT_ACTION_ABI
        )

    def register_envelope(
        self,
        principal: str,
        capability_root: bytes,
        expires_at: int,
        init_data: bytes,
    ) -> bytes:
        """Register a new envelope and return its id."""
        tx_hash = self._contract.functions.registerEnvelope(
            principal, capability_root, expires_at, init_data
        ).transact()
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        events = self._contract.events.EnvelopeRegistered().process_receipt(
            receipt, errors=DISCARD
        )
        if not events:
            raise RuntimeError(
                "registerEnvelope: EnvelopeRegistered event not found"
            )
        return events[0]["args"]["id"]

    def advance_cursor(self, id: bytes, witness: bytes) -> tuple[bytes, bytes]:
        """Advance the cursor and return (prevCursor, newCursor)."""
        tx_hash = self._contract.functions.advanceCursor(id, witness).transact()
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        events = self._contract.events.EnvelopeAdvanced().process_receipt(
            receipt, errors=DISCARD
        )
        if not events:
            raise RuntimeError(
                "advanceCursor: EnvelopeAdvanced event not found"
            )
        args = events[0]["args"]
        return args["prevCursor"], args["newCursor"]

    def set_status(self, id: bytes, new_status: int) -> None:
        """Transition the envelope's lifecycle status."""
        tx_hash = self._contract.functions.setStatus(id, new_status).transact()
        self._w3.eth.wait_for_transaction_receipt(tx_hash)

    def get_envelope(self, id: bytes) -> dict:
        """Read the full envelope struct."""
        env = self._contract.functions.getEnvelope(id).call()
        return {
            "id": env[0],
            "principal": env[1],
            "capabilityRoot": env[2],
            "cursorRoot": env[3],
            "createdAt": env[4],
            "expiresAt": env[5],
            "status": env[6],
        }

    def get_cursor(self, id: bytes) -> bytes:
        """Read the current cursor commitment."""
        return self._contract.functions.getCursor(id).call()

    def get_status(self, id: bytes) -> int:
        """Read the effective lifecycle status."""
        return self._contract.functions.getStatus(id).call()

    def is_active(self, id: bytes) -> bool:
        """Check if the envelope is currently active."""
        return self._contract.functions.isActive(id).call()


class BudgetSubstrateClient:
    """Typed client for IBudgetSubstrate (budget profile reads)."""

    def __init__(self, rpc_url: str, address: str):
        self._w3 = Web3(Web3.HTTPProvider(rpc_url))
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(address), abi=BUDGET_SUBSTRATE_ABI
        )

    def bound(self, id: bytes) -> tuple[int, str]:
        """Return (cap, asset) for the given envelope."""
        return self._contract.functions.bound(id).call()

    def spent(self, id: bytes) -> int:
        """Return cumulative spent value."""
        return self._contract.functions.spent(id).call()

    def remaining(self, id: bytes) -> int:
        """Return remaining headroom (cap - spent) or 0."""
        return self._contract.functions.remaining(id).call()


class ContestableEnvelopeClient:
    """Typed client for IContestableEnvelope (contestation lifecycle)."""

    def __init__(self, rpc_url: str, address: str, account: LocalAccount):
        self._w3 = Web3(Web3.HTTPProvider(rpc_url))
        self._w3.middleware_onion.add(SignAndSendRawMiddlewareBuilder.build(account))
        self._w3.eth.default_account = account.address
        self._contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=CONTESTABLE_ENVELOPE_ABI,
        )

    def contest(self, id: bytes, evidence: bytes) -> tuple[bytes, str]:
        """Contest an envelope and return (id, challenger address)."""
        tx_hash = self._contract.functions.contest(id, evidence).transact()
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        events = self._contract.events.EnvelopeContested().process_receipt(
            receipt, errors=DISCARD
        )
        if not events:
            raise RuntimeError("contest: EnvelopeContested event not found")
        args = events[0]["args"]
        return args["id"], args["challenger"]

    def resolve(self, id: bytes, outcome: int, resolution: bytes) -> tuple[bytes, int]:
        """Resolve a contested envelope and return (id, outcome)."""
        tx_hash = self._contract.functions.resolve(
            id, outcome, resolution
        ).transact()
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        events = self._contract.events.EnvelopeResolved().process_receipt(
            receipt, errors=DISCARD
        )
        if not events:
            raise RuntimeError("resolve: EnvelopeResolved event not found")
        args = events[0]["args"]
        return args["id"], args["outcome"]
