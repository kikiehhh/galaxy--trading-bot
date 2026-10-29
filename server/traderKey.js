import { Keypair } from '@solana/web3.js';
import bs58Pkg from 'bs58';

const bs58 = bs58Pkg.default || bs58Pkg;
const SECRET_KEY_BYTES = 64;

function invalidKeyError(length) {
  return new Error(
    `TRADER_PRIVATE_KEY invalid: length is ${length}, expected 87-88 for base58 or 64 for array. ` +
    "Please check your .env, make sure it's 1 line with no spaces"
  );
}

export function parseTraderPrivateKey(raw) {
  let input = String(raw ?? '').trim();
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    input = input.slice(1, -1).trim();
  }

  if (input.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(input.replace(/\s+/g, ''));
    } catch {
      throw invalidKeyError(input.length);
    }
    const valid =
      Array.isArray(parsed) &&
      parsed.length === SECRET_KEY_BYTES &&
      parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);
    if (!valid) throw invalidKeyError(Array.isArray(parsed) ? parsed.length : input.length);
    return Uint8Array.from(parsed);
  }

  if (input.length < 87 || input.length > 88) throw invalidKeyError(input.length);
  let decoded;
  try {
    decoded = bs58.decode(input);
  } catch {
    throw invalidKeyError(input.length);
  }
  if (decoded.length !== SECRET_KEY_BYTES) throw invalidKeyError(decoded.length);
  return decoded;
}

export async function keypairFromTraderKey(raw) {
  const bytes = parseTraderPrivateKey(raw);
  try {
    return await Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error(`TRADER_PRIVATE_KEY invalid: key bytes could not be loaded (${e.message}). Please check your .env`);
  }
}
