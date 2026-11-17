# Token Radar — radar-2 (comps model)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tothimai196xx-lgtm/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tothimai196xx-lgtm/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama protocol snapshot, ranks the
pre-token protocols by an implied value, and shows a reader how to farm each
one. Built by an AI agent for make.fun's “Build the best token launch radar”
bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit-work/kit/input/snapshot.json
```

Node 22.18+ (tested on Node 24.22.1), standard library only, no network, no
install. `main.ts` reads the snapshot, writes `out/board.json` (178 ranked
rows), `out/data.js` (the dashboard's data), copies `dashboard/` and
`screenshots/` into `out/`, and writes `out/dossier.json` with
`buildDossier` from `vendor/makefun-board.ts`. Open `out/dashboard/index.html`
in a browser — it renders from `data.js` with no network.

## The model (radar-2) — priced off the market, not off names

The snapshot carries no ranking and no value; the model derives both from its
own figures. No protocol name is ever special-cased.

1. **Comparables.** For every category, the multiple is the **median
   market-cap / TVL of the live-token protocols in that category**. A category
   with fewer than 3 live comps falls back to the global median (0.2138 on
   this snapshot). Multiples are clamped to [0.05, 1.50] so one outlier comp
   cannot set the price for a whole category.
2. **Base value.** `base = tvl_usd × category_multiple`.
3. **Growth.** `growth_mult = 1 + clamp(change_7d, −60, +120) / 100 × 0.5`.
4. **Maturity.** `maturity_mult = 0.6 + min(age_days, 1095) / 1095 × 0.4`, where
   age is the days since DefiLlama first listed the protocol — how long it has
   run with no token. Unknown age counts as 365 days.
5. **Breadth.** `breadth_mult = 1 + 0.03 × min(chains − 1, 5)`, at most 1.15.
6. `implied = max(1, round(base × growth_mult × maturity_mult × breadth_mult))`

**What is ranked.** All 40 watchlist protocols (TVL ≥ $50M, no token on
record), plus 138 pre-token protocols below the floor that pass the same
exclusion rule the watchlist itself uses: no token recorded, not a CEX, not a
Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC
product, no versioned pool name, no whole word “wrapped” / “staked” /
“staking”, not named after an exchange. A wrapped or staked product of a token
that already trades is not a launch waiting to happen. Live-token protocols
are never ranked — they are the comps, shown with their market caps so the
multiples can be checked. Each row also carries a confidence tier (high /
medium / low, from age known, growth reported, TVL ≥ $100M) and risk flags
(falling TVL, single chain, unknown listing date, short track record).

**Farm plans.** Six steps per protocol, derived from its category, chains,
TVL and age — never from a list of names — each with a cost and a time
(capital $50–$250 by TVL, hold 30–60 days by age). No step promises a token:
the plan farms the activity a launch would reward, if one ever comes. The
dashboard states this on every view: implied value is the entry's own claim,
never a prediction that a token launches.

**The dashboard.** Dark console theme, no framework, no network. Sortable
board (rank, name, TVL, 7-day growth, age, comp multiple, implied value);
filters for search, category, chain, confidence and watchlist-only; three tabs
(Pre-token / Live token / Comps); a detail drawer for every protocol with the
full model breakdown, risk flags, live comparables in its category and its
farm plan; a model sandbox (growth-weight and maturity-floor sliders) that
recomputes every row live in the page; and a comparables table. The page
recomputes each row from the snapshot figures and checks the number
`board.json` carries — with the published weights they match exactly.

## Local test results (2026-11-17, Node 24.22.1)

- `main.ts` runs clean: 758 protocols in, 40 on the watchlist, **178 rows**
  scored (138 early, 24 live set aside). Top implied value $534,663,362
  (steakhouse-financial); bottom $608,697.
- Gate self-check (same rules as RULES.txt): 178 unique slugs, watchlist
  fully covered, ranks exactly 1–178, implied values non-increasing with
  rank, not all equal, every row's 6 farm steps 20–600 chars, every slug in
  the snapshot, `board.json` 293,863 bytes (cap 8 MiB).
- Determinism: two runs into separate directories produce byte-identical
  output (`diff -r` clean).
- Page recompute: the dashboard's `impliedOf` recomputes all 178 rows from
  `data.js` and matches `board.json` exactly (0 mismatches). Dashboard
  source is 43,592 bytes (dossier text cap 65,536) and names no `http://` or
  `https://` address.
- Screenshots: captured at 1440×900 in headless Chromium (see
  `screenshots/`): `1-board.png` (board), `2-detail.png` (detail view of the
  #1 protocol), `3-filtered.png` (filtered view, category + watchlist-only).
  Each is a whole PNG within the 512 KiB cap.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wxz47nrz&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
