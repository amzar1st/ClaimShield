# ClaimShield

ClaimShield is a GenLayer purchase and warranty dispute application. A buyer funds escrow under immutable purchase terms; the seller explicitly accepts the exact terms and warranty hashes. Buyers and sellers submit SHA-256 commitments to public HTTPS evidence, and GenLayer validators fetch matching content and evaluate the warranty claim. A verdict becomes final after a challenge window, then parties withdraw their allocation.

## Status

The contract and browser application are implemented and locally tested. **No Studionet deployment, live contract address, finalized on-chain lifecycle, or public website is claimed in this repository yet.** The app intentionally disables wallet writes until a verified `VITE_CONTRACT_ADDRESS` is configured. Contract code and tests are public for review. The deployment and live proof record should be added only after a finalized deployment and reads confirm the same source.

## Workflow

`create_purchase` (buyer, payable) → `register_warranty` (seller, exact hashes) → `open_claim` (buyer) → `seller_response` → evidence from each side → `adjudicate_claim` → optional `challenge_verdict` and counter-evidence → `adjudicate_claim` again → `finalize` → `claim_funds`.

The buyer can recover escrow if the seller does not accept within two days. An active purchase can be approved by the buyer or released after warranty expiry. The evidence window is three days, challenge window two days, and replacement period seven days. If an adjudication is unavailable after seven additional days, or a challenged review times out, either party may settle neutrally at half the escrow. An unavailable or mismatched URL never creates a full buyer refund by itself. A replacement verdict keeps escrow locked until confirmation or its deadline. A missing shipment refunds the buyer; a sent but unconfirmed shipment yields a neutral split after seven days.

Verdicts: `WARRANTY_VALID` (buyer refund), `CLAIM_REJECTED` (seller release), `PARTIAL_REFUND` (half each), `REPLACEMENT_REQUIRED` (replacement workflow), `INSUFFICIENT_EVIDENCE` (half each). A partial verdict is a fixed 50% allocation; the model cannot choose an arbitrary amount.

## Evidence and trust boundary

- The purchase terms and warranty URLs and SHA-256 digests are fixed at funding; seller acceptance cannot alter them.
- Each party has three reserved evidence slots. A URL must be HTTPS with a 64-character lowercase SHA-256 digest. The evidence body is fetched, size capped, hashed, and only matching bodies enter the AI prompt. Conclusive verdict citations must refer to fetched pages.
- Public URLs are not authenticated testimony. Hashes bind bytes, but parties and hosts can choose or remove content. The validator prompt treats all page text as evidence rather than instructions. Parties should use stable, independent records where possible.
- A validator's exact categorical verdict is compared independently; prose can differ. The consensus result and citations are checked again before storage. Invalid output becomes `INSUFFICIENT_EVIDENCE`.
- Escrow allocations are credited once. `claim_funds` clears credit before emitting a finalized external transfer. Check the external message's finalization separately when auditing actual payouts.

## Local development

Python 3.12+:

```sh
pip install genlayer-test pytest
pytest tests -q
```

Frontend (Node 20+):

```sh
cd web
npm ci
cp .env.example .env
# Enter a verified contract address in VITE_CONTRACT_ADDRESS
npm run build
npm run dev
```

The app uses `genlayer-js` 1.1.8's `waitForTransactionReceipt({status: FINALIZED})` and reads `LATEST_FINAL`. It does not display sample claims as live records. Browser wallet writes require Studionet and the contract address. The site can be statically hosted from `web/dist` after building with the verified address.

## Deployment verification checklist

1. Deploy `contracts/claimshield.py` in GenLayer Studio on Studionet with no constructor arguments; record the finalized transaction, address, code hash, and explorer link.
2. Call `get_count()` at `LATEST_FINAL`; expect `0` on a fresh deployment. Compare deployed code with the repository source.
3. Fund a small test purchase from a buyer wallet; use a separate seller wallet to accept the fixed digests. Read final state after each write.
4. Run the claim, seller response, both evidence submissions, verdict, challenge and second review, finalization, credit, and withdrawal. Observe external payout completion, not just the parent write receipt.
5. Set `VITE_CONTRACT_ADDRESS`, build and publish the site, then test wallet connection, write, final receipt, and public read from the published origin.

Do not submit a deployment address or end-to-end proof until those checks actually succeed. This is test-network escrow software and has not been audited for real-value use.
