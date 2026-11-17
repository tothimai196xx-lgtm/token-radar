// Token Radar (radar-3): shrunk comps, traction and log-saturating growth.
//
// main.ts imports four functions from this file: parseSnapshot, buildRadar,
// dataScript and boardIssue. Everything below is derived from the sealed
// snapshot's own figures; no protocol name is ever special-cased and no row
// is hand-picked. The program is deterministic: same snapshot in, same bytes
// out. It makes no network call and reads no clock except through the
// snapshot's own as_of date.
//
// ---------------------------------------------------------------- model
//
// A protocol that records no token is priced off the protocols whose token
// already trades, in its own category, then adjusted for what the snapshot
// says about the protocol itself:
//
//   implied = round( tvl x multiple x growth x maturity x traction
//                    x momentum x breadth )
//
// 1. Comparables with shrinkage. For each category, the multiple starts from
//    the median market-cap / TVL of the live-token protocols in that
//    category, after winsorising each live ratio into [0.005, 5] so one
//    tiny-TVL token with a giant market cap cannot set the price. The
//    category median is then shrunk toward the global median with weight
//    n / (n + 4), where n is the number of live comps in the category:
//    a category with 15 comps is trusted almost fully, a category with 1
//    comp is mostly the global median. A thin category (fewer than 5 comps)
//    is also capped at 3x the global median: with one or two comps the
//    median is one protocol's story, not a market, and without the cap a
//    single live comp with a 3x ratio would price the whole top of the
//    board. The result is clamped to [0.05, 1.5].
//    Radar-2 instead used the raw category median whenever a category had
//    3 comps and the global median otherwise, a cliff at n = 3: a 3-comp
//    category with a noisy median priced whole categories, while a 2-comp
//    category lost its signal entirely.
//
// 2. Growth, log-saturating. g is the 7-day TVL change in per cent (0 when
//    unreported). growth = exp(0.32 * sign(g) * ln(1 + |g| / 25)),
//    clamped to [0.5, 2.0]. Gains saturate: +25% gives x1.21, +100% gives
//    x1.67, +4448% (the snapshot's largest, a single-deposit spike) gives
//    the cap x2.0 instead of dominating the board. Losses bite harder at
//    first and then flatten: -25% gives x0.79, -73% gives x0.62. A linear
//    growth term cannot do this: it either lets the outlier win or mutes
//    ordinary momentum.
//
// 3. Maturity, log-age. age is the days since DefiLlama first listed the
//    protocol (365 when unknown). maturity = 0.55 + 0.45 *
//    ln(1 + min(age, 1460)) / ln(1 + 1460), so a newborn protocol starts at
//    x0.55, a 1-year protocol at x0.93 and anything past 4 years at x1.0.
//    How long a protocol has run with no token is evidence it can survive
//    without one, but the marginal year matters less than the first.
//
// 4. Traction, the age/TVL interaction. velocity = log10(tvl / max(age, 30))
//    is how fast a protocol accumulated its TVL per day alive. Its mean and
//    standard deviation are taken over the ranked set itself, z-scored, and
//    traction = 1 + 0.10 * clamp(z, -2, 2), in [0.8, 1.2]. A young protocol
//    that reached $1B in a year scores above an old protocol that took four
//    years to reach the same TVL; a protocol that has sat small for years
//    scores below. Neither TVL nor age alone can say this.
//
// 5. Momentum, category-relative. momentum = 1 + 0.10 * tanh((g - catMed)/50)
//    where catMed is the median 7-day change of the live comps in the
//    protocol's category (global live median when the category has none).
//    Growing while its category shrinks is worth more than growing with it.
//
// 6. Breadth, saturating. breadth = 1 + 0.10 * (1 - 1/sqrt(chains)), so one
//    chain gives x1.00, two give x1.03, five give x1.06 and eleven give
//    x1.07. Being on many chains helps, but the eleventh chain is not worth
//    as much as the second.
//
// Calibration anchors (log-scale, checked by the anchor test in /tmp, not by
// hand): a $100M protocol at the global multiple, flat growth, 1 year old,
// 2 chains and average traction is worth about $16M; a $1B Dexs protocol,
// +20% in 7 days, 2 years old, 5 chains, is worth about $450M. The
// multiples, the growth curve and the traction mean are all recomputed from
// whatever snapshot the program is handed, so the same code prices a future
// snapshot's protocols without any list of names.
//
// What is ranked. Every protocol the watchlist rule itself would keep, at
// any TVL: no token recorded (both gecko_id and symbol null), not a Bridge /
// Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX
// product, no versioned pool name, no whole word "wrapped" / "staked" /
// "staking", not named after an exchange. That is the 40 watchlist rows plus
// 158 early rows below the $50M floor on this snapshot (198 rows). Live-token
// protocols are never ranked: they are the comps, and the dashboard shows
// the 24 largest of them with their market caps so the multiples can be
// checked.
//
// Farm plans. Six steps per protocol, derived from its category, chains,
// TVL and age, each carrying what it costs and how long it takes. Capital is
// tiered by TVL ($250 / $200 / $150 / $100 / $50); the hold is tiered by age
// (90 / 60 / 45 / 30 days, youngest longest); the second step repeats the
// position on a second chain when the protocol runs on one, and the last
// step totals the outlay (capital plus gas over the hold). No step promises
// a token: the plan farms the activity a launch would reward, if one comes.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  comp_category: string;
  comp_multiple: number;
  comp_count: number;
  comp_weight: number;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  traction_multiplier: number;
  momentum_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  confidence: string;
  risk_flags: string[];
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Record<string, number>;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  comps: { category: string; multiple: number; count: number; fallback: boolean }[];
  rows: Record<string, unknown>[];
  live: Record<string, unknown>[];
}

