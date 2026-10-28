import { VersionedTransaction } from '@solana/web3.js';

const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JITO_TIP_LAMPORTS = 1_000_000;
const SLIPPAGE_BPS = 2000;
const COMPUTE_UNIT_LIMIT = 200_000;
const BLOCKHASH_CACHE_MS = 10_000;

let cachedBlockhash = null;
let cachedBlockhashAt = 0;

export function createTurboBuyBot({ heliusRpc, wallet }) {
  async function getBlockhash() {
    if (cachedBlockhash && Date.now() - cachedBlockhashAt < BLOCKHASH_CACHE_MS) {
      return cachedBlockhash;
    }
    const res = await heliusRpc('getLatestBlockhash', [{ commitment: 'processed' }]);
    if (res.error || !res.result?.value?.blockhash) throw new Error('Failed to fetch blockhash');
    cachedBlockhash = res.result.value.blockhash;
    cachedBlockhashAt = Date.now();
    return cachedBlockhash;
  }

  async function getQuote(tokenMint, solAmount) {
    const lamports = Math.floor(solAmount * 1_000_000_000);
    const params = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: String(lamports),
      slippageBps: String(SLIPPAGE_BPS),
      dynamicSlippage: 'true',
      swapMode: 'ExactIn',
    });
    const res = await fetch(`${JUPITER_QUOTE_URL}?${params}`);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`Jupiter quote returned invalid JSON (${res.status})`); }
    if (!res.ok) throw new Error(body?.error || body?.message || `Quote failed (${res.status})`);
    return body;
  }

  async function getSwapTx(quoteResponse) {
    const res = await fetch(JUPITER_SWAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: { jitoTipLamports: JITO_TIP_LAMPORTS },
        computeUnitPriceMicroLamports: 'auto',
        dynamicComputeUnitLimit: true,
        maxPriorityFeeLamports: 5_000_000,
      }),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`Jupiter swap returned invalid JSON (${res.status})`); }
    if (!res.ok) throw new Error(body?.error || body?.message || `Swap failed (${res.status})`);
    if (!body.swapTransaction) throw new Error('Jupiter did not return swapTransaction');
    return body;
  }

  async function turboBuy(tokenMint, solAmount) {
    if (!wallet) throw new Error('Trading wallet not configured');
    if (!heliusRpc) throw new Error('RPC not configured');
    const t0 = performance.now();

    const quote = await getQuote(tokenMint, solAmount);
    const swap = await getSwapTx(quote);

    const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    tx.sign([wallet]);

    const sendRes = await heliusRpc('sendTransaction', [
      Buffer.from(tx.serialize()).toString('base64'),
      { encoding: 'base64', skipPreflight: true, maxRetries: 0, preflightCommitment: 'processed' },
    ]);
    if (sendRes.error) throw new Error(sendRes.error.message || String(sendRes.error));
    const signature = sendRes.result;

    const latencyMs = Math.round(performance.now() - t0);

    // Background confirmation — fire and forget
    void heliusRpc('confirmTransaction', [signature, { commitment: 'confirmed' }]).catch(() => {});

    return {
      ok: true,
      signature,
      latencyMs,
      outAmount: quote.outAmount || '0',
      priceImpactPct: quote.priceImpactPct || '0',
    };
  }

  return { turboBuy, getQuote, getBlockhash };
}
