# ClaimShield

ClaimShield is a GenLayer purchase and warranty dispute application. A buyer funds escrow under immutable purchase terms; the seller explicitly accepts the exact terms and warranty hashes. Buyers and sellers submit SHA-256 commitments to public HTTPS evidence, and GenLayer validators fetch matching content and evaluate the warranty claim. A verdict becomes final after a challenge window, then parties withdraw their allocation.

## Status

The contract and browser application are implemented and locally tested. The contract was deployed on GenLayer Studionet with Normal (Full Consensus) execution, and its first finalized `get_count()` read returned `0`. The production website build points to that deployment. A complete on-chain purchase and claim lifecycle has not yet been demonstrated; the local tests cover those paths.

- Contract: `0x1a52a2AC72D67dE058928Eb8857876deCeA48d25`
- Deployment transaction: `0xf9feadf9e1a4fa43c13a076a4806ed57fa7d3bc5a0a2db556f0960c5eb37ae9a`
- Explorer: https://explorer-studio.genlayer.com/address/0x1a52a2AC72D67dE058928Eb8857876deCeA48d25

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
pip install genlayer-test==0.29.2 pytest
pytest tests -q
```

Frontend (Node 20+):

```sh
cd web
npm ci
# The production address is in .env.production; for local dev:
cp .env.production .env
npm run build
npm run dev
```

The app uses `genlayer-js` 1.1.8's `waitForTransactionReceipt({status: FINALIZED})` and reads `LATEST_FINAL`. It does not display sample claims as live records. Browser wallet writes require Studionet and the contract address. The site can be statically hosted from `web/dist` after building with the verified address.

## Deployment verification checklist

1. [Done] Deploy `contracts/claimshield.py` in GenLayer Studio on Studionet with no constructor arguments and record the finalized transaction and address. Studio displayed the uploaded source; an independent deployed-code hash comparison is still outstanding.
2. [Done] Call `get_count()` with Studio's Finalized state; it returned `0` on the fresh deployment.
3. Fund a small test purchase from a buyer wallet; use a separate seller wallet to accept the fixed digests. Read final state after each write.
4. Run the claim, seller response, both evidence submissions, verdict, challenge and second review, finalization, credit, and withdrawal. Observe external payout completion, not just the parent write receipt.
5. Build and publish the site with the configured address. Test wallet connection, write, final receipt, and public read from the published origin.

Do not describe the live claim lifecycle as verified until those checks actually succeed. This is test-network escrow software and has not been audited for real-value use.
