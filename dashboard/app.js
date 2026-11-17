// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own inputs and the protocol's farm plan, the live-token
// comps and a model sandbox. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', chain: 'all', confidence: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, gw: 0.5, mf: 0.6 };
  var WATCH = {};
  DATA.rows.forEach(function (r) { WATCH[r.slug] = r.tvl_usd >= DATA.floor_usd; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model in one function: the page recomputes a row from the snapshot figures
  // and checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic. Sandbox weights replace the published
  // ones; with the published weights the recompute must match board.json exactly.
  function impliedOf(row, gw, mf) {
    var m = DATA.model;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = 1 + (growth / 100) * gw;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = mf + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * (1 - mf);
    return Math.max(1, Math.round(row.tvl_usd * row.comp_multiple * growthMult * maturity * row.breadth_multiplier));
  }
  function growthMultOf(row, gw) {
    var m = DATA.model;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    return 1 + (growth / 100) * gw;
  }
  function maturityOf(row, mf) {
    var m = DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    return mf + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * (1 - mf);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased, and no step promises a token.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s incentive pool on " + chain + ' and vote once.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Never pay anyone to claim for you.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. A token is never guaranteed.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('confidence')) state.confidence = params.get('confidence');
    if (params.get('w')) state.watchlistOnly = params.get('w') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.confidence !== 'all') params.set('confidence', state.confidence);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.confidence !== 'all' && r.confidence !== state.confidence) return false;
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).map(function (r) {
      var copy = Object.assign({}, r);
      copy.implied_live = impliedOf(r, state.gw, state.mf);
      return copy;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'comp') { av = a.comp_multiple; bv = b.comp_multiple; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_live; bv = b.implied_live; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  var thead = document.getElementById('thead');
  var tbody = document.getElementById('tbody');
  var caption = document.querySelector('#board-table caption');
  var emptyBox = document.getElementById('empty');
  var countEl = document.getElementById('count');
  var panel = document.getElementById('panel');
  var modelPanel = document.getElementById('model-panel');

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function renderBoard() {
    var list = sortedRows(filteredRows());
    var max = list.length ? list[0].implied_live || 1 : 1;
    thead.textContent = '';
    tbody.textContent = '';
    if (state.tab === 'live') {
      caption.textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are the comparables the pre-token board is priced from.';
      thead.appendChild(el('tr', null,
        el('th', { scope: 'col', text: 'Status' }),
        el('th', { scope: 'col', text: 'Protocol' }),
        el('th', { scope: 'col', text: 'TVL' }),
        el('th', { scope: 'col', text: '7d' }),
        el('th', { scope: 'col', text: 'Market cap' }),
        el('th', { scope: 'col', text: 'Mcap / TVL' }),
        el('th', { scope: 'col', text: 'Token' })));
      DATA.live.forEach(function (r) {
        tbody.appendChild(el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : String(r.mcap_tvl) }),
          el('td', null, el('span', { class: 'status live', text: 'already trades' }))
        ));
      });
      countEl.textContent = DATA.live.length + ' live-token protocols';
      emptyBox.hidden = true;
      return;
    }
    if (state.tab === 'comps') {
      caption.textContent = 'Comparables: the median market-cap / TVL multiple per category, from the live-token protocols. A category with fewer than 3 comps uses the global median.';
      thead.appendChild(el('tr', null,
        el('th', { scope: 'col', text: 'Category' }),
        el('th', { scope: 'col', text: 'Median mcap / TVL' }),
        el('th', { scope: 'col', text: 'Live comps' }),
        el('th', { scope: 'col', text: 'Multiple used' }),
        el('th', { scope: 'col', text: 'Board rows' })));
      DATA.comps.forEach(function (c) {
        var rowsInCat = DATA.rows.filter(function (r) { return (r.category || 'Other') === c.category; }).length;
        tbody.appendChild(el('tr', null,
          el('td', null, el('b', { text: c.category })),
          el('td', { class: 'num', text: String(c.multiple) }),
          el('td', { class: 'num', text: String(c.count) }),
          el('td', { class: 'num', text: c.fallback ? 'global ' + DATA.global_multiple : String(c.multiple) }),
          el('td', { class: 'num', text: String(rowsInCat) })
        ));
      });
      countEl.textContent = DATA.comps.length + ' categories with comps';
      emptyBox.hidden = true;
      return;
    }
    caption.textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.';
    thead.appendChild(el('tr', null,
      sortHeader('rank', 'Rank'),
      sortHeader('name', 'Protocol'),
      sortHeader('tvl', 'TVL'),
      sortHeader('growth', '7d'),
      sortHeader('age', 'Age'),
      sortHeader('comp', 'Comp ×'),
      sortHeader('implied', 'Implied value'),
      el('th', { scope: 'col', text: 'Confidence' }),
      el('th', { scope: 'col', text: 'Token' })));
    if (list.length === 0) {
      emptyBox.hidden = false;
      countEl.textContent = '0 rows shown';
      return;
    }
    emptyBox.hidden = true;
    countEl.textContent = list.length + ' rows shown';
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WATCH[r.slug] ? ' · watchlist' : ' · early') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: Number(r.comp_multiple).toFixed(4) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_live / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_live) })
        )),
        el('td', null, el('span', { class: 'conf ' + r.confidence, text: r.confidence })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
  }

  function renderFacts() {
    var facts = document.getElementById('facts');
    facts.textContent = '';
    var top = DATA.rows[0];
    var items = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)],
      ['Global comp multiple', String(DATA.global_multiple)],
      ['Top implied value', top ? fmtUsd(top.implied_value_usd) + ' · ' + top.name : '—']
    ];
    items.forEach(function (it) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: it[0] }), el('b', { text: it[1] })));
    });
  }

  function renderCompsTable() {
    var tb = document.getElementById('comps-tbody');
    tb.textContent = '';
    DATA.comps.slice(0, 12).forEach(function (c) {
      tb.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.multiple) }),
        el('td', { class: 'num', text: String(c.count) }),
        el('td', { class: 'num', text: c.fallback ? 'global ' + DATA.global_multiple : String(c.multiple) })
      ));
    });
  }

  var detail = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model.growth_weight, DATA.model.maturity_floor);
    var base = Math.round(row.tvl_usd * row.comp_multiple);
    var liveSameCat = DATA.live.filter(function (l) { return (l.category || 'Other') === (row.category || 'Other'); }).slice(0, 3);
    document.getElementById('detail-rank').textContent = 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · watchlist' : ' · early radar');
    document.getElementById('detail-title').textContent = row.name;
    document.getElementById('detail-sub').textContent = (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · confidence ' + row.confidence;
    detailBody.textContent = '';
    detailBody.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — how the number is built' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comp multiple (' + (row.category || 'Other') + ', ' + row.comp_count + ' live comps' + (row.comp_fallback ? ', global fallback' : '') + ')' }), el('b', { class: 'num', text: '× ' + Number(row.comp_multiple).toFixed(4) })),
        el('div', null, el('span', { text: 'Base value (TVL × multiple)' }), el('b', { class: 'num', text: fmtUsd(base) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: '× ' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: '× ' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: '× ' + row.breadth_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and never a prediction that a token launches.' })
    ));
    if (row.risk_flags && row.risk_flags.length) {
      detailBody.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Risk flags' }),
        el('ul', { class: 'flags' }, row.risk_flags.map(function (f) { return el('li', { text: f }); }))
      ));
    }
    if (liveSameCat.length) {
      detailBody.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comparables in ' + (row.category || 'Other') }),
        el('ul', { class: 'comp-list' }, liveSameCat.map(function (l) {
          return el('li', null, el('b', { text: l.name + ' ' }), el('span', { text: 'mcap ' + fmtUsd(l.mcap_usd) + ' · TVL ' + fmtUsd(l.tvl_usd) + ' · mcap/TVL ' + (l.mcap_tvl === null ? 'n/a' : l.mcap_tvl) }));
        }))
      ));
    }
    detailBody.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    detail.hidden = false;
  }
  function closeDetail() {
    state.selected = null;
    detail.hidden = true;
    writeHash();
  }
  document.getElementById('detail-close').addEventListener('click', closeDetail);

  function renderTabs() {
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    document.getElementById('tab-comps').setAttribute('aria-pressed', state.tab === 'comps' ? 'true' : 'false');
    modelPanel.style.display = state.tab === 'pre-token' ? '' : 'none';
  }

  function fillSelects() {
    var catSel = document.getElementById('category');
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    categories.forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    catSel.value = state.category;
    var chainSel = document.getElementById('chain');
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    chains.forEach(function (c) {
      chainSel.appendChild(el('option', { value: c, text: c }));
    });
    chainSel.value = state.chain;
    document.getElementById('confidence').value = state.confidence;
    document.getElementById('q').value = state.q;
    document.getElementById('watchlist-only').checked = state.watchlistOnly;
  }

  function bindControls() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); render(); });
    document.getElementById('confidence').addEventListener('change', function (e) { state.confidence = e.target.value; writeHash(); render(); });
    document.getElementById('watchlist-only').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; writeHash(); render(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); render(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
    document.getElementById('tab-comps').addEventListener('click', function () { state.tab = 'comps'; writeHash(); render(); });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.confidence = 'all'; state.watchlistOnly = false;
      document.getElementById('q').value = ''; document.getElementById('category').value = 'all';
      document.getElementById('chain').value = 'all'; document.getElementById('confidence').value = 'all';
      document.getElementById('watchlist-only').checked = false;
      writeHash(); render();
    });
    var gw = document.getElementById('gw');
    var mf = document.getElementById('mf');
    gw.addEventListener('input', function () {
      state.gw = parseFloat(gw.value);
      document.getElementById('gw-out').textContent = state.gw.toFixed(2);
      render();
    });
    mf.addEventListener('input', function () {
      state.mf = parseFloat(mf.value);
      document.getElementById('mf-out').textContent = state.mf.toFixed(2);
      render();
    });
    document.getElementById('sandbox-reset').addEventListener('click', function () {
      state.gw = DATA.model.growth_weight; state.mf = DATA.model.maturity_floor;
      gw.value = String(state.gw); mf.value = String(state.mf);
      document.getElementById('gw-out').textContent = state.gw.toFixed(2);
      document.getElementById('mf-out').textContent = state.mf.toFixed(2);
      render();
    });
  }

  function renderFormula() {
    var m = DATA.model;
    document.getElementById('formula').textContent =
      'implied = round( tvl_usd × category_multiple × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ') × (1 + 0.03 × min(chains − 1, 5)) )';
    document.getElementById('global-mult').textContent = String(DATA.global_multiple);
  }

  function render() {
    renderTabs();
    renderBoard();
    if (state.selected && state.tab === 'pre-token') openDetail(state.selected);
    else detail.hidden = true;
  }

  function init() {
    document.getElementById('meta-asof').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('meta-model').textContent = 'Model ' + DATA.model_version;
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    state.gw = DATA.model.growth_weight;
    state.mf = DATA.model.maturity_floor;
    document.getElementById('gw-out').textContent = state.gw.toFixed(2);
    document.getElementById('mf-out').textContent = state.mf.toFixed(2);
    readHash();
    fillSelects();
    bindControls();
    renderFacts();
    renderCompsTable();
    renderFormula();
    render();
    document.getElementById('board').setAttribute('aria-busy', 'false');
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !detail.hidden) closeDetail();
    });
  }

  init();
})();
