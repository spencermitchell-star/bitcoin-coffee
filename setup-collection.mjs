/**
 * Creates the "Bitcoin Coffee Membership" NFT collection on Solana DEVNET.
 *
 *   node setup-collection.mjs [--rpc https://api.devnet.solana.com]
 *
 * What it does (all real devnet transactions):
 *   1. Generates (or loads) an issuer keypair, funds it via devnet airdrop.
 *   2. Creates the collection SPL mint (0 decimals, supply 1).
 *   3. Creates the Metaplex metadata account (unsized collection, issuer =
 *      update authority, single verified creator = issuer).
 *   4. Creates the master edition (max supply 0) so members can be verified.
 *   5. Mints the 1 collection NFT to the issuer.
 *   6. Writes collection-config.json + issuer-keypair.json (DEVNET ONLY).
 *
 * REQUIREMENTS: run from a network that can reach Solana devnet.
 * This sandbox's shell cannot (api.devnet.solana.com drops connections);
 * run it from the user's phone browser flow or any devnet-reachable machine.
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
  findEditionPda,
  createMetadataV3Ix,
  createMasterEditionV3Ix,
} from './metadata-helpers.mjs';

const RPC_URL = process.argv.includes('--rpc')
  ? process.argv[process.argv.indexOf('--rpc') + 1]
  : 'https://api.devnet.solana.com';

if (!/devnet|localhost|127\.0\.0\.1/.test(RPC_URL)) {
  console.error(`REFUSING: ${RPC_URL} does not look like devnet. This script is devnet-only.`);
  process.exit(1);
}

const connection = new Connection(RPC_URL, 'confirmed');
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const exAddr = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

const KEYPAIR_PATH = new URL('./issuer-keypair.json', import.meta.url);
const CONFIG_PATH = new URL('./collection-config.json', import.meta.url);

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
  console.log(`Bitcoin Coffee collection setup — devnet via ${RPC_URL}\n`);

  // --- issuer keypair (devnet only, valueless) ---
  let issuer;
  if (existsSync(KEYPAIR_PATH)) {
    issuer = Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'))));
    console.log(`Loaded existing issuer: ${issuer.publicKey.toBase58()}`);
  } else {
    issuer = Keypair.generate();
    writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(issuer.secretKey)));
    console.log(`Generated new issuer: ${issuer.publicKey.toBase58()}`);
    console.log('  (secret saved to issuer-keypair.json — DEVNET ONLY, valueless)');
  }

  console.log('\nFunding issuer via devnet airdrop...');
  await airdrop(issuer.publicKey, 2, 'issuer');

  // --- collection mint (0 decimals, supply 1) ---
  console.log('\nCreating collection mint...');
  const mintKp = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_LAYOUT_SPAN);
  const metadataPda = findMetadataPda(mintKp.publicKey);
  const editionPda = findEditionPda(mintKp.publicKey);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      lamports: rent,
      space: MINT_LAYOUT_SPAN,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeMintIx(mintKp.publicKey, 0, issuer.publicKey),
    createMetadataV3Ix({
      metadataPda,
      mint: mintKp.publicKey,
      mintAuthority: issuer.publicKey,
      payer: issuer.publicKey,
      updateAuthority: issuer.publicKey,
      name: 'Bitcoin Coffee Membership',
      symbol: 'BCOF',
      uri: '',
      sellerFeeBps: 0,
      creators: [{ address: issuer.publicKey, verified: true, share: 100 }],
      collection: null, // this IS the collection
    }),
    createMasterEditionV3Ix({
      editionPda,
      mint: mintKp.publicKey,
      updateAuthority: issuer.publicKey,
      mintAuthority: issuer.publicKey,
      payer: issuer.publicKey,
      metadataPda,
      tokenProgramId: TOKEN_PROGRAM_ID,
      maxSupply: 0,
    })
  );
  const createSig = await sendAndConfirm(
    createTx,
    [issuer, mintKp],
    'collection created (mint + metadata + master edition)'
  );

  // --- mint the 1 collection NFT to the issuer ---
  const issuerATA = findATA(issuer.publicKey, mintKp.publicKey);
  const mintTx = new Transaction().add(
    createATAIx(issuer.publicKey, issuerATA, issuer.publicKey, mintKp.publicKey),
    mintToIx(mintKp.publicKey, issuerATA, issuer.publicKey, 1)
  );
  const mintSig = await sendAndConfirm(mintTx, [issuer], 'minted collection NFT (supply 1) to issuer');

  const config = {
    network: 'devnet',
    rpc: RPC_URL,
    created_at: new Date().toISOString(),
    issuer: issuer.publicKey.toBase58(),
    collection_mint: mintKp.publicKey.toBase58(),
    collection_metadata: metadataPda.toBase58(),
    collection_edition: editionPda.toBase58(),
    symbol: 'BCOF',
    transactions: { create: createSig, mint: mintSig },
    explorer: {
      collection: exAddr(mintKp.publicKey),
      create_tx: explorer(createSig),
      mint_tx: explorer(mintSig),
    },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('\nDone. Wrote collection-config.json');
  console.log(`Collection: ${config.collection_mint}`);
  console.log(`Explorer:   ${config.explorer.collection}`);
}

main().catch((e) => {
  console.error('\nSETUP FAILED:', e.message);
  process.exit(1);
});
