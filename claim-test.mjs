/**
 * End-to-end claim test: mints one Bitcoin Coffee Membership NFT per tier
 * on Solana DEVNET and verifies each against the collection.
 *
 *   node claim-test.mjs [--rpc https://api.devnet.solana.com]
 *
 * Prerequisites: node setup-collection.mjs has been run (collection-config.json
 * and issuer-keypair.json exist).
 *
 * Per tier (Bean / Roaster / Founder) it:
 *   1. Generates a fresh member wallet, funds via devnet airdrop.
 *   2. Creates the member mint (0 decimals) + metadata in ONE atomic tx:
 *      name "Bitcoin Coffee — Member #00N", symbol BCOF, on-chain data-URI
 *      attributes (Tier + Card Number), collection pointer (unverified),
 *      creator = member (verified, 100%).
 *   3. Mints 1 NFT to the member.
 *   4. Runs VerifyCollection signed by the collection update authority
 *      (the issuer) -> collection.verified = true on-chain.
 *   5. Writes claim-results.json with REAL signatures + explorer links.
 *
 * REQUIREMENTS: run from a network that can reach Solana devnet.
 * NEVER run against mainnet — the script refuses non-devnet RPC URLs.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  TOKEN_PROGRAM_ID,
  MINT_LAYOUT_SPAN,
  initializeMintIx,
  mintToIx,
  createATAIx,
  findATA,
} from '../token-helpers.mjs';
import {
  findMetadataPda,
  createMetadataV3Ix,
  verifyCollectionIx,
  memberUri,
  memberName,
} from './metadata-helpers.mjs';

const RPC_URL = process.argv.includes('--rpc')
  ? process.argv[process.argv.indexOf('--rpc') + 1]
  : 'https://api.devnet.solana.com';

if (!/devnet|localhost|127\.0\.0\.1/.test(RPC_URL)) {
  console.error(`REFUSING: ${RPC_URL} does not look like devnet. This script is devnet-only.`);
  process.exit(1);
}

const CONFIG_PATH = new URL('./collection-config.json', import.meta.url);
const KEYPAIR_PATH = new URL('./issuer-keypair.json', import.meta.url);
const RESULTS_PATH = new URL('./claim-results.json', import.meta.url);

if (!existsSync(CONFIG_PATH) || !existsSync(KEYPAIR_PATH)) {
  console.error('Missing collection-config.json or issuer-keypair.json — run setup-collection.mjs first.');
  process.exit(1);
}

// Tier mapping mirrors the club cards: name + USD price of the physical card.
const TIERS = [
  { tier: 'Bean', priceUsd: 56 },
  { tier: 'Roaster', priceUsd: 132 },
  { tier: 'Founder', priceUsd: 325 },
];

const connection = new Connection(RPC_URL, 'confirmed');
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const exAddr = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

async function airdrop(pubkey, sol, label) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log(`  [airdrop] ${label}: ${sol} SOL ok`);
      return;
    } catch (e) {
      console.log(`  [airdrop] ${label} attempt ${attempt} failed: ${e.message}`);
      if (attempt === 5) throw e;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

async function sendAndConfirm(tx, signers, label) {
  const sig = await connection.sendTransaction(tx, signers, { skipPreflight: false });
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`  [tx] ${label}\n       ${sig}\n       ${explorer(sig)}`);
  return sig;
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const issuer = Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'))));
  const { PublicKey } = await import('@solana/web3.js');
  const collectionMint = new PublicKey(config.collection_mint);
  const collectionMetadataPda = new PublicKey(config.collection_metadata);
  const collectionEditionPda = new PublicKey(config.collection_edition);

  console.log(`Bitcoin Coffee claim test — devnet via ${RPC_URL}`);
  console.log(`Collection: ${config.collection_mint}\n`);

  const claims = [];
  let cardNumber = 1;

  for (const { tier, priceUsd } of TIERS) {
    console.log(`--- Claiming ${tier} tier (card #${cardNumber}) ---`);
    const member = Keypair.generate();
    await airdrop(member.publicKey, 1, `member (${tier})`);

    const name = memberName(cardNumber);
    const uri = memberUri(tier, cardNumber);
    const mintKp = Keypair.generate();
    const metadataPda = findMetadataPda(mintKp.publicKey);
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_LAYOUT_SPAN);

    // One atomic tx: create mint + metadata + ATA + mint 1 NFT to member.
    const claimTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: member.publicKey,
        newAccountPubkey: mintKp.publicKey,
        lamports: rent,
        space: MINT_LAYOUT_SPAN,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeMintIx(mintKp.publicKey, 0, member.publicKey),
      createMetadataV3Ix({
        metadataPda,
        mint: mintKp.publicKey,
        mintAuthority: member.publicKey,
        payer: member.publicKey,
        updateAuthority: member.publicKey,
        name,
        symbol: 'BCOF',
        uri,
        sellerFeeBps: 0,
        creators: [{ address: member.publicKey, verified: true, share: 100 }],
        collection: { verified: false, key: collectionMint },
      })
    );
    const memberATA = findATA(member.publicKey, mintKp.publicKey);
    claimTx.add(
      createATAIx(member.publicKey, memberATA, member.publicKey, mintKp.publicKey),
      mintToIx(mintKp.publicKey, memberATA, member.publicKey, 1)
    );
    const claimSig = await sendAndConfirm(claimTx, [member, mintKp], `claim ${tier} NFT "${name}"`);

    // Verify against the collection (signed by the collection update authority).
    const verifyTx = new Transaction().add(
      verifyCollectionIx({
        memberMetadataPda: metadataPda,
        collectionAuthority: issuer.publicKey,
        payer: issuer.publicKey,
        collectionMint,
        collectionMetadataPda,
        collectionEditionPda,
      })
    );
    const verifySig = await sendAndConfirm(verifyTx, [issuer], `verify "${name}" against collection`);

    claims.push({
      tier,
      price_usd: priceUsd,
      card_number: cardNumber,
      name,
      member_wallet: member.publicKey.toBase58(),
      member_mint: mintKp.publicKey.toBase58(),
      claim_signature: claimSig,
      verify_signature: verifySig,
      explorer: {
        nft: exAddr(mintKp.publicKey),
        claim_tx: explorer(claimSig),
        verify_tx: explorer(verifySig),
      },
    });
    console.log(`  "${name}" -> ${mintKp.publicKey.toBase58()}\n`);
    cardNumber += 1;
  }

  const results = {
    network: 'devnet',
    rpc: RPC_URL,
    ran_at: new Date().toISOString(),
    collection_mint: config.collection_mint,
    collection_explorer: exAddr(config.collection_mint),
    claims,
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log('Done. Wrote claim-results.json with', claims.length, 'claims.');
}

main().catch((e) => {
  console.error('\nCLAIM TEST FAILED:', e.message);
  process.exit(1);
});
