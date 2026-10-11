# Bitcoin Coffee — Membership NFTs on Solana

Colosseum "Crypto World's Fair" hackathon submission. Bitcoin Coffee is an
online-only coffee brand; this repo is the on-chain claim flow for its numbered
club membership NFTs (tiers: Bean $56 / Roaster $132 / Founder $325, on sale
October 29, 2026).

## What it does

A visitor picks a tier, taps once, and the page: generates fresh in-browser
wallets, funds them via Solana devnet airdrop, creates the `BCOF` membership
NFT collection, mints a numbered membership NFT (`Bitcoin Coffee — Member #NNN`
with Tier + Card Number attributes) to the visitor's wallet, and verifies it
against the collection — all as real Solana devnet transactions, each linked
to Solana Explorer.

No wallet extension needed. No custom on-chain program — everything is composed
from the SPL Token program + Metaplex Token Metadata, so every step is a real,
explorer-verifiable transaction.

## Files

- `claim-standalone.html` — the whole demo in one file. Open it from any
  devnet-reachable browser and tap "Create collection & claim".
- `index.html` — claim page (expects `collection-config.json` from setup).
- `setup-collection.mjs` — creates the collection: `node setup-collection.mjs`
- `claim-test.mjs` — headless end-to-end test, one NFT per tier: `node claim-test.mjs`
- `metadata-helpers.mjs` — hand-rolled Metaplex Token Metadata instruction encoders
- `verify-offline.mjs` — offline verification of every transaction layout (37/37 pass)
- `README.md` — full architecture, tier mapping, run instructions (in `nft-demo`)

## Brand

Bitcoin Coffee — "Proof of roast." Mascot: Sato. Colors: Cosmic Orange
`#E2622C`, Espresso `#1C1512`, Porcelain `#F7F4EF`. Brand rule honored
throughout: no Bitcoin "B" symbol or coin imagery.

## Prior work

The Bitcoin Coffee brand, Shopify store, and social accounts predate this
hackathon (brand launched October 2026). All Solana work in this repo was
written for this submission.