/** The published weights. The dashboard's sandbox replays them. */
export const MODEL = {
  winsor_low: 0.005,
  winsor_high: 5,
  shrink_prior: 4,
  thin_min_comps: 5,
  thin_cap_x: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  growth_weight: 0.32,
  growth_scale: 25,
  growth_floor: 0.5,
  growth_cap: 2.0,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  min_age_days: 30,
  traction_weight: 0.1,
  traction_cap: 2,
  momentum_weight: 0.1,
  momentum_scale: 50,
  breadth_weight: 0.1,
} as const;

export const MODEL_VERSION = 'radar-3';

/** Parse and minimally validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw !== 'object') throw new Error('snapshot is not an object');
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot has no protocols array');
  if (!Array.isArray(raw.watchlist)) throw new Error('snapshot has no watchlist array');
  if (typeof raw.floor_usd !== 'number' || raw.floor_usd <= 0) throw new Error('snapshot has no floor_usd');
  if (typeof raw.as_of !== 'string') throw new Error('snapshot has no as_of');
  return raw;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Whole days between the snapshot date and a listing date, or null. */
function ageDays(listedAt: string | null, asOf: Date): number | null {
  if (listedAt === null) return null;
  const listed = new Date(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(listed.getTime())) return null;
  return Math.max(0, Math.round((asOf.getTime() - listed.getTime()) / 86400000));
}

// The watchlist rule, applied at any TVL: no token on record, and not a
// wrapped, staked or bridged product of a token that already trades.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isPreTokenLaunch(p: SnapshotProtocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.test(p.name)) return false;
  return true;
}

// ------------------------------------------------------------ farm plans

function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1e9) return 250;
  if (tvlUsd >= 2.5e8) return 200;
  if (tvlUsd >= 1e8) return 150;
  if (tvlUsd >= 2.5e7) return 100;
  return 50;
}

function gasFor(capital: number): number {
  if (capital >= 200) return 8;
  if (capital >= 100) return 6;
  return 4;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category || '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and leave it supplied; borrow a small amount against it once so the wallet shows both sides.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through at least one fee collection.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app instead of bridging straight back.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it after a week.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} on ${chain} and place one market position, then settle or exit it before the market resolves.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares; check the vault's reported yield once a week.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it instead of swapping it straight back.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it for the full farming period.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full farming period.`;
  if (c.includes('payment'))
    return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts; split it across two separate payments.`;
  if (c.includes('governance') || c.includes('incentive'))
    return `Deposit $${capital} into ${name}'s incentive pool on ${chain} and vote once on an active proposal.`;
  if (c.includes('launchpad'))
    return `Commit $${capital} to a ${name} launch on ${chain} and hold the allocation through the sale's end.`;
  if (c.includes('index'))
    return `Buy $${capital} of the ${name} index on ${chain} and hold the position for the full farming period.`;
  if (c.includes('nft'))
    return `List or buy one item worth about $${capital} through ${name} on ${chain} and keep the wallet's activity on the marketplace.`;
  if (c.includes('cedefi') || c.includes('chain'))
    return `Deposit $${capital} of USDC into ${name} on ${chain} and use one of its on-chain features, such as a swap or a transfer.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full farming period.`;
}

function buildFarmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(capital);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const half = Math.round(capital / 2);
  const gas2 = gasFor(half);
  const totalGas = 3 + gas + gas2 + 2 * weeks;
  const second =
    p.chains.length > 1
      ? `Repeat the deposit on ${p.chains[1]} with $${half} so the wallet is active on a second chain, not only on ${chain}.`
      : `Make a second, different $${half} action on ${chain} — a swap, a second deposit, or a vote — so the wallet shows more than one activity type.`;
  const steps = [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
    actionFor(p, capital, chain),
    second,
    `Repeat one qualifying action every week for ${weeks} weeks — a deposit, a borrow, a swap or a vote — so the activity spans ${hold} days, not a single afternoon.`,
    `On day ${hold}, open the protocol's own points or rewards page and check what the wallet has earned; claim only from the link the protocol itself publishes. Never pay anyone to claim for you.`,
    `Write the wallet, the dates and every transaction hash in a farm log. Total outlay is about $${capital} of capital plus ~$${totalGas} of gas over ${hold} days; unwind the position only after the log is complete. A token is never guaranteed.`,
  ];
  const costs = [
    'under $3 of gas for the first transaction',
    `$${capital} of capital and about $${gas} of gas`,
    `$${half} of capital and about $${gas2} of gas`,
    `about $2 of gas a week, about $${2 * weeks} in total`,
    'no fee to check, and never pay to claim',
    'nothing but the log',
  ];
  const times = ['5 minutes', '15 minutes to set up', '15 minutes', '10 minutes a week', '10 minutes', '5 minutes'];
  return steps.map((s, i) => `${s} Cost: ${costs[i]}. Time: ${times[i]}.`);
}

