/**
 * Offline verification for the Bitcoin Coffee Membership NFT demo.
 * Builds every transaction type WITHOUT any RPC connection and validates:
 *   - Metaplex instruction discriminators (33 / 17 / 18)
 *   - Account list shapes (counts + signer/writable flags)
 *   - DataV2 field limits (name 32 / symbol 10 / uri 200 bytes)
 *   - Creator-share validation, member URI length, PDA derivation
 *   - Full transaction serialization (setup tx, atomic claim tx, verify tx)
 *
 * Usage: node verify-offline.mjs
 * Exit 0 = all checks pass. No network access is used or needed.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_LAYOUT_SPAN,
  initializeMintIx,
  mintToIx,
  createATAIx,
  findATA,
} from '../token-helpers.mjs';
import {
  TOKEN_METADATA_PROGRAM_ID,
  findMetadataPda,
  findEditionPda,
  encodeDataV2,
  createMetadataV3Ix,
  createMasterEditionV3Ix,
  verifyCollectionIx,
  memberUri,
  memberName,
  MAX_NAME_LEN,
  MAX_SYMBOL_LEN,
  MAX_URI_LEN,
} from './metadata-helpers.mjs';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
function checkThrows(label, fn) {
  try { fn(); failed++; console.log(`  FAIL  ${label} — did not throw`); }
  catch { passed++; console.log(`  PASS  ${label}`); }
}

const DUMMY_HASH = '11111111111111111111111111111111'; // 32 zero bytes, valid base58
const kp = () => Keypair.generate();

console.log('== instruction discriminators ==');
{
  const m = kp(), auth = kp(), payer = kp();
  const md = findMetadataPda(m.publicKey);
  const ix = createMetadataV3Ix({
    metadataPda: md, mint: m.publicKey, mintAuthority: auth.publicKey,
    payer: payer.publicKey, updateAuthority: auth.publicKey,
    name: 'Bitcoin Coffee Membership', symbol: 'BCOF', uri: '',
    creators: [{ address: auth.publicKey, verified: true, share: 100 }],
    collection: null,
  });
  check('createMetadataV3 discriminator = 33', ix.data[0] === 33, `got ${ix.data[0]}`);
  check('createMetadataV3 has 7 accounts', ix.keys.length === 7, `got ${ix.keys.length}`);
  check('metadata account is writable', ix.keys[0].isWritable === true);
  check('mint_authority is signer', ix.keys[2].isSigner === true);
  check('payer is signer+writable', ix.keys[3].isSigner && ix.keys[3].isWritable);
  check('program id is Token Metadata', ix.programId.equals(TOKEN_METADATA_PROGRAM_ID));
}
{
  const m = kp(), auth = kp(), payer = kp();
  const md = findMetadataPda(m.publicKey);
  const ed = findEditionPda(m.publicKey);
  const ix = createMasterEditionV3Ix({
    editionPda: ed, mint: m.publicKey, updateAuthority: auth.publicKey,
    mintAuthority: auth.publicKey, payer: payer.publicKey, metadataPda: md,
    tokenProgramId: TOKEN_PROGRAM_ID, maxSupply: 0,
  });
  check('createMasterEditionV3 discriminator = 17', ix.data[0] === 17, `got ${ix.data[0]}`);
  check('createMasterEditionV3 has 9 accounts', ix.keys.length === 9, `got ${ix.keys.length}`);
  check('max_supply=0 encodes as 01 + 8 zero bytes',
    ix.data[1] === 1 && ix.data.slice(2, 10).every((b) => b === 0));
}
{
  const md = findMetadataPda(kp().publicKey);
  const ix = verifyCollectionIx({
    memberMetadataPda: md, collectionAuthority: kp().publicKey, payer: kp().publicKey,
    collectionMint: kp().publicKey, collectionMetadataPda: kp().publicKey,
    collectionEditionPda: kp().publicKey,
  });
  check('verifyCollection discriminator = 18', ix.data[0] === 18, `got ${ix.data[0]}`);
  check('verifyCollection data is exactly 1 byte', ix.data.length === 1);
  check('verifyCollection has 6 accounts', ix.keys.length === 6, `got ${ix.keys.length}`);
  check('collection_authority is signer', ix.keys[1].isSigner === true);
}

console.log('== DataV2 field limits ==');
checkThrows('name > 32 bytes throws', () =>
  encodeDataV2({ name: 'x'.repeat(33), symbol: 'BCOF', uri: '' }));
checkThrows('symbol > 10 bytes throws', () =>
  encodeDataV2({ name: 'ok', symbol: 'x'.repeat(11), uri: '' }));
checkThrows('uri > 200 bytes throws', () =>
  encodeDataV2({ name: 'ok', symbol: 'BCOF', uri: 'x'.repeat(201) }));
checkThrows('creator shares != 100 throws', () =>
  encodeDataV2({ name: 'ok', symbol: 'BCOF', uri: '',
    creators: [{ address: kp().publicKey, verified: true, share: 50 }] }));
{
  const data = encodeDataV2({
    name: 'Bitcoin Coffee Membership', symbol: 'BCOF', uri: '',
    creators: [{ address: kp().publicKey, verified: true, share: 100 }],
    collection: null,
  });
  // name(4+25) + symbol(4+4) + uri(4+0) + fee(2) + creators(1+4+34) + collection(1) + uses(1)
  const expected = (4 + 25) + (4 + 4) + (4 + 0) + 2 + (1 + 4 + 34) + 1 + 1;
  check('collection DataV2 serializes to expected length', data.length === expected,
    `got ${data.length}, want ${expected}`);
}

console.log('== member naming + URIs ==');
{
  const name = memberName(1);
  check('memberName(1) format', name === 'Bitcoin Coffee — Member #001', `got "${name}"`);
  check('memberName fits 32 bytes', Buffer.from(memberName(9999), 'utf8').length <= MAX_NAME_LEN);
  for (const tier of ['Bean', 'Roaster', 'Founder']) {
    const uri = memberUri(tier, 42);
    check(`memberUri(${tier}) <= 200 bytes`, uri.length <= MAX_URI_LEN, `got ${uri.length}`);
    check(`memberUri(${tier}) is a data: URI`, uri.startsWith('data:application/json;base64,'));
    const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
    check(`memberUri(${tier}) carries Tier attribute`,
      json.attributes.some((a) => a.trait_type === 'Tier' && a.value === tier));
  }
  void MAX_SYMBOL_LEN;
}

console.log('== PDA derivation ==');
{
  const m = kp();
  const md1 = findMetadataPda(m.publicKey);
  const md2 = findMetadataPda(m.publicKey);
  check('metadata PDA is deterministic', md1.equals(md2));
  check('metadata PDA is off-curve', !PublicKey.isOnCurve(md1.toBytes()));
  const ed = findEditionPda(m.publicKey);
  check('edition PDA differs from metadata PDA', !ed.equals(md1));
  check('edition PDA is off-curve', !PublicKey.isOnCurve(ed.toBytes()));
}

console.log('== full transaction serialization (offline) ==');
function offlineSerialize(tx, feePayer) {
  tx.feePayer = feePayer;
  tx.recentBlockhash = DUMMY_HASH;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}
{
  // setup tx: create mint + init(0) + collection metadata + master edition
  const issuer = kp(), mintKp = kp();
  const md = findMetadataPda(mintKp.publicKey);
  const ed = findEditionPda(mintKp.publicKey);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer.publicKey, newAccountPubkey: mintKp.publicKey,
      lamports: 1461600, space: MINT_LAYOUT_SPAN, programId: TOKEN_PROGRAM_ID,
    }),
    initializeMintIx(mintKp.publicKey, 0, issuer.publicKey),
    createMetadataV3Ix({
      metadataPda: md, mint: mintKp.publicKey, mintAuthority: issuer.publicKey,
      payer: issuer.publicKey, updateAuthority: issuer.publicKey,
      name: 'Bitcoin Coffee Membership', symbol: 'BCOF', uri: '',
      creators: [{ address: issuer.publicKey, verified: true, share: 100 }],
      collection: null,
    }),
    createMasterEditionV3Ix({
      editionPda: ed, mint: mintKp.publicKey, updateAuthority: issuer.publicKey,
      mintAuthority: issuer.publicKey, payer: issuer.publicKey, metadataPda: md,
      tokenProgramId: TOKEN_PROGRAM_ID, maxSupply: 0,
    })
  );
  const bytes = offlineSerialize(tx, issuer.publicKey);
  check('setup tx serializes', bytes.length > 500, `got ${bytes.length} bytes`);
}
{
  // atomic claim tx: create mint + init(0) + member metadata + ATA + mintTo(1)
  const member = kp(), mintKp = kp();
  const md = findMetadataPda(mintKp.publicKey);
  const ata = findATA(member.publicKey, mintKp.publicKey);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: member.publicKey, newAccountPubkey: mintKp.publicKey,
      lamports: 1461600, space: MINT_LAYOUT_SPAN, programId: TOKEN_PROGRAM_ID,
    }),
    initializeMintIx(mintKp.publicKey, 0, member.publicKey),
    createMetadataV3Ix({
      metadataPda: md, mint: mintKp.publicKey, mintAuthority: member.publicKey,
      payer: member.publicKey, updateAuthority: member.publicKey,
      name: memberName(7), symbol: 'BCOF', uri: memberUri('Roaster', 7),
      creators: [{ address: member.publicKey, verified: true, share: 100 }],
      collection: { verified: false, key: kp().publicKey },
    }),
    createATAIx(member.publicKey, ata, member.publicKey, mintKp.publicKey),
    mintToIx(mintKp.publicKey, ata, member.publicKey, 1)
  );
  const bytes = offlineSerialize(tx, member.publicKey);
  check('atomic claim tx serializes (5 instructions)', bytes.length > 700, `got ${bytes.length} bytes`);
  check('claim tx has exactly 5 instructions', tx.instructions.length === 5);
}
{
  // verify tx
  const issuer = kp();
  const tx = new Transaction().add(
    verifyCollectionIx({
      memberMetadataPda: kp().publicKey, collectionAuthority: issuer.publicKey,
      payer: issuer.publicKey, collectionMint: kp().publicKey,
      collectionMetadataPda: kp().publicKey, collectionEditionPda: kp().publicKey,
    })
  );
  const bytes = offlineSerialize(tx, issuer.publicKey);
  check('verify tx serializes', bytes.length > 200, `got ${bytes.length} bytes`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
