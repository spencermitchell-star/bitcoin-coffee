# Bitcoin Coffee — Membership NFT demo (Solana devnet)

Claim flow for the numbered **Bitcoin Coffee Membership NFTs** that ship with
the physical club cards. Built for the Colosseum *Crypto World's Fair*
hackathon under the Bitcoin Coffee identity.

Bitcoin Coffee — *Proof of roast.* Mascot: **Sato**.
Brand: Cosmic Orange `#E2622C` · Espresso `#1C1512` · Porcelain `#F7F4EF`.
(Brand rule honored: no Bitcoin "B" symbol or coin imagery anywhere.)

## What it is

Bitcoin Coffee is an online-only brand selling three numbered club-card tiers:

| Tier    | Card price | NFT                                     |
|---------|-----------:|-----------------------------------------|
| Bean    |        $56 | `Bitcoin Coffee — Member #NNN` + Tier attribute `Bean` |
| Roaster |       $132 | `Bitcoin Coffee — Member #NNN` + Tier attribute `Roaster` |
| Founder |       $325 | `Bitcoin Coffee — Member #NNN` + Tier attribute `Founder` |

(Tier names/prices are placeholders — edit the `TIERS` array at the top of
`index.html` and in `claim-test.mjs`.)

Each NFT is a real Metaplex Token Metadata asset on Solana **devnet**:
0-decimal SPL mint, supply 1, metadata with on-chain `data:` URI attributes
(Tier + Card Number, no IPFS/Arweave needed), single verified creator, and a
pointer to the `BCOF` collection. The collection update authority verifies
each claim with one `VerifyCollection` call.

## Architecture

```
setup-collection.mjs            claim (browser page or claim-test.mjs)
        │                                        │
        ▼                                        ▼
┌──────────────────┐                 ┌─────────────────────────┐
│ Collection mint  │                 │ Member mint (0 dec)     │
│ "Bitcoin Coffee  │   VerifyCollection│ "Member #001" + data-URI│
│  Membership"     │◄────────────────│  attributes, collection │
│ BCOF, supply 1   │  (issuer signs) │  pointer, minted 1×     │
│ + master edition │                 └─────────────────────────┘
└──────────────────┘
```

Design choices (deliberate, keep-it-working):

- **Unsized collection** (`collection_details: None`) so the widely-used legacy
  `VerifyCollection` (discriminator 18) applies — no sized-collection edge cases.
- **No custom program.** Everything is composed from the SPL Token program +
  Metaplex Token Metadata, so every step is a real, explorer-verifiable
  transaction. The browser claim is **one atomic transaction** (create mint +
  metadata + token account + mint 1).
- **Card numbers are user-entered** (they match the numbered physical card),
  so no on-chain counter is needed.
- **No wallet extension needed** — the page generates an in-browser demo
  keypair funded by devnet airdrop, same pattern as the parent `ui/` demo.
  The issuer keypair never ships in the page; verification happens separately.

## Files

- `index.html` — the claim page. Single file (+ `vendor/solana-web3.iife.min.js`).
- `metadata-helpers.mjs` — hand-rolled Token Metadata encoders
  (`CreateMetadataAccountV3` = 33, `CreateMasterEditionV3` = 17,
  `VerifyCollection` = 18) + PDA derivation + `data:` URI builder.
- `setup-collection.mjs` — creates the collection on devnet. **[NEEDS DEVNET]**
- `claim-test.mjs` — claims one NFT per tier + verifies each. **[NEEDS DEVNET]**
- `verify-offline.mjs` — builds every transaction type with no RPC; validates
  discriminators, account shapes, DataV2 limits, URI lengths, PDA derivation,
  and full tx serialization. **37/37 checks pass.**
- `vendor/solana-web3.iife.min.js` — vendored web3.js (copied from `../ui/vendor/`).

## Status — what is real vs. what needs a live run

**Verified offline (this machine, no RPC):**

- `node verify-offline.mjs` → 37/37 PASS: all instruction layouts, account
  lists, discriminator bytes, Metaplex string limits, `data:` URI attributes,
  PDA derivations, and complete serialization of the setup tx, the 5-instruction
  atomic claim tx, and the verify tx.
- `node --check` passes on all four scripts.

**[NEEDS DEVNET] — not yet executed (this sandbox cannot reach
`api.devnet.solana.com`; connections drop, `http_code=000`):**

- Collection address: **[NEEDS DEVNET]** — produced by `setup-collection.mjs`
- Claim transaction signatures (Bean / Roaster / Founder): **[NEEDS DEVNET]** —
  produced by `claim-test.mjs`
- `collection-config.json`, `issuer-keypair.json`, `claim-results.json`:
  **[NEEDS DEVNET]** — written by the scripts above

No signatures, mint addresses, or collection addresses have been fabricated;
every placeholder above is explicitly marked.

## How to run (from a devnet-reachable network)

The user's phone browser reaches devnet; any normal network works.

```bash
cd ~/workspace/bitcoin-coffee-solana/nft-demo

# 1. Create the collection (writes collection-config.json + issuer-keypair.json)
node setup-collection.mjs
#    alternate RPC: node setup-collection.mjs --rpc <devnet-rpc-url>

# 2a. Headless claim test: one NFT per tier, verified, results -> claim-results.json
node claim-test.mjs

# 2b. Interactive claim page (after step 1, so collection-config.json exists):
python3 -m http.server 8001
#    open http://localhost:8001 — pick a tier, enter a card number,
#    create a demo wallet, claim. Each claim links to Solana Explorer (devnet).
```

`issuer-keypair.json` is **DEVNET ONLY** (valueless test SOL). Never fund it
with real SOL or reuse it on mainnet.

## Known runtime risk (one item)

`VerifyCollection` is encoded with `collection_authority` as signer +
non-writable, per the Metaplex IDL. If a future Token Metadata version marks
that account writable, the live run will fail with a clear account-privilege
error — flip `isWritable` to `true` for `collectionAuthority` in
`verifyCollectionIx` and re-run. Everything else in the flow uses
long-stable instructions.
