/**
 * Hand-rolled Metaplex Token Metadata instruction encoders (no umi/mpl deps).
 * Program: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s (same address on devnet).
 * Only @solana/web3.js is required.
 *
 * Discriminators used (all high-confidence, widely-used instructions):
 *   CreateMetadataAccountV3 = 33
 *   CreateMasterEditionV3   = 17
 *   VerifyCollection        = 18   (legacy; correct for an UNSIZED collection)
 *
 * The collection built here is deliberately UNSIZED (collection_details: None),
 * so the legacy VerifyCollection instruction applies. Member NFTs carry
 * collection: { verified: false, key } at mint time; the collection update
 * authority flips them to verified with one VerifyCollection call each.
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

// Metaplex on-chain string limits
export const MAX_NAME_LEN = 32;
export const MAX_SYMBOL_LEN = 10;
export const MAX_URI_LEN = 200;

function u8(n) {
  const b = Buffer.alloc(1);
  b.writeUInt8(n);
  return b;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** Borsh string: u32 LE length prefix + UTF-8 bytes. Throws if over maxLen. */
export function borshStr(s, maxLen, field) {
  const bytes = Buffer.from(s, 'utf8');
  if (bytes.length > maxLen) {
    throw new Error(`${field} too long: ${bytes.length} bytes > max ${maxLen}`);
  }
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

/** Derive the Metaplex metadata PDA for a mint. */
export function findMetadataPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/** Derive the master-edition PDA for a mint. */
export function findEditionPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from('edition'),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Serialize Metaplex DataV2.
 * creators: [{ address: PublicKey, verified: bool, share: 0-100 }]
 * collection: null | { verified: bool, key: PublicKey }
 * (uses: always None; collection_details handled by caller, not part of DataV2)
 */
export function encodeDataV2({ name, symbol, uri, sellerFeeBps = 0, creators = [], collection = null }) {
  const parts = [
    borshStr(name, MAX_NAME_LEN, 'name'),
    borshStr(symbol, MAX_SYMBOL_LEN, 'symbol'),
    borshStr(uri, MAX_URI_LEN, 'uri'),
    u16(sellerFeeBps),
  ];

  // creators: Option<Vec<Creator>>
  if (creators.length === 0) {
    parts.push(Buffer.from([0]));
  } else {
    const totalShare = creators.reduce((a, c) => a + c.share, 0);
    if (totalShare !== 100) throw new Error(`creator shares must sum to 100, got ${totalShare}`);
    parts.push(Buffer.from([1]));
    const n = Buffer.alloc(4);
    n.writeUInt32LE(creators.length);
    parts.push(n);
    for (const c of creators) {
      parts.push(
        Buffer.concat([c.address.toBuffer(), Buffer.from([c.verified ? 1 : 0, c.share])])
      );
    }
  }

  // collection: Option<Collection { verified: u8, key: Pubkey }>
  if (collection === null) {
    parts.push(Buffer.from([0]));
  } else {
    parts.push(
      Buffer.concat([Buffer.from([1, collection.verified ? 1 : 0]), collection.key.toBuffer()])
    );
  }

  // uses: None
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * CreateMetadataAccountV3.
 * Accounts: [metadata(w), mint, mint_authority(s), payer(s,w), update_authority,
 *            system_program, rent]
 */
export function createMetadataV3Ix({
  metadataPda,
  mint,
  mintAuthority,
  payer,
  updateAuthority,
  name,
  symbol,
  uri,
  sellerFeeBps = 0,
  creators = [],
  collection = null,
  isMutable = true,
}) {
  const args = Buffer.concat([
    encodeDataV2({ name, symbol, uri, sellerFeeBps, creators, collection }),
    Buffer.from([isMutable ? 1 : 0]),
    Buffer.from([0]), // collection_details: None -> unsized collection
  ]);
  const data = Buffer.concat([u8(33), args]);
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * CreateMasterEditionV3 (needed on the collection parent for VerifyCollection).
 * Accounts: [edition(w), mint(w), update_authority(s), mint_authority(s),
 *            payer(s,w), metadata, token_program, system_program, rent]
 * maxSupply: null (unlimited) or a number. For a collection parent, 0 is standard
 * (no prints allowed off the collection NFT itself).
 */
export function createMasterEditionV3Ix({
  editionPda,
  mint,
  updateAuthority,
  mintAuthority,
  payer,
  metadataPda,
  tokenProgramId,
  maxSupply = 0,
}) {
  const args =
    maxSupply === null
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), u64(maxSupply)]);
  const data = Buffer.concat([u8(17), args]);
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: editionPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: updateAuthority, isSigner: true, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: metadataPda, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * VerifyCollection (legacy, discriminator 18) — correct for an UNSIZED collection.
 * Flips a member NFT's collection pointer to verified: true.
 * Must be signed by the collection update authority.
 * Accounts: [metadata(w), collection_authority(s), payer(s,w), collection_mint,
 *            collection_metadata(w), collection_edition]
 */
export function verifyCollectionIx({
  memberMetadataPda,
  collectionAuthority,
  payer,
  collectionMint,
  collectionMetadataPda,
  collectionEditionPda,
}) {
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: memberMetadataPda, isSigner: false, isWritable: true },
      { pubkey: collectionAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: collectionMint, isSigner: false, isWritable: false },
      { pubkey: collectionMetadataPda, isSigner: false, isWritable: true },
      { pubkey: collectionEditionPda, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([18]),
  });
}

/**
 * Build the on-chain attributes URI for a membership NFT.
 * Uses a data: URI so attributes live fully on-chain (no IPFS/Arweave needed
 * for the demo). Kept small to respect the 200-byte Metaplex URI limit.
 */
export function memberUri(tier, cardNumber) {
  const json = JSON.stringify({
    attributes: [
      { trait_type: 'Tier', value: tier },
      { trait_type: 'Card Number', value: String(cardNumber) },
    ],
  });
  const uri = 'data:application/json;base64,' + Buffer.from(json, 'utf8').toString('base64');
  if (uri.length > MAX_URI_LEN) {
    throw new Error(`member URI too long: ${uri.length} > ${MAX_URI_LEN}`);
  }
  return uri;
}

/** Member NFT display name, e.g. "Bitcoin Coffee — Member #001". Max 32 bytes. */
export function memberName(cardNumber) {
  const n = String(cardNumber).padStart(3, '0');
  return `Bitcoin Coffee — Member #${n}`;
}
