'use strict';
/**
 * Relayer. Chiunque puo' farlo girare (paga solo il gas).
 * Legge dal contratto l'elenco degli operatori approvati (con l'URL dei loro nodi),
 * raccoglie le firme, le ordina per indirizzo e chiama submit().
 *
 *   node relayer.js          invia davvero
 *   node relayer.js --dry    simula soltanto
 *
 * NODES (facoltativo): elenco manuale di URL, utile per test. Se assente si usa
 * l'elenco on-chain.
 * HELPER_ADDRESS + COIN_ADDRESS (con HUB_VERSION=2): il round si pubblica tramite il contratto PublishAndUpdate,
 * che nella stessa transazione chiama updateFor() della coin (es. Solar Sail su Base).
 * HUB_VERSION=2: hub OpsikomV2. Ogni report porta observedAt; si usano solo i report con lo stesso
 * observedAt (quello condiviso dal maggior numero di nodi) e lo si passa a submit().
 */
const { HUB_ABI, HUB_ABI_V2, hubVersion, feedIdOf, typedData, typedDataV2, need, ethers } = require('./lib');

const DRY = process.argv.includes('--dry');
const provider = new ethers.JsonRpcProvider(need('RPC_URL'));
const wallet = new ethers.Wallet(need('RELAYER_KEY'), provider);
const hubAddress = ethers.getAddress(need('HUB_ADDRESS'));
const VERSION = hubVersion(process.env.HUB_VERSION);
const hub = new ethers.Contract(hubAddress, VERSION === 2 ? HUB_ABI_V2 : HUB_ABI, wallet);
const FEED = (process.env.FEED || 'GLOBAL_TEMP').toUpperCase();
const MANUAL = (process.env.NODES || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

function urlOk(u) {
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; }
}

async function main() {
  const feedId = feedIdOf(FEED);
  const feed = await hub.getFeed(feedId);
  if (!feed.exists) throw new Error('feed non esiste');
  const expectedRound = feed.latestRound + 1n;
  const chainId = (await provider.getNetwork()).chainId;
  const nOps = await hub.operatorCount(feedId);

  if (feed.latestRound > 0n) {
    const next = Number(VERSION === 2 ? feed.lastPublishedAt : feed.lastUpdate) + Number(feed.minInterval);
    if (Date.now() / 1000 < next) {
      console.log('Troppo presto: prossimo aggiornamento dopo', new Date(next * 1000).toISOString());
      return;
    }
  }

  // Elenco nodi: { url, expected } dove expected e' l'indirizzo atteso (null in modalita' manuale)
  let targets;
  if (MANUAL.length) {
    targets = MANUAL.map((url) => ({ url, expected: null }));
  } else {
    const [addrs, urls] = await hub.getOperators(feedId);
    targets = addrs.map((a, i) => ({ url: String(urls[i]).replace(/\/$/, ''), expected: a }));
  }
  targets = targets.filter((t) => { if (urlOk(t.url)) return true; console.warn('[URL non valido]', t.url); return false; });
  console.log('Nodi da contattare:', targets.length, '| operatori on-chain:', nOps.toString());

  const settled = await Promise.allSettled(
    targets.map(async (t) => {
      const r = await fetch(t.url + '/report/' + FEED, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(t.url + ' -> HTTP ' + r.status);
      return { rep: await r.json(), expected: t.expected };
    })
  );

  const bySigner = new Map();
  for (const s of settled) {
    if (s.status !== 'fulfilled') { console.warn('[nodo scartato]', s.reason.message); continue; }
    const { rep, expected } = s.value;
    try {
      if (BigInt(rep.roundId) !== expectedRound) throw new Error('round diverso');
      if (VERSION === 2 && !(Number.isInteger(rep.observedAt) && rep.observedAt > 0)) throw new Error('observedAt mancante');
      const td = VERSION === 2
        ? typedDataV2(chainId, hubAddress, feedId, expectedRound, BigInt(rep.value), BigInt(rep.observedAt))
        : typedData(chainId, hubAddress, feedId, expectedRound, BigInt(rep.value));
      const signer = ethers.verifyTypedData(td.domain, td.types, td.message, rep.signature);
      if (signer.toLowerCase() !== String(rep.signer).toLowerCase()) throw new Error('firma non corrisponde');
      if (expected && signer.toLowerCase() !== expected.toLowerCase()) throw new Error('firmatario diverso da quello registrato per questo URL');
      if (!(await hub.isOperator(feedId, signer))) throw new Error('non e\' operatore');
      bySigner.set(signer.toLowerCase(), { signer, value: BigInt(rep.value), signature: rep.signature, observedAt: rep.observedAt });
    } catch (e) {
      console.warn('[report scartato]', rep && rep.signer, e.message);
    }
  }

  let valid = [...bySigner.values()];
  let observedAt = null;
  if (VERSION === 2) {
    // tutte le firme di un submit devono avere lo stesso observedAt: si tiene il gruppo piu' numeroso
    const groups = new Map();
    for (const r of valid) groups.set(r.observedAt, (groups.get(r.observedAt) || []).concat(r));
    const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0];
    if (best) { observedAt = best[0]; if (groups.size > 1) console.warn('[observedAt diversi tra i nodi] uso', observedAt); valid = best[1]; }
  }
  const reports = valid.sort((a, b) => (a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1));
  const n = BigInt(reports.length);
  console.log('Report validi:', reports.length, '| quorum:', feed.quorum.toString());
  if (n < BigInt(feed.quorum) || n * 2n <= nOps) {
    console.log('Quorum/maggioranza non raggiunti: niente invio.');
    return;
  }

  const values = reports.map((r) => r.value);
  const sigs = reports.map((r) => r.signature);
  const args = VERSION === 2 ? [feedId, values, observedAt, sigs] : [feedId, values, sigs];
  // HELPER_ADDRESS + COIN_ADDRESS (solo hub V2): pubblica e aggiorna la coin nella stessa transazione
  const helper = VERSION === 2 && process.env.HELPER_ADDRESS && process.env.COIN_ADDRESS
    ? new ethers.Contract(ethers.getAddress(process.env.HELPER_ADDRESS),
        ['function run(address hub, bytes32 feedId, int256[] values, uint64 observedAt, bytes[] signatures, address coin)'], wallet)
    : null;
  const send = helper ? helper.run : hub.submit;
  const sendArgs = helper ? [hubAddress, ...args, ethers.getAddress(process.env.COIN_ADDRESS)] : args;
  await send.staticCall(...sendArgs);
  console.log('Simulazione OK. Valori:', values.map(String).join(', ') + (VERSION === 2 ? ' | observedAt ' + new Date(observedAt * 1000).toISOString() : '') +
    (helper ? ' | con aggiornamento della coin ' + process.env.COIN_ADDRESS : ''));
  if (DRY) return;
  // con l'helper la stima del gas basta solo alla pubblicazione: l'aggiornamento della coin (in try/catch) resterebbe
  // senza gas e fallirebbe in silenzio, quindi si fissa un limite ampio
  const tx = await send(...sendArgs, ...(helper ? [{ gasLimit: Number(process.env.HELPER_GAS_LIMIT || 1500000) }] : []));
  console.log('Inviata:', tx.hash);
  await tx.wait();
  console.log('Confermata.');
}

main().catch((e) => { console.error(e); process.exit(1); });
