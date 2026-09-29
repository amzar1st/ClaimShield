import hashlib
import json
import pytest

BUYER = "0x" + "a" * 40
SELLER = "0x" + "b" * 40
TERMS = b"Laptop model L, price 1 GEN, delivered today."
POLICY = b"Warranty covers manufacturing defects for thirty days."


def state(contract, purchase_id="order-1"):
    return json.loads(contract.get_purchase(purchase_id))


@pytest.fixture
def ready(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/claimshield.py", sdk_version="v0.2.12")
    direct_vm.sender = bytes.fromhex(BUYER[2:])
    direct_vm.deal(direct_vm.sender, 10**20)
    direct_vm.value = 10**18
    contract.create_purchase("order-1", SELLER, "Laptop L",
                             "https://example.com/terms", hashlib.sha256(TERMS).hexdigest(),
                             "https://example.com/policy", hashlib.sha256(POLICY).hexdigest(),
                             30)
    direct_vm.value = 0
    return contract


def test_fixed_terms_and_seller_acceptance(ready, direct_vm):
    with direct_vm.expect_revert("Seller only"):
        ready.register_warranty("order-1", hashlib.sha256(TERMS).hexdigest(), hashlib.sha256(POLICY).hexdigest())
    direct_vm.sender = bytes.fromhex(SELLER[2:])
    with direct_vm.expect_revert("Terms differ"):
        ready.register_warranty("order-1", "0" * 64, hashlib.sha256(POLICY).hexdigest())
    ready.register_warranty("order-1", hashlib.sha256(TERMS).hexdigest(), hashlib.sha256(POLICY).hexdigest())
    assert state(ready)["status"] == "ACTIVE"


def test_unaccepted_refund_only_after_deadline(ready, direct_vm):
    with direct_vm.expect_revert("Acceptance still open"):
        ready.cancel_unaccepted("order-1")
    direct_vm.warp("2030-01-01T00:00:00+00:00")
    ready.cancel_unaccepted("order-1")
    assert state(ready)["buyer_amount"] == str(10**18)
    assert ready.get_claimable(BUYER) == str(10**18)
    with direct_vm.expect_revert("Acceptance still open"):
        ready.cancel_unaccepted("order-1")


def test_claim_access_and_evidence_capacity(ready, direct_vm):
    direct_vm.sender = bytes.fromhex(SELLER[2:])
    ready.register_warranty("order-1", hashlib.sha256(TERMS).hexdigest(), hashlib.sha256(POLICY).hexdigest())
    with direct_vm.expect_revert("Buyer with active"):
        ready.open_claim("order-1", "The charging port stopped working after twelve days.")
    direct_vm.sender = bytes.fromhex(BUYER[2:])
    ready.open_claim("order-1", "The charging port stopped working after twelve days.")
    for n in range(3):
        ready.submit_evidence("order-1", f"https://example.com/receipt-{n}", "a" * 64)
    with direct_vm.expect_revert("Three evidence slots"):
        ready.submit_evidence("order-1", "https://example.com/receipt-3", "a" * 64)
    with direct_vm.expect_revert("Public HTTPS"):
        ready.submit_evidence("order-1", "http://localhost/private", "a" * 64)
    direct_vm.sender = bytes.fromhex(SELLER[2:])
    ready.submit_evidence("order-1", "https://example.com/seller-report", "b" * 64)
    assert len(state(ready)["seller_evidence"]) == 1


def test_refund_and_double_claim_prevention(ready, direct_vm):
    direct_vm.sender = bytes.fromhex(SELLER[2:])
    ready.register_warranty("order-1", hashlib.sha256(TERMS).hexdigest(), hashlib.sha256(POLICY).hexdigest())
    direct_vm.sender = bytes.fromhex(BUYER[2:])
    ready.complete_purchase("order-1")
    assert ready.get_claimable(SELLER) == str(10**18)
    with direct_vm.expect_revert("No funds to claim"):
        ready.claim_funds()
    with direct_vm.expect_revert("Buyer with active"):
        ready.complete_purchase("order-1")


def open_dispute(contract, vm):
    vm.sender = bytes.fromhex(SELLER[2:])
    contract.register_warranty("order-1", hashlib.sha256(TERMS).hexdigest(), hashlib.sha256(POLICY).hexdigest())
    vm.sender = bytes.fromhex(BUYER[2:])
    contract.open_claim("order-1", "The charging port stopped working after twelve days.")
    vm.sender = bytes.fromhex(SELLER[2:])
    contract.seller_response("order-1", "We believe the charging port was damaged by misuse.")
    vm.sender = bytes.fromhex(BUYER[2:])
    contract.submit_evidence("order-1", "https://example.com/photo", hashlib.sha256(b"Photo shows factory defect").hexdigest())


def test_verified_verdict_challenge_and_payout(ready, direct_vm):
    open_dispute(ready, direct_vm)
    direct_vm.mock_web(r"example.com/terms", {"status": 200, "body": TERMS.decode()})
    direct_vm.mock_web(r"example.com/policy", {"status": 200, "body": POLICY.decode()})
    direct_vm.mock_web(r"example.com/photo", {"status": 200, "body": "Photo shows factory defect"})
    direct_vm.mock_llm(r"Judge this purchase", json.dumps({"verdict": "WARRANTY_VALID", "reason": "Defect covered", "cited_urls": ["https://example.com/policy", "https://example.com/photo"]}))
    with direct_vm.expect_revert("Evidence window still open"):
        ready.adjudicate_claim("order-1")
    direct_vm.warp("2027-01-01T00:00:00+00:00")
    ready.adjudicate_claim("order-1")
    assert state(ready)["verdict"] == "WARRANTY_VALID"
    with direct_vm.expect_revert("Challenge window still open"):
        ready.finalize("order-1")
    ready.challenge_verdict("order-1", "The inspection report should be reconsidered by validators.")
    with direct_vm.expect_revert("Evidence window still open"):
        ready.adjudicate_claim("order-1")
    direct_vm.warp("2030-01-01T00:00:00+00:00")
    ready.resolve_review_timeout("order-1")
    assert state(ready)["status"] == "SETTLED"
    assert ready.get_claimable(BUYER) == str(10**18//2)


def test_mismatched_terms_do_not_produce_full_refund(ready, direct_vm):
    open_dispute(ready, direct_vm)
    direct_vm.mock_web(r"example.com/terms", {"status": 200, "body": "Changed terms"})
    direct_vm.mock_web(r"example.com/policy", {"status": 200, "body": POLICY.decode()})
    direct_vm.mock_web(r"example.com/photo", {"status": 200, "body": "Photo shows factory defect"})
    direct_vm.warp("2027-01-01T00:00:00+00:00")
    ready.adjudicate_claim("order-1")
    assert state(ready)["verdict"] == "INSUFFICIENT_EVIDENCE"
    direct_vm.warp("2030-01-01T00:00:00+00:00")
    ready.finalize("order-1")
    assert ready.get_claimable(BUYER) == str(10**18//2)
    assert ready.get_claimable(SELLER) == str(10**18//2)


def test_evidence_timeout_is_neutral_and_claims_do_not_reopen(ready, direct_vm):
    open_dispute(ready, direct_vm)
    direct_vm.warp("2030-01-01T00:00:00+00:00")
    ready.resolve_evidence_timeout("order-1")
    assert ready.get_claimable(BUYER) == str(10**18//2)
    with direct_vm.expect_revert("No open review"):
        ready.adjudicate_claim("order-1")


def test_unfetched_citation_cannot_support_conclusive_verdict(ready, direct_vm):
    open_dispute(ready, direct_vm)
    direct_vm.mock_web(r"example.com/terms", {"status": 200, "body": TERMS.decode()})
    direct_vm.mock_web(r"example.com/policy", {"status": 200, "body": POLICY.decode()})
    direct_vm.mock_web(r"example.com/photo", {"status": 200, "body": "wrong bytes"})
    direct_vm.mock_llm(r"Judge this purchase", json.dumps({"verdict": "WARRANTY_VALID", "reason": "Unverified claim", "cited_urls": ["https://example.com/photo"]}))
    direct_vm.warp("2027-01-01T00:00:00+00:00")
    ready.adjudicate_claim("order-1")
    assert state(ready)["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_replacement_timeout_refunds_if_never_shipped(ready, direct_vm):
    open_dispute(ready, direct_vm)
    direct_vm.mock_web(r"example.com/terms", {"status": 200, "body": TERMS.decode()})
    direct_vm.mock_web(r"example.com/policy", {"status": 200, "body": POLICY.decode()})
    direct_vm.mock_web(r"example.com/photo", {"status": 200, "body": "Photo shows factory defect"})
    direct_vm.mock_llm(r"Judge this purchase", json.dumps({"verdict": "REPLACEMENT_REQUIRED", "reason": "Covered defect", "cited_urls": ["https://example.com/policy"]}))
    direct_vm.warp("2027-01-01T00:00:00+00:00")
    ready.adjudicate_claim("order-1")
    direct_vm.warp("2027-01-04T00:00:00+00:00")
    ready.finalize("order-1")
    with direct_vm.expect_revert("Replacement deadline not reached"):
        ready.resolve_replacement_timeout("order-1")
    direct_vm.warp("2027-01-12T00:00:00+00:00")
    ready.resolve_replacement_timeout("order-1")
    assert ready.get_claimable(BUYER) == str(10**18)