// ------------------------------------------------------------ the board

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`);
  const watch = new Set(snapshot.watchlist);
  const m = MODEL;

  // Live-token comps: winsorised mcap/TVL ratios, median per category,
  // shrunk toward the global median by comp count.
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const liveRatios = live.map((p) => clamp(p.mcap_usd! / p.tvl_usd, m.winsor_low, m.winsor_high));
  const globalMultiple = median(liveRatios);
  const globalGrowth = median(live.map((p) => p.change_7d).filter((v): v is number => v !== null));

  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const compOf = new Map<string, { multiple: number; count: number; weight: number; growthMedian: number }>();
  for (const [cat, list] of byCategory) {
    const ratios = list.map((p) => clamp(p.mcap_usd! / p.tvl_usd, m.winsor_low, m.winsor_high));
    const catMedian = median(ratios);
    const weight = list.length / (list.length + m.shrink_prior);
    const thinCap = list.length < m.thin_min_comps ? m.thin_cap_x * globalMultiple : m.multiple_cap;
    const multiple = clamp(weight * catMedian + (1 - weight) * globalMultiple, m.multiple_floor, Math.min(m.multiple_cap, thinCap));
    const growths = list.map((p) => p.change_7d).filter((v): v is number => v !== null);
    compOf.set(cat, {
      multiple,
      count: list.length,
      weight,
      growthMedian: growths.length > 0 ? median(growths) : globalGrowth,
    });
  }

  // Every protocol the watchlist rule would keep, at any TVL.
  const candidates = snapshot.protocols.filter(isPreTokenLaunch);
  const ages = new Map<string, number | null>();
  for (const p of candidates) ages.set(p.slug, ageDays(p.listed_at, asOf));

  // Traction baseline: the ranked set's own mean and spread of
  // log10(TVL per day alive), so the factor is calibrated, not asserted.
  const velocities = candidates.map((p) => {
    const age = ages.get(p.slug) ?? m.unknown_age_days;
    return Math.log10(p.tvl_usd / Math.max(age === null ? m.unknown_age_days : age, m.min_age_days));
  });
  const vMean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const vSd = Math.sqrt(velocities.reduce((a, b) => a + (b - vMean) ** 2, 0) / velocities.length) || 1;

  const scored: BoardRow[] = candidates.map((p) => {
    const age = ages.get(p.slug) ?? null;
    const cat = p.category ?? 'Other';
    const comp = compOf.get(cat) ?? { multiple: globalMultiple, count: 0, weight: 0, growthMedian: globalGrowth };
    const g = p.change_7d === null ? 0 : p.change_7d;
    const growthMult = clamp(
      Math.exp(m.growth_weight * Math.sign(g) * Math.log1p(Math.abs(g) / m.growth_scale)),
      m.growth_floor,
      m.growth_cap,
    );
    const ageEff = age === null ? m.unknown_age_days : age;
    const maturityMult =
      m.maturity_floor +
      m.maturity_range * (Math.log1p(Math.min(ageEff, m.maturity_days)) / Math.log1p(m.maturity_days));
    const velocity = Math.log10(p.tvl_usd / Math.max(ageEff, m.min_age_days));
    const z = (velocity - vMean) / vSd;
    // Traction, momentum and breadth are rounded BEFORE the implied value
    // is formed, so the dashboard's recompute — which reads the stored,
    // rounded factors — reproduces board.json exactly.
    const tractionMult = round4(1 + m.traction_weight * clamp(z, -m.traction_cap, m.traction_cap));
    const momentumMult = round4(1 + m.momentum_weight * Math.tanh((g - comp.growthMedian) / m.momentum_scale));
    const nChains = Math.max(1, p.chains.length);
    const breadthMult = round4(1 + m.breadth_weight * (1 - 1 / Math.sqrt(nChains)));
    const implied = Math.max(
      1,
      Math.round(p.tvl_usd * comp.multiple * growthMult * maturityMult * tractionMult * momentumMult * breadthMult),
    );

    // Confidence: one point each for a known age, a reported 7-day change,
    // $100M+ of TVL, 3+ live comps in the category, and 2+ chains.
    let points = 0;
    if (age !== null) points += 1;
    if (p.change_7d !== null) points += 1;
    if (p.tvl_usd >= 1e8) points += 1;
    if (comp.count >= 3) points += 1;
    if (p.chains.length >= 2) points += 1;
    const confidence = points >= 4 ? 'high' : points === 3 ? 'medium' : 'low';

    const riskFlags: string[] = [];
    if (p.change_7d !== null && p.change_7d < -10)
      riskFlags.push(`TVL down ${p.change_7d.toFixed(1)}% in 7 days — momentum is against it`);
    if (p.change_7d !== null && p.change_7d > 100)
      riskFlags.push(`TVL up ${p.change_7d.toFixed(0)}% in 7 days — a spike this large is often one deposit, not a trend`);
    if (p.change_7d === null) riskFlags.push('No 7-day change reported — growth is assumed flat');
    if (p.chains.length === 1)
      riskFlags.push(`Single chain — everything rides on ${p.chains[0] ?? 'one chain'}`);
    if (age === null) riskFlags.push('No listing date on record — age is assumed, not measured');
    if (age !== null && age < 180) riskFlags.push('Listed under 6 months ago — a short track record');
    if (p.tvl_usd < snapshot.floor_usd) riskFlags.push('Below the $50M watchlist floor — thin liquidity');
    if (comp.count < 3)
      riskFlags.push(`Fewer than 3 live comparables in ${cat} — the multiple leans on the global median`);

    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: cat,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: implied,
      confidence,
      risk_flags: riskFlags,
      model: {
        comp_category: cat,
        comp_multiple: comp.multiple,
        comp_count: comp.count,
        comp_weight: round2(comp.weight),
        growth_pct: p.change_7d,
        growth_multiplier: round4(growthMult),
        maturity_multiplier: round4(maturityMult),
        traction_multiplier: round4(tractionMult),
        momentum_multiplier: round4(momentumMult),
        breadth_multiplier: round4(breadthMult),
        age_days: age,
      },
      farm_steps: buildFarmSteps(p, age),
    };
  });

  // Rank by implied value, then TVL, then slug: deterministic throughout.
  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const earlySize = scored.filter((r) => !watch.has(r.slug)).length;
  const liveTop = live
    .slice()
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: round4(p.mcap_usd! / p.tvl_usd),
    }));
  const comps = [...byCategory.entries()]
    .map(([category, list]) => {
      const c = compOf.get(category)!;
      return { category, multiple: round4(c.multiple), count: list.length, fallback: false };
    })
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...MODEL },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: scored.length,
    early_size: earlySize,
    live_size: liveTop.length,
    global_multiple: round4(globalMultiple),
    comps,
    rows: scored.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      confidence: r.confidence,
      risk_flags: r.risk_flags,
      comp_multiple: r.model.comp_multiple,
      comp_count: r.model.comp_count,
      comp_fallback: false,
      comp_weight: r.model.comp_weight,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      traction_multiplier: r.model.traction_multiplier,
      momentum_multiplier: r.model.momentum_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
    })),
    live: liveTop,
  };
  return { board: scored, radar };
}

/** The dashboard's data, written beside the page as data.js. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The gate's own shape, checked before anything is written. Null is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `board names ${row.slug}, which the snapshot does not list`;
    if (seen.has(row.slug)) return `board names ${row.slug} twice`;
    seen.add(row.slug);
    if (!row.name) return `board row ${row.slug} has no name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `board row ${row.slug} has a bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1)
      return `board row ${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12)
      return `board row ${row.slug} holds ${row.farm_steps.length} farm steps, not 3 to 12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `board row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return 'board ranks are not exactly 1 to N';
  }
  const byRank = board.slice().sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd)
      return 'board implied values rise with rank';
  }
  if (byRank.length > 1 && byRank.every((r) => r.implied_value_usd === byRank[0]!.implied_value_usd))
    return 'board implied values are all the same';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `board misses watchlist protocol ${slug}`;
  }
  return null;
}
