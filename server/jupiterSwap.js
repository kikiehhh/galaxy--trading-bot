import { PublicKey, VersionedTransaction } from '@solana/web3.js';

const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_SLIPPAGE_BPS = 2_000;

function asPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function readJson(response) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Jupiter returned an invalid response (${response.status})`);
  }
  if (!response.ok) throw new Error(body?.error || body?.message || `Jupiter request failed (${response.status})`);
  return body;
}

export function createJupiterSwap({ heliusRpc, wallet, priorityFeeLamports = 100_000, slippageBps = 500 }) {
  const safeSlippageBps = Math.min(MAX_SLIPPAGE_BPS, Math.max(1, asPositiveInteger(slippageBps, 500)));
  const safePriorityFee = Math.min(1_000_000, Math.max(0, asPositiveInteger(priorityFeeLamports, 100_000)));

  async function quote(inputMint, outputMint, amount) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(amount),
      slippageBps: String(safeSlippageBps),
      restrictIntermediateTokens: 'true',
    });
    const response = await fetch(`${JUPITER_BASE}/quote?${params}`);
    return readJson(response);
  }

  async function swap(quoteResponse) {
    const response = await fetch(`${JUPITER_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: safePriorityFee,
            priorityLevel: 'veryHigh',
          },
        },
      }),
    });
    return readJson(response);
  }

  async function submit(swapResponse) {
    if (!swapResponse?.swapTransaction) throw new Error('Jupiter did not return a swap transaction');
    const transaction = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
    transaction.sign([wallet]);
    const result = await heliusRpc('sendTransaction', [
      Buffer.from(transaction.serialize()).toString('base64'),
      { encoding: 'base64', skipPreflight: true, maxRetries: 2 },
    ]);
    if (result.error) throw new Error(result.error.message || String(result.error));
    return result.result;
  }

  async function tokenBalance(mint) {
    const result = await heliusRpc('getTokenAccountsByOwner', [
      wallet.publicKey.toBase58(),
      { mint },
      { encoding: 'jsonParsed' },
    ]);
    if (result.error) throw new Error(result.error.message || String(result.error));
    const account = result.result?.value?.[0];
    const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (!amount) throw new Error('No token balance found for this mint');
    return { rawAmount: amount, decimals: account.account.data.parsed.info.tokenAmount.decimals };
  }

  return {
    async buy(tokenMint, solAmount) {
      new PublicKey(tokenMint);
      const inputAmount = Math.floor(solAmount * 1_000_000_000);
      const quoteResponse = await quote(SOL_MINT, tokenMint, inputAmount);
      const swapResponse = await swap(quoteResponse);
      const signature = await submit(swapResponse);
      return { signature, outAmount: quoteResponse.outAmount, priceImpactPct: quoteResponse.priceImpactPct };
    },
    async sell(tokenMint, tokenAmount) {
      new PublicKey(tokenMint);
      const balance = await tokenBalance(tokenMint);
      const rawAmount = BigInt(Math.floor(tokenAmount * 10 ** balance.decimals));
      const available = BigInt(balance.rawAmount);
      const inputAmount = rawAmount > available ? available : rawAmount;
      if (inputAmount <= 0n) throw new Error('Token balance is zero');
      const quoteResponse = await quote(tokenMint, SOL_MINT, inputAmount);
      const swapResponse = await swap(quoteResponse);
      const signature = await submit(swapResponse);
      return { signature, outAmount: quoteResponse.outAmount };
    },
  };
}
