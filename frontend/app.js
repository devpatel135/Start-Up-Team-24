'use strict';

/* ── Config ─────────────────────────────────────────────────────────────────── */
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';

/* ── Season deadline ─────────────────────────────────────────────────────────── */
const SEASON_DEADLINE = new Date(2027, 2, 1); // March 1, 2027

/* ── Category metadata ───────────────────────────────────────────────────────── */
const CATEGORY_META = {
  basics:      { label: 'Basics',      sourcing: '72% China-sourced', icon: '<path d="M4 7l8-4 8 4v2l-2 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1v-7L4 9V7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  denim:       { label: 'Denim',       sourcing: '45% China-sourced', icon: '<path d="M5 4h14l-2 7H7L5 4z M7 11l1 9M17 11l-1 9M8 20h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  outerwear:   { label: 'Outerwear',   sourcing: '58% China-sourced', icon: '<path d="M4 7c0 0 2-3 5-3h6c3 0 5 3 5 3l1 11H3L4 7z M9 4l-1 7M15 4l1 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  footwear:    { label: 'Footwear',    sourcing: '65% China-sourced', icon: '<path d="M3 17c0 0 2-8 6-9 2-.5 4 0 6 2l3 3v4H3v-4z M9 8c0-2 1-4 3-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  accessories: { label: 'Accessories', sourcing: '68% China-sourced', icon: '<rect x="5" y="8" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 8V7a3 3 0 016 0v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  activewear:  { label: 'Activewear',  sourcing: '55% China-sourced', icon: '<path d="M13 3l5 9H6l5-9M11 12v9M13 12v9M9 21h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
};

/* ── Sourcing alternatives (April 2025 tariff reality) ───────────────────────── */
const SOURCING_ALTS = [
  { origin: 'China (current)',  tariff: 145, leadDays: '90–120', capacity: 'High',     tariffFactor: 1.000, note: 'Fully active — no pause' },
  { origin: 'Vietnam',          tariff: 46,  leadDays: '75–90',  capacity: 'Med-High', tariffFactor: 0.317, note: '90-day pause active (10% interim)' },
  { origin: 'Bangladesh',       tariff: 37,  leadDays: '90–105', capacity: 'Medium',   tariffFactor: 0.255, note: '90-day pause active (10% interim)' },
  { origin: 'Mexico (USMCA)',   tariff: 0,   leadDays: '30–45',  capacity: 'Low-Med',  tariffFactor: 0.000, note: 'Fully exempt — most stable option' },
];

/* ── Demo data (pre-computed for pitch resilience) ───────────────────────────── */
// Based on p50=0.145, p90=0.42 tariff deltas × category profiles
const DEMO_DATA = {
  predictions: {
    scenario_probs: { p10: 0.20, p50: 0.55, p90: 0.25 },
    scenario_tariff_deltas: { p10: 0.0, p50: 0.145, p90: 0.42 },
    reasoning: 'Demo mode: pre-computed based on April 2025 tariff baseline (145% China, Vietnam/Bangladesh on 90-day pause). Connect AWS for live AI predictions.',
  },
  policy_status: [
    { id: 'section301', name: 'China Section 301 Tariffs', status: 'active', direction: 'escalating', risk: 'severe', note: '145% effective rate fully in force. No pause.' },
    { id: 'vietnam_pause', name: 'Vietnam 90-Day Pause', status: 'active', direction: 'uncertain', risk: 'high', note: '46% rate paused; 10% interim. Expiry risk for Spring 2027 orders.' },
    { id: 'bangladesh_pause', name: 'Bangladesh 90-Day Pause', status: 'active', direction: 'uncertain', risk: 'high', note: '37% rate paused; 10% interim. Same expiry risk.' },
    { id: 'usmca', name: 'USMCA (Mexico)', status: 'active', direction: 'stable', risk: 'low', note: 'Fully exempt. 0% for qualifying apparel.' },
    { id: 'gsp', name: 'GSP', status: 'lapsed', direction: 'stable', risk: 'low', note: 'Lapsed 2017. Not a factor.' },
  ],
  alerts: [
    { severity: 'critical', title: '145% China Tariff — Fully Active', detail: 'The 145% effective tariff rate on Chinese apparel is in full force. Orders sourced from China will face a landed cost increase of 29–40% across categories.', category: 'tariff' },
    { severity: 'critical', title: 'Vietnam/Bangladesh Pause Expiry Risk', detail: 'The 90-day pause on 46% (Vietnam) and 37% (Bangladesh) tariffs may expire before Spring 2027 orders ship. Model both scenarios before committing.', category: 'tariff' },
    { severity: 'warning', title: 'Order Deadline: March 1, 2027', detail: 'Build contractual price-adjustment provisions before committing Spring 2027 purchase orders.', category: 'policy_change' },
    { severity: 'info', title: 'Mexico (USMCA): Only Fully-Exempt Sourcing', detail: 'Mexico remains at 0% tariff — the only major apparel origin fully exempt from April 2025 trade actions.', category: 'supply_chain' },
  ],
  cost_impacts: {
    basics:      { p10: 0, p50: 0.0292, p90: 0.0847 },
    denim:       { p10: 0, p50: 0.0145, p90: 0.0421 },
    outerwear:   { p10: 0, p50: 0.0268, p90: 0.0778 },
    footwear:    { p10: 0, p50: 0.0330, p90: 0.0957 },
    accessories: { p10: 0, p50: 0.0246, p90: 0.0714 },
    activewear:  { p10: 0, p50: 0.0239, p90: 0.0693 },
  },
  news_headlines: [],
  has_live_news: false,
  deadline_days: Math.max(0, Math.ceil((new Date(2027, 2, 1) - new Date()) / 86400000)),
  timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  _isDemo: true,
  signals: {
    signal_score: 0.68,
    sentiment: 0.42,
    velocity: 'rising',
    source_counts: { news: 14, tweet: 23, executive_order: 3 },
    escalation_mass: 0.61,
    deescalation_mass: 0.19,
    total_items: 40,
    bayesian_applied: true,
    top_signals: [
      { title: 'Executive Order 14257 — Section 301 Tariff Supplemental on Chinese Goods', source: 'Federal Register', source_type: 'executive_order', published: '2025-04-02' },
      { title: 'Vietnam trade negotiators in D.C. as 90-day tariff pause approaches expiry', source: 'Reuters', source_type: 'news', published: '2025-07-01' },
      { title: 'USTR announces formal review of Section 301 schedule — apparel category hearings set for September', source: 'WSJ', source_type: 'news', published: '2025-06-28' },
      { title: 'China retaliatory measures expanded: US agricultural exports targeted', source: 'Financial Times', source_type: 'news', published: '2025-06-25' },
      { title: '@SCOTUSblog: Federal Circuit declines to stay tariff EO enforcement pending appeal', source: 'Twitter/X', source_type: 'tweet', published: '2025-06-20' },
    ],
  },
};

const GAUGE_ARC_LENGTH = 219;

const RISK_CONFIG = {
  low:      { fill: 0.25, color: '#10b981', label: 'Low'      },
  moderate: { fill: 0.50, color: '#f59e0b', label: 'Moderate' },
  high:     { fill: 0.75, color: '#f43f5e', label: 'High'     },
  severe:   { fill: 1.00, color: '#dc2626', label: 'Severe'   },
  unknown:  { fill: 0,    color: '#3a4a68', label: '—'        },
};

/* ── Module-level state ─────────────────────────────────────────────────────── */
let _costImpacts = null;
let _predictions = null;
let _signals = null;

/* ── Toast notifications ─────────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
  });
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ── Utilities ──────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(pct) {
  if (pct === 0) return '0.0%';
  return (pct * 100).toFixed(1) + '%';
}

function fmtPp(pp) {
  return pp.toFixed(1) + 'pp';
}

function impactColor(pct) {
  if (pct < 0.02) return 'var(--low)';
  if (pct < 0.05) return 'var(--moderate)';
  return 'var(--high)';
}

function ppColor(pp) {
  if (pp < 2) return 'var(--low)';
  if (pp < 4) return 'var(--moderate)';
  return 'var(--high)';
}

function fmtMoney(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZoneName: 'short',
    });
  } catch { return iso; }
}

function daysToDeadline() {
  const now = new Date();
  const diff = SEASON_DEADLINE - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function avgMarginErosion(costImpacts, scenario, margin) {
  const cats = Object.keys(CATEGORY_META);
  if (!cats.length) return 0;
  const sum = cats.reduce((acc, cat) => {
    const impact = (costImpacts[cat] || {})[scenario] || 0;
    return acc + impact * (1 - margin);
  }, 0);
  return (sum / cats.length) * 100; // in pp
}

/* ── Computed fallback analysis (runs when Bedrock is unavailable) ────────────── */
function generateFallbackAnalysis(predictions, costImpacts) {
  const probs  = (predictions || {}).scenario_probs         || { p10: 0.20, p50: 0.55, p90: 0.25 };
  const deltas = (predictions || {}).scenario_tariff_deltas || { p10: 0.0,  p50: 0.145, p90: 0.42 };

  const p50Prob    = Math.round((probs.p50  || 0.55) * 100);
  const p90Prob    = Math.round((probs.p90  || 0.25) * 100);
  const p50DeltaPp = ((deltas.p50 || 0.145) * 100).toFixed(0);
  const p90DeltaPp = ((deltas.p90 || 0.42)  * 100).toFixed(0);

  const avgP50 = avgMarginErosion(costImpacts || {}, 'p50', 0.50);
  const avgP90 = avgMarginErosion(costImpacts || {}, 'p90', 0.50);

  const days = daysToDeadline();

  const para1 = `The market assigns a ${p50Prob}% probability to the moderate tariff scenario — an additional +${p50DeltaPp}pp delta on top of the already-elevated baseline — implying ${avgP50.toFixed(1)}pp average margin erosion across apparel categories at a 50% retail margin. The severe outcome (${p90Prob}% probability, +${p90DeltaPp}pp delta) would push category erosion to ${avgP90.toFixed(1)}pp, a level that eliminates profitability on standard margin structures without immediate price action. The 145% effective rate on Chinese apparel — combining the 10% emergency base and 125% reciprocal Section 301 surcharge — is fully in force with no court stay or pause in effect.`;

  const para2 = `With ${days} days to the March 1, 2027 commitment deadline, buyers operating on standard 90–120 day China lead times are approaching the point of no return. Vietnam and Bangladesh alternatives currently trade at the interim 10% pause rate, but the 90-day pause window expires before Spring 2027 orders land, introducing binary rate risk of 46% and 37% respectively. Mexico (USMCA) remains the only fully-exempt sourcing origin at 0%. Recommended action: model orders under both pause-active and pause-expired scenarios, build contractual cost-escalation provisions into purchase agreements, and treat the P90 outcome as the institutional stress case — not a tail risk — given the current pace of US trade policy escalation.`;

  return `${para1}\n\n${para2}`;
}

/* ── Kalshi: Featured Contracts ─────────────────────────────────────────────── */
function renderFeaturedContracts(predictions, costImpacts) {
  const grid = document.getElementById('contracts-grid');
  if (!grid) return;

  const probs  = (predictions || {}).scenario_probs         || { p10: 0.20, p50: 0.55, p90: 0.25 };
  const deltas = (predictions || {}).scenario_tariff_deltas || { p10: 0.0,  p50: 0.145, p90: 0.42 };

  const contracts = [
    {
      id: 'p10', title: 'China tariffs de-escalate before Spring 2027',
      subtitle: 'Optimistic (P10)', color: 'green',
      prob: Math.round((probs.p10 || 0.20) * 100),
      delta: ((deltas.p10 || 0) * 100).toFixed(0), volume: '2.1K',
    },
    {
      id: 'p50', title: 'Tariffs persist at moderate elevated levels',
      subtitle: 'Moderate (P50) · Base Case', color: 'amber',
      prob: Math.round((probs.p50 || 0.55) * 100),
      delta: ((deltas.p50 || 0.145) * 100).toFixed(0), volume: '8.4K',
    },
    {
      id: 'p90', title: 'Full tariff escalation — severe scenario',
      subtitle: 'Severe (P90) · Stress Case', color: 'red',
      prob: Math.round((probs.p90 || 0.25) * 100),
      delta: ((deltas.p90 || 0.42) * 100).toFixed(0), volume: '3.7K',
    },
  ];

  const palette = {
    green: { yes: '#059669', yesBg: 'rgba(5,150,105,.12)', no: '#e11d48', noBg: 'rgba(225,29,72,.10)', bar: '#059669' },
    amber: { yes: '#d97706', yesBg: 'rgba(217,119,6,.12)', no: '#3b82f6', noBg: 'rgba(59,130,246,.10)', bar: '#d97706' },
    red:   { yes: '#e11d48', yesBg: 'rgba(225,29,72,.12)', no: '#059669', noBg: 'rgba(5,150,105,.10)', bar: '#e11d48' },
  };

  grid.innerHTML = contracts.map(c => {
    const cl = palette[c.color] || palette.amber;
    const yp = c.prob, np = 100 - c.prob;
    return `
      <div class="contract-card contract-card--${escapeHtml(c.color)}">
        <div class="contract-meta">
          <span class="contract-subtitle">${escapeHtml(c.subtitle)}</span>
          <span class="contract-delta">+${escapeHtml(c.delta)}pp tariff</span>
        </div>
        <div class="contract-title">${escapeHtml(c.title)}</div>
        <div class="contract-prob-track">
          <div class="contract-prob-fill" style="width:${yp}%;background:${cl.bar}"></div>
        </div>
        <div class="contract-prices">
          <div class="contract-price-side" style="background:${cl.yesBg};color:${cl.yes}">
            <span class="cps-label">YES</span>
            <span class="cps-val">${yp}¢</span>
          </div>
          <div class="contract-price-mid">
            <div class="cpm-prob" style="color:${cl.bar}">${yp}%</div>
            <div class="cpm-vol">${escapeHtml(c.volume)} vol</div>
          </div>
          <div class="contract-price-side" style="background:${cl.noBg};color:${cl.no}">
            <span class="cps-label">NO</span>
            <span class="cps-val">${np}¢</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── Kalshi: Contract Call ───────────────────────────────────────────────────── */
function analyzeContractCall(inputText) {
  if (!_costImpacts || !_predictions) {
    showToast('Load dashboard data first to enable contract analysis', 'warn');
    return null;
  }

  const text = inputText.toLowerCase();
  const probs = (_predictions.scenario_probs || { p10: 0.20, p50: 0.55, p90: 0.25 });

  let category = null;
  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    if (text.includes(cat) || text.includes(meta.label.toLowerCase())) { category = cat; break; }
  }

  const isBullish = /below|drop|reduc|fall|de-escal|cut|lower|decreas/.test(text);
  const isBearish = /above|exceed|escal|rise|increas|spike|surge|high|worst|severe/.test(text);
  const isVietnam  = /vietnam|viet/.test(text);
  const isBangladesh = /bangladesh/.test(text);
  const isMexico   = /mexico|usmca/.test(text);

  let probability, scenarioKey;
  if (isMexico) {
    probability = 92; scenarioKey = 'p10';
  } else if (isBullish) {
    probability = Math.round((probs.p10 || 0.20) * 100); scenarioKey = 'p10';
  } else if (isBearish) {
    probability = Math.min(85, Math.round(((probs.p50 || 0.55) + (probs.p90 || 0.25)) * 100)); scenarioKey = 'p90';
  } else if (isVietnam) {
    probability = 72; scenarioKey = 'p50';
  } else if (isBangladesh) {
    probability = 68; scenarioKey = 'p50';
  } else {
    probability = Math.round((probs.p50 || 0.55) * 100); scenarioKey = 'p50';
  }

  const cat = category || 'basics';
  const impacts = (_costImpacts[cat] || { p10: 0, p50: 0, p90: 0 });
  const impact = impacts[scenarioKey] || impacts.p50 || 0;
  const margin = 0.5;
  const marginErosion = (impact * (1 - margin) * 100).toFixed(1);
  const totalAddedCost = (500 * 18 * impact).toFixed(0);
  const categoryLabel = CATEGORY_META[cat]?.label || cat;
  const yesPrice = probability, noPrice = 100 - probability;

  let impliedRisk;
  if (probability >= 75) impliedRisk = 'severe';
  else if (probability >= 50) impliedRisk = 'high';
  else if (probability >= 30) impliedRisk = 'moderate';
  else impliedRisk = 'low';

  let analysis;
  if (isMexico) {
    analysis = `Mexico (USMCA) carries a ${probability}% probability of tariff exemption through Spring 2027 — the only fully-exempt origin. At $0 tariff impact, this is the lowest-risk sourcing pivot available to buyers today, though capacity constraints (Low-Med) limit scalability across all categories.`;
  } else if (isBullish) {
    analysis = `De-escalation has only a ${probability}% probability given current trade policy trajectory. If this materializes, ${categoryLabel} margin erosion would be near-zero. The market is pricing this as the tail-optimistic scenario — do not model it as a base case without a verifiable policy catalyst.`;
  } else if (isBearish) {
    analysis = `Tariff escalation / persistence probability: ${probability}%. At this scenario, ${categoryLabel} faces ${marginErosion}pp margin erosion at a 50% retail margin. Recommend building cost-escalation provisions into Spring 2027 purchase orders and modeling Vietnam / Bangladesh alternatives now.`;
  } else if (isVietnam) {
    analysis = `Vietnam pause expiry carries ${probability}% probability before Spring 2027 orders land at port. If rates revert from 10% to 46%, buyers reliant on Vietnamese supply face a step-change in cost. Recommend dual-scenario modeling — with and without pause extension — before PO commitment.`;
  } else {
    analysis = `Moderate tariff persistence has ${probability}% probability — the AI base case. ${categoryLabel} faces ${marginErosion}pp margin erosion at a 50% retail margin. Treat P50 as the planning baseline. P90 (25%) represents the institutional stress case that should inform purchase order provisions.`;
  }

  return { probability, yesPrice, noPrice, impliedRisk, category: cat, categoryLabel, marginErosion, analysis, totalAddedCost };
}

function renderCallResult(result, inputText) {
  const el = document.getElementById('call-result');
  if (!el || !result) return;
  const riskCfg = RISK_CONFIG[result.impliedRisk] || RISK_CONFIG.moderate;
  const riskColors = { severe: '#dc2626', high: '#e11d48', moderate: '#d97706', low: '#059669', unknown: '#6b7a9b' };
  const rc = riskColors[result.impliedRisk] || '#6b7a9b';

  el.style.display = '';
  el.innerHTML = `
    <div class="call-result-inner">
      <div class="call-result-top">
        <div class="call-result-contract-label">Contract Analysis</div>
        <div class="call-result-title">"${escapeHtml(inputText)}"</div>
        <div class="call-result-category">${escapeHtml(result.categoryLabel)} category · ${escapeHtml(result.marginErosion)}pp margin erosion at this scenario</div>
      </div>
      <div class="call-result-prices">
        <div class="crp-block crp-yes">
          <div class="crp-label">YES</div>
          <div class="crp-val">${result.yesPrice}¢</div>
          <div class="crp-sub">per $1 contract</div>
        </div>
        <div class="crp-block crp-prob">
          <div class="crp-label">PROBABILITY</div>
          <div class="crp-val" style="color:${rc}">${result.probability}%</div>
          <div class="crp-sub" style="color:${rc}">${escapeHtml(riskCfg.label)} Risk</div>
        </div>
        <div class="crp-block crp-no">
          <div class="crp-label">NO</div>
          <div class="crp-val">${result.noPrice}¢</div>
          <div class="crp-sub">per $1 contract</div>
        </div>
      </div>
      <div class="call-result-analysis">${escapeHtml(result.analysis)}</div>
      <button class="call-result-cta" onclick="switchToOrderTab()">Model ${escapeHtml(result.categoryLabel)} order impact →</button>
    </div>`;

  updateRiskMeter(result.impliedRisk);
}

function initContractCall() {
  const btn   = document.getElementById('call-btn');
  const input = document.getElementById('call-input');
  if (!btn || !input) return;

  const doAnalyze = () => {
    const val = input.value.trim();
    if (!val) { showToast('Enter a trade scenario to analyze', 'warn', 2500); return; }
    const result = analyzeContractCall(val);
    if (result) renderCallResult(result, val);
  };

  btn.addEventListener('click', doAnalyze);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAnalyze(); });

  document.querySelectorAll('.call-example-btn').forEach(exBtn => {
    exBtn.addEventListener('click', () => {
      const call = exBtn.dataset.call;
      if (input) { input.value = call; }
      const result = analyzeContractCall(call);
      if (result) renderCallResult(result, call);
    });
  });
}

/* ── Charts ──────────────────────────────────────────────────────────────────── */
let _scenarioChart = null;
let _categoryChart = null;

function chartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#6b7a9b';
}

function destroyChart(ref) {
  if (ref) { try { ref.destroy(); } catch (_) {} }
  return null;
}

function renderScenarioChart(predictions) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('scenario-chart');
  if (!canvas) return;
  _scenarioChart = destroyChart(_scenarioChart);

  const probs  = (predictions || {}).scenario_probs         || {};
  const deltas = (predictions || {}).scenario_tariff_deltas || {};
  const p10 = Math.round((probs.p10 || 0.20) * 100);
  const p50 = Math.round((probs.p50 || 0.55) * 100);
  const p90 = Math.round((probs.p90 || 0.25) * 100);
  const d10 = ((deltas.p10 || 0.0)   * 100).toFixed(0);
  const d50 = ((deltas.p50 || 0.145) * 100).toFixed(0);
  const d90 = ((deltas.p90 || 0.42)  * 100).toFixed(0);

  _scenarioChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [
        `Optimistic (P10) · +${d10}pp tariff`,
        `Moderate (P50) · +${d50}pp tariff`,
        `Severe (P90) · +${d90}pp tariff`,
      ],
      datasets: [{
        label: 'Scenario Probability',
        data: [p10, p50, p90],
        backgroundColor: ['#059669cc', '#d97706cc', '#e11d48cc'],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.raw}% probability` } },
      },
      scales: {
        x: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%', font: { size: 11 }, color: '#6b7a9b' },
          grid: { color: 'rgba(0,0,0,0.06)' },
          border: { display: false },
        },
        y: {
          ticks: { font: { size: 11 }, color: '#111827' },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  });
}

function renderCategoryChart(costImpacts) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('category-chart');
  if (!canvas) return;
  _categoryChart = destroyChart(_categoryChart);

  const cats   = Object.keys(CATEGORY_META);
  const labels = cats.map(c => CATEGORY_META[c].label);
  const margin = 0.5;
  const p50pp  = cats.map(c => +((((costImpacts[c] || {}).p50 || 0)) * (1 - margin) * 100).toFixed(2));
  const p90pp  = cats.map(c => +((((costImpacts[c] || {}).p90 || 0)) * (1 - margin) * 100).toFixed(2));

  _categoryChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'P50 Scenario',
          data: p50pp,
          backgroundColor: '#d97706cc',
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'P90 Scenario',
          data: p90pp,
          backgroundColor: '#e11d48cc',
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { font: { size: 11 }, color: '#6b7a9b', padding: 12, boxWidth: 10, boxHeight: 10 },
        },
        tooltip: { callbacks: { label: c => ` ${c.raw.toFixed(1)}pp margin erosion` } },
      },
      scales: {
        x: {
          min: 0,
          ticks: { callback: v => v + 'pp', font: { size: 11 }, color: '#6b7a9b' },
          grid: { color: 'rgba(0,0,0,0.06)' },
          border: { display: false },
        },
        y: {
          ticks: { font: { size: 11 }, color: '#111827' },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  });
}

/* ── Step strip sync ─────────────────────────────────────────────────────────── */
function syncStepStrip(activeTab) {
  const isCommit = activeTab === 'order-commitment';
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active', 'done'));
  if (isCommit) {
    document.getElementById('step-1')?.classList.add('done');
    document.getElementById('step-2')?.classList.add('done');
    document.getElementById('step-3')?.classList.add('active');
  } else {
    document.getElementById('step-1')?.classList.add('active');
  }
}

/* ── Tab switching ───────────────────────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + target);
      if (panel) panel.classList.add('active');
      if (target === 'order-commitment') updateOrderCommitmentResults();
      syncStepStrip(target);
    });
  });
  // wire step strip clicks
  document.querySelectorAll('.step-item[data-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.click();
    });
  });
}

function switchToOrderTab() {
  const btn = document.querySelector('[data-tab="order-commitment"]');
  if (btn) btn.click();
}

/* ── Render: Decision Banner ─────────────────────────────────────────────────── */
function renderDecisionBanner(predictions, costImpacts) {
  const days = daysToDeadline();
  const daysEl = document.getElementById('deadline-days');
  if (daysEl) {
    daysEl.textContent = days.toLocaleString();
    daysEl.style.color = days < 60 ? 'var(--high)' : days < 90 ? 'var(--moderate)' : 'var(--low)';
  }

  const probs = (predictions || {}).scenario_probs || {};
  const p50Prob = Math.round((probs.p50 || 0) * 100);
  const el50 = document.getElementById('banner-p50-prob');
  if (el50) el50.textContent = p50Prob + '%';

  const defaultMargin = 0.5;
  if (costImpacts) {
    const p50pp = avgMarginErosion(costImpacts, 'p50', defaultMargin);
    const p90pp = avgMarginErosion(costImpacts, 'p90', defaultMargin);
    const e50 = document.getElementById('banner-p50-erosion');
    const e90 = document.getElementById('banner-p90-erosion');
    if (e50) e50.textContent = p50pp.toFixed(1) + 'pp';
    if (e90) e90.textContent = p90pp.toFixed(1) + 'pp';
  }

  const btn = document.getElementById('banner-model-btn');
  if (btn) btn.addEventListener('click', switchToOrderTab);

  // Update the alerts deadline context bar
  const contextBar = document.getElementById('deadline-context-bar');
  const contextText = document.getElementById('deadline-context-text');
  if (contextBar && contextText) {
    contextText.textContent = `You have ${days} days before Spring 2027 orders must commit — act on these signals now.`;
    contextBar.className = 'deadline-context-bar' + (days < 60 ? ' deadline-context-bar--urgent' : '');
  }
}

/* ── Render: KPI Cards ───────────────────────────────────────────────────────── */
function renderKPICards(costImpacts, predictions) {
  const defaultMargin = 0.5;
  const p50pp = avgMarginErosion(costImpacts, 'p50', defaultMargin);
  const p90pp = avgMarginErosion(costImpacts, 'p90', defaultMargin);
  const probs = (predictions || {}).scenario_probs || {};
  const escalationProb = Math.round(((probs.p50 || 0) + (probs.p90 || 0)) * 100);

  function kpiCard(id, value, label, colorFn, sublabel) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'kpi-card';
    el.innerHTML = `
      <div class="kpi-value" style="color:${colorFn(value)}">${escapeHtml(value)}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
      ${sublabel ? `<div class="kpi-sublabel">${escapeHtml(sublabel)}</div>` : ''}
    `;
  }

  kpiCard('kpi-p50-erosion',
    p50pp.toFixed(1) + 'pp',
    'Avg Margin Erosion · P50',
    v => ppColor(parseFloat(v)),
    'If you absorb P50 cost increase at 50% margin'
  );
  kpiCard('kpi-p90-erosion',
    p90pp.toFixed(1) + 'pp',
    'Avg Margin Erosion · P90',
    v => ppColor(parseFloat(v)),
    'Severe scenario — plan contingency now'
  );
  kpiCard('kpi-tariff-prob',
    escalationProb + '%',
    'Tariff Escalation Probability',
    v => { const n = parseInt(v); return n >= 70 ? 'var(--high)' : n >= 50 ? 'var(--moderate)' : 'var(--low)'; },
    'Combined P50 + P90 scenario likelihood'
  );
}

/* ── Render: Risk Gauge ──────────────────────────────────────────────────────── */
function updateRiskMeter(riskLevel) {
  const cfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.unknown;
  const fillLen = GAUGE_ARC_LENGTH * cfg.fill;
  const fill = document.getElementById('gauge-fill');
  const label = document.getElementById('gauge-level');
  if (fill) {
    fill.style.strokeDasharray = `${fillLen} ${GAUGE_ARC_LENGTH}`;
    fill.style.stroke = cfg.color;
  }
  if (label) {
    label.textContent = cfg.label;
    label.style.fill = cfg.color;
  }
  document.querySelectorAll('.legend-item').forEach(el => {
    el.style.opacity = el.classList.contains(`legend-item--${riskLevel}`) ? '1' : '0.3';
  });
}

/* ── Render: Risk Statement ──────────────────────────────────────────────────── */
function renderRiskStatement(predictions, costImpacts, riskLevel) {
  const el = document.getElementById('risk-statement');
  if (!el) return;
  const probs = (predictions || {}).scenario_probs || {};
  const p50Prob = Math.round((probs.p50 || 0.55) * 100);
  const p90Prob = Math.round((probs.p90 || 0.25) * 100);
  const margin = 0.5;
  const p50pp = avgMarginErosion(costImpacts || {}, 'p50', margin).toFixed(1);
  const p90pp = avgMarginErosion(costImpacts || {}, 'p90', margin).toFixed(1);
  const days = daysToDeadline();
  const riskLabels = { low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe', unknown: 'Loading' };
  const riskCfg = RISK_CONFIG[riskLevel] || RISK_CONFIG.unknown;
  el.innerHTML = `
    <p class="rs-eyebrow">AI Risk Assessment · Spring 2027 Buying Cycle</p>
    <p class="rs-headline">Risk level is <span class="rs-num" style="color:${riskCfg.color}">${riskLabels[riskLevel] || '—'}</span> — ${p50Prob}% chance of P50 scenario with <span class="rs-num">${p50pp}pp</span> avg margin erosion</p>
    <div class="rs-stats" id="rs-stats">
      <div class="rs-stat"><span class="rs-stat-val" style="color:var(--moderate)">${p50pp}pp</span><span class="rs-stat-label">P50 Margin Erosion</span></div>
      <span class="rs-stat-sep"></span>
      <div class="rs-stat"><span class="rs-stat-val" style="color:var(--high)">${p90pp}pp</span><span class="rs-stat-label">P90 Margin Erosion</span></div>
      <span class="rs-stat-sep"></span>
      <div class="rs-stat"><span class="rs-stat-val">${p90Prob}%</span><span class="rs-stat-label">Severe Scenario Prob.</span></div>
      <span class="rs-stat-sep"></span>
      <div class="rs-stat"><span class="rs-stat-val" style="color:${days < 60 ? 'var(--high)' : 'var(--accent)'}">${days}</span><span class="rs-stat-label">Days to Deadline</span></div>
    </div>`;
}

/* ── Render: Category Cards ──────────────────────────────────────────────────── */
function renderCategoryCards(costImpacts) {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    const impacts = costImpacts[cat] || { p10: 0, p50: 0, p90: 0 };
    const p50 = impacts.p50 || 0;
    const accent = impactColor(p50);
    const maxPct = Math.max(impacts.p90 || 0, 0.08);

    const card = document.createElement('div');
    card.className = 'category-card category-card--clickable';
    card.dataset.cat = cat;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Model ${meta.label} order impact`);
    card.style.setProperty('--card-accent', accent);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${meta.icon}</svg>
        </div>
        <div>
          <div class="card-name">${escapeHtml(meta.label)}</div>
          <div class="card-sourcing">${escapeHtml(meta.sourcing)}</div>
        </div>
      </div>
      <div class="impact-rows">
        ${['p10','p50','p90'].map(scenario => {
          const val = impacts[scenario] || 0;
          const barWidth = maxPct > 0 ? Math.min(100, (val / maxPct) * 100) : 0;
          const color = impactColor(val);
          return `
            <div class="impact-row">
              <span class="impact-label">${scenario.toUpperCase()}</span>
              <div class="impact-bar">
                <div class="impact-bar-fill" style="width:${barWidth}%;--bar-color:${color}"></div>
              </div>
              <span class="impact-pct" style="--pct-color:${color}">${fmt(val)}</span>
            </div>`;
        }).join('')}
      </div>`;

    grid.appendChild(card);
  }
}

/* ── Category card click → pre-fill Order Commitment ────────────────────────── */
function makeCardsClickable() {
  document.querySelectorAll('.category-card--clickable').forEach(card => {
    const activate = () => {
      const cat = card.dataset.cat;
      if (!cat) return;
      const sel = document.getElementById('oc-category');
      if (sel) sel.value = cat;
      switchToOrderTab();
      showToast(`Modeling ${CATEGORY_META[cat]?.label || cat} order impact`, 'info', 2500);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

/* ── Methodology modal ───────────────────────────────────────────────────────── */
function initMethodologyModal() {
  const overlay = document.getElementById('methodology-modal');
  const openBtn = document.getElementById('methodology-btn');
  const closeBtn = document.getElementById('modal-close');
  if (!overlay || !openBtn) return;
  const open = () => { overlay.classList.add('modal-overlay--visible'); openBtn.setAttribute('aria-expanded', 'true'); };
  const close = () => { overlay.classList.remove('modal-overlay--visible'); openBtn.setAttribute('aria-expanded', 'false'); };
  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

/* ── Render: Predictions Panel ───────────────────────────────────────────────── */
function renderPredictionsPanel(predictions, newsHeadlines, hasLiveNews) {
  const panel = document.getElementById('predictions-panel');
  if (!panel) return;

  const probs = predictions.scenario_probs || {};
  const deltas = predictions.scenario_tariff_deltas || {};
  const reasoning = predictions.reasoning || '';

  const scenarios = [
    { key: 'p10', label: 'Optimistic (P10)', color: 'var(--low)' },
    { key: 'p50', label: 'Moderate (P50)',   color: 'var(--moderate)' },
    { key: 'p90', label: 'Severe (P90)',     color: 'var(--high)' },
  ];

  let html = '<div class="scenario-rows">';
  for (const s of scenarios) {
    const prob = probs[s.key] || 0;
    const pct = Math.round(prob * 100);
    const delta = (deltas[s.key] || 0) * 100;
    html += `
      <div class="scenario-row">
        <div class="scenario-label">
          <span>${escapeHtml(s.label)}</span>
          <span class="scenario-delta" style="color:${s.color}">+${delta.toFixed(0)}pp tariff</span>
        </div>
        <div class="scenario-track">
          <div class="scenario-fill" style="width:${pct}%;background:${s.color}"></div>
        </div>
        <span class="scenario-prob" style="color:${s.color}">${pct}%</span>
      </div>`;
  }
  html += '</div>';

  if (reasoning) {
    html += `<p class="reasoning-text">${escapeHtml(reasoning)}</p>`;
  }

  if (hasLiveNews && newsHeadlines && newsHeadlines.length > 0) {
    html += '<div class="news-list"><p class="news-label">Live News Inputs</p>';
    newsHeadlines.slice(0, 5).forEach(h => {
      html += `<div class="news-item">
        <span class="news-source">${escapeHtml(h.source || '')}</span>
        <span class="news-title">${escapeHtml(h.title || '')}</span>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<p class="news-label news-label--dim">Reasoning from historical data · no live feed</p>';
  }

  panel.innerHTML = html;

  const dot = document.getElementById('live-dot');
  if (dot) dot.classList.add('live');
}

/* ── Render: Recommendations ─────────────────────────────────────────────────── */
function renderRecommendations(recommendations) {
  const panel = document.getElementById('recommendations-panel');
  if (!panel || !recommendations || !recommendations.length) return;

  panel.innerHTML = `<ol class="recommendations-list">${
    recommendations.map(r => `<li class="rec-item">${escapeHtml(r)}</li>`).join('')
  }</ol>`;
}

/* ── Render: Policy Tracker ──────────────────────────────────────────────────── */
function renderPolicyTracker(policyStatus) {
  const wrap = document.getElementById('policy-table-wrap');
  if (!wrap || !policyStatus) return;

  const directionClass = {
    escalating:    'direction--escalating',
    'de-escalating': 'direction--deescalating',
    stable:        'direction--stable',
    uncertain:     'direction--uncertain',
  };
  const riskClass = {
    low: 'risk--low', moderate: 'risk--moderate', high: 'risk--high', severe: 'risk--severe',
  };

  wrap.innerHTML = `
    <div class="policy-table-scroll">
    <table class="policy-table" role="table">
      <thead>
        <tr>
          <th scope="col">Policy</th>
          <th scope="col">Status</th>
          <th scope="col">Direction</th>
          <th scope="col">Risk</th>
          <th scope="col">Note</th>
        </tr>
      </thead>
      <tbody>
        ${policyStatus.map(p => `
          <tr>
            <td class="policy-name">${escapeHtml(p.name || '')}</td>
            <td><span class="status-tag">${escapeHtml(p.status || '')}</span></td>
            <td><span class="direction-pill ${directionClass[p.direction] || ''}">${escapeHtml(p.direction || '')}</span></td>
            <td><span class="risk-pill ${riskClass[p.risk] || ''}">${escapeHtml(p.risk || '')}</span></td>
            <td class="policy-note">${escapeHtml(p.note || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

/* ── Render: Alerts ──────────────────────────────────────────────────────────── */
function renderAlerts(alerts) {
  const list = document.getElementById('alerts-list');
  if (!list || !alerts) return;

  const icon = { critical: '&#9679;', warning: '&#9679;', info: '&#9679;' };
  const cls  = { critical: 'alert-card--critical', warning: 'alert-card--warning', info: 'alert-card--info' };
  const iconColor = { critical: 'var(--high)', warning: 'var(--moderate)', info: 'var(--accent)' };

  list.innerHTML = alerts.map(a => `
    <div class="alert-card ${cls[a.severity] || ''}">
      <div class="alert-header">
        <span class="alert-icon" style="color:${iconColor[a.severity] || 'var(--accent)'}; font-size:8px">${icon[a.severity] || '&#9679;'}</span>
        <strong class="alert-title">${escapeHtml(a.title || '')}</strong>
        <span class="alert-category">${escapeHtml(a.category || '')}</span>
      </div>
      <p class="alert-detail">${escapeHtml(a.detail || '')}</p>
    </div>`).join('');

  const badge = document.getElementById('alert-badge');
  const critical = alerts.filter(a => a.severity === 'critical').length;
  if (badge) {
    badge.textContent = critical > 0 ? critical : alerts.length;
    badge.style.display = alerts.length > 0 ? '' : 'none';
    badge.className = 'alert-badge' + (critical > 0 ? ' alert-badge--critical' : '');
  }
}

/* ── Render: Order Commitment ────────────────────────────────────────────────── */
function renderOrderCommitment(costImpacts, predictions) {
  _costImpacts = costImpacts;
  _predictions = predictions;
  updateOrderCommitmentResults();
}

function updateOrderCommitmentResults() {
  const resultsEl = document.getElementById('oc-results');
  if (!resultsEl) return;

  if (!_costImpacts || !_predictions) {
    resultsEl.innerHTML = '<p class="pt-baseline">Load dashboard data first.</p>';
    return;
  }

  const cat      = document.getElementById('oc-category')?.value || 'basics';
  const units    = parseFloat(document.getElementById('oc-units')?.value) || 500;
  const unitCost = parseFloat(document.getElementById('oc-cost')?.value) || 18;
  const marginPct = parseFloat(document.getElementById('oc-margin')?.value) || 50;
  const margin   = marginPct / 100;
  const budgetRaw = parseFloat(document.getElementById('oc-budget')?.value);
  const budget   = isNaN(budgetRaw) || budgetRaw <= 0 ? units * unitCost : budgetRaw;

  const impacts = _costImpacts[cat] || { p10: 0, p50: 0, p90: 0 };
  const currentRetail = unitCost / (1 - margin);
  const totalCOGS = units * unitCost;
  const probs = (_predictions.scenario_probs || {});

  const SCENARIOS = [
    { key: 'p10', label: 'Optimistic',  color: 'var(--low)',      probKey: 'p10' },
    { key: 'p50', label: 'Moderate',    color: 'var(--moderate)', probKey: 'p50' },
    { key: 'p90', label: 'Severe',      color: 'var(--high)',     probKey: 'p90' },
  ];

  const rows = SCENARIOS.map(s => {
    const impact           = impacts[s.key] || 0;
    const addedCostPerUnit = unitCost * impact;
    const totalAddedCost   = units * addedCostPerUnit;
    const marginErosionPp  = impact * (1 - margin) * 100;
    const newRetailFull    = (unitCost * (1 + impact)) / (1 - margin);
    const priceIncreasePct = impact * 100;
    const priceSplitPct    = impact * 50;
    const marginErosionSplit = marginErosionPp / 2;
    const prob             = Math.round((probs[s.probKey] || 0) * 100);
    return { ...s, impact, addedCostPerUnit, totalAddedCost, marginErosionPp,
             newRetailFull, priceIncreasePct, priceSplitPct, marginErosionSplit,
             prob, budgetPct: budget > 0 ? (totalAddedCost / budget) * 100 : 0 };
  });

  // Pick worst likely scenario for recommendation text
  const p50row = rows.find(r => r.key === 'p50');
  const p90row = rows.find(r => r.key === 'p90');
  const days = daysToDeadline();
  let recText = '';
  if (p50row && p90row) {
    if (days < 60) {
      recText = `Deadline is ${days} days away — if you must commit now, negotiate cost escalation provisions with your supplier, or accept P50 scenario absorb of ${p50row.marginErosionPp.toFixed(1)}pp.`;
    } else if (p90row.marginErosionPp > 5) {
      recText = `P90 exposure is severe (${p90row.marginErosionPp.toFixed(1)}pp erosion). Secure Vietnam or Bangladesh alternatives before order deadline — you have ${days} days.`;
    } else if (p50row.marginErosionPp > 3) {
      recText = `A 50/50 split strategy limits margin erosion to ${p50row.marginErosionSplit.toFixed(1)}pp while requiring only a ${p50row.priceSplitPct.toFixed(1)}% price increase — the most defensible position given documented tariff uncertainty.`;
    } else {
      recText = `Current P50 exposure (${p50row.marginErosionPp.toFixed(1)}pp) is within tolerance. Monitor policy signals. Confirm sourcing terms include cost-escalation provisions before final commitment.`;
    }
  }

  // Build sourcing alt table using current category P50 impact as the China baseline
  const chinaP50 = impacts.p50 || 0;
  const sourcingRows = SOURCING_ALTS.map(alt => {
    const altImpact = chinaP50 * alt.tariffFactor;
    const altErosion = altImpact * (1 - margin) * 100;
    return { ...alt, altImpact, altErosion };
  });

  resultsEl.innerHTML = `
    <!-- Baseline strip -->
    <div class="pt-baseline-row">
      <span>Unit cost: <strong>${escapeHtml(fmtMoney(unitCost))}</strong></span>
      <span>Current retail: <strong>${escapeHtml(fmtMoney(currentRetail))}</strong></span>
      <span>Order size: <strong>${units.toLocaleString()} units</strong></span>
      <span>Total COGS: <strong>${escapeHtml(fmtMoney(totalCOGS))}</strong></span>
      ${budget !== totalCOGS ? `<span>Season budget: <strong>${escapeHtml(fmtMoney(budget))}</strong></span>` : ''}
    </div>

    <!-- Section 1: Cost Impact Table -->
    <div class="oc-section-label">Tariff Cost Impact by Scenario</div>
    <div class="oc-table-wrap">
    <table class="pt-results-table" role="table">
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col">Prob</th>
          <th scope="col">Cost Impact</th>
          <th scope="col">Added $/Unit</th>
          <th scope="col">Total Added Cost</th>
          <th scope="col">% of Budget</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="color:${r.color};font-weight:600">${escapeHtml(r.label)}</td>
            <td style="color:${r.color}">${r.prob}%</td>
            <td style="color:${r.color}">${escapeHtml(fmt(r.impact))}</td>
            <td>${escapeHtml(fmtMoney(r.addedCostPerUnit))}</td>
            <td style="color:${r.color};font-weight:600">${escapeHtml(fmtMoney(r.totalAddedCost))}</td>
            <td style="color:${r.color}">${r.budgetPct.toFixed(1)}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>

    <!-- Section 2: Absorb vs Pass-Through Decision Matrix -->
    <div class="oc-section-label">Decision Matrix — Absorb vs. Pass-Through</div>
    <p class="oc-section-desc">Choose your response strategy. Numbers assume ${marginPct}% current retail margin.</p>
    <div class="absorb-grid">
      <!-- header row -->
      <div class="absorb-grid-cell absorb-grid-header absorb-grid-corner"></div>
      ${rows.map(r => `<div class="absorb-grid-cell absorb-grid-header" style="color:${r.color}">${escapeHtml(r.label)}</div>`).join('')}
      <!-- Full Absorb row -->
      <div class="absorb-grid-cell absorb-grid-label">
        <span class="ag-strategy">Full Absorb</span>
        <span class="ag-strategy-sub">0% price change</span>
      </div>
      ${rows.map(r => `<div class="absorb-grid-cell absorb-grid-data">
        <span class="ag-primary" style="color:${ppColor(r.marginErosionPp)}">−${r.marginErosionPp.toFixed(1)}pp</span>
        <span class="ag-secondary">${escapeHtml(fmtMoney(r.totalAddedCost))} absorbed</span>
      </div>`).join('')}
      <!-- 50/50 Split row -->
      <div class="absorb-grid-cell absorb-grid-label">
        <span class="ag-strategy">50/50 Split</span>
        <span class="ag-strategy-sub">partial pass-through</span>
      </div>
      ${rows.map(r => `<div class="absorb-grid-cell absorb-grid-data">
        <span class="ag-primary" style="color:${ppColor(r.marginErosionSplit)}">−${r.marginErosionSplit.toFixed(1)}pp</span>
        <span class="ag-secondary">+${r.priceSplitPct.toFixed(1)}% retail price</span>
      </div>`).join('')}
      <!-- Full Pass-Through row -->
      <div class="absorb-grid-cell absorb-grid-label">
        <span class="ag-strategy">Full Pass-Through</span>
        <span class="ag-strategy-sub">margin protected</span>
      </div>
      ${rows.map(r => `<div class="absorb-grid-cell absorb-grid-data">
        <span class="ag-primary" style="color:var(--low)">0pp</span>
        <span class="ag-secondary">+${r.priceIncreasePct.toFixed(1)}% retail price</span>
      </div>`).join('')}
    </div>

    <!-- Section 3: Sourcing Alternatives -->
    <div class="oc-section-label">Sourcing Alternatives</div>
    <p class="oc-section-desc">Estimated P50 impact if you shift production — based on April 2025 effective tariff rates. <strong>Note:</strong> Vietnam &amp; Bangladesh rates reflect 90-day pause (interim 10%); full rates apply at pause expiry.</p>
    <div class="oc-table-wrap">
    <table class="pt-results-table sourcing-table" role="table">
      <thead>
        <tr>
          <th scope="col">Origin</th>
          <th scope="col">Rate (Announced)</th>
          <th scope="col">Status</th>
          <th scope="col">Lead Time</th>
          <th scope="col">Capacity</th>
          <th scope="col">P50 Cost Impact</th>
          <th scope="col">P50 Margin Erosion</th>
        </tr>
      </thead>
      <tbody>
        ${sourcingRows.map((alt, i) => `
          <tr class="${i === 0 ? 'sourcing-row--current' : ''}">
            <td style="font-weight:${i === 0 ? '600' : '400'}">${escapeHtml(alt.origin)}${i === 0 ? ' <span class="current-tag">current</span>' : ''}</td>
            <td style="color:${alt.tariff > 50 ? 'var(--high)' : alt.tariff > 20 ? 'var(--moderate)' : 'var(--low)'}; font-family:var(--font-mono); font-weight:600">${alt.tariff}%</td>
            <td style="font-size:11px;color:var(--text-muted)">${escapeHtml(alt.note || '')}</td>
            <td style="font-family:var(--font-mono); font-size:11px">${escapeHtml(alt.leadDays)}d</td>
            <td>${escapeHtml(alt.capacity)}</td>
            <td style="color:${impactColor(alt.altImpact)}; font-family:var(--font-mono)">${fmt(alt.altImpact)}</td>
            <td style="color:${ppColor(alt.altErosion)}; font-family:var(--font-mono); font-weight:600">${fmtPp(alt.altErosion)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>

    <!-- Section 4: Recommendation -->
    ${recText ? `
    <div class="oc-rec-card">
      <div class="oc-rec-label">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="6"/>
          <path d="M8 5.5v3M8 11h.01"/>
        </svg>
        Buyer Recommendation
      </div>
      <p class="oc-rec-text">${escapeHtml(recText)}</p>
    </div>` : ''}
  `;
}

/* ── Order Commitment: AI LLM Analysis ───────────────────────────────────────── */
async function analyzeOrderCommitment() {
  const btn    = document.getElementById('oc-analyze-btn');
  const aiEl   = document.getElementById('oc-ai-result');
  if (!btn || !aiEl) return;

  const cat       = document.getElementById('oc-category')?.value || 'basics';
  const units     = parseFloat(document.getElementById('oc-units')?.value) || 500;
  const unitCost  = parseFloat(document.getElementById('oc-cost')?.value) || 18;
  const marginPct = parseFloat(document.getElementById('oc-margin')?.value) || 50;
  const budgetRaw = parseFloat(document.getElementById('oc-budget')?.value);
  const budget    = isNaN(budgetRaw) || budgetRaw <= 0 ? units * unitCost : budgetRaw;
  const notes     = (document.getElementById('oc-notes')?.value || '').trim();
  const catLabel  = CATEGORY_META[cat]?.label || cat;

  btn.disabled = true;
  aiEl.style.display = 'block';
  aiEl.innerHTML = `
    <div class="oc-ai-loading">
      <div class="spinner"></div>
      Sending to Claude on AWS Bedrock — analyzing your order…
    </div>`;

  try {
    const impacts  = _costImpacts?.[cat] || { p10: 0, p50: 0, p90: 0 };
    const probs    = _predictions?.scenario_probs || {};
    const margin   = marginPct / 100;
    const totalCOGS = units * unitCost;

    const p50Impact = impacts.p50 || 0;
    const p90Impact = impacts.p90 || 0;
    const p50Erosion = (p50Impact * (1 - margin) * 100).toFixed(1);
    const p90Erosion = (p90Impact * (1 - margin) * 100).toFixed(1);
    const p50AddedCost = fmtMoney(units * unitCost * p50Impact);
    const p90AddedCost = fmtMoney(units * unitCost * p90Impact);
    const days = daysToDeadline();

    const orderContext = [
      `The buyer is analyzing a specific order commitment for the ${catLabel} category.`,
      `Order details: ${units.toLocaleString()} units at ${fmtMoney(unitCost)} unit cost = ${fmtMoney(totalCOGS)} total COGS.`,
      `Current retail margin: ${marginPct}%.`,
      `Season budget: ${fmtMoney(budget)}.`,
      `Days until Spring 2027 commitment deadline: ${days}.`,
      `P50 tariff scenario (${Math.round((probs.p50 || 0)*100)}% probability): +${(p50Impact*100).toFixed(1)}% landed cost impact, ${p50Erosion}pp margin erosion, ${p50AddedCost} added cost.`,
      `P90 tariff scenario (${Math.round((probs.p90 || 0)*100)}% probability): +${(p90Impact*100).toFixed(1)}% landed cost impact, ${p90Erosion}pp margin erosion, ${p90AddedCost} added cost.`,
      notes ? `Buyer notes: ${notes}` : '',
      `Please give a specific, actionable order commitment recommendation for this exact order. `,
      `Include: (1) recommended absorb/pass-through strategy with rationale, (2) the expected margin impact under each strategy for P50 and P90 scenarios, (3) any sourcing or timing actions to take given the deadline, (4) one specific risk the buyer should monitor. Be concise and direct — this is a decision-support tool for a retail merchandise buyer.`,
    ].filter(Boolean).join(' ');

    const body = {
      predictions: _predictions || {},
      cost_impacts: _costImpacts || {},
      alerts: [],
      signals: _signals || {},
      order_context: orderContext,
    };

    const resp = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const rawSummary = (data.summary || '').trim();
    const displayText = (rawSummary && !rawSummary.startsWith('AI analysis temporarily'))
      ? rawSummary
      : buildFallbackOCRecommendation(cat, catLabel, units, unitCost, margin, marginPct, impacts, probs, budget, days, notes);

    aiEl.innerHTML = `
      <div class="oc-ai-card">
        <div class="oc-ai-card-label">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" aria-hidden="true">
            <circle cx="8" cy="8" r="6"/>
            <path d="M8 5v3l2 1"/>
          </svg>
          Claude AI · Order Recommendation
        </div>
        <div class="oc-ai-card-body">${escapeHtml(displayText)}</div>
      </div>`;
  } catch (err) {
    console.warn('OC analyze failed:', err);
    const fallback = buildFallbackOCRecommendation(
      cat,
      CATEGORY_META[cat]?.label || cat,
      units, unitCost,
      marginPct / 100, marginPct,
      _costImpacts?.[cat] || { p10: 0, p50: 0, p90: 0 },
      _predictions?.scenario_probs || {},
      budget,
      daysToDeadline(),
      document.getElementById('oc-notes')?.value || ''
    );
    aiEl.innerHTML = `
      <div class="oc-ai-card">
        <div class="oc-ai-card-label">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12" aria-hidden="true">
            <circle cx="8" cy="8" r="6"/>
            <path d="M8 5v3l2 1"/>
          </svg>
          Recommendation (Offline Mode)
        </div>
        <div class="oc-ai-card-body">${escapeHtml(fallback)}</div>
      </div>`;
  } finally {
    btn.disabled = false;
  }
}

function buildFallbackOCRecommendation(cat, catLabel, units, unitCost, margin, marginPct, impacts, probs, budget, days, notes) {
  const p50Impact  = impacts.p50 || 0;
  const p90Impact  = impacts.p90 || 0;
  const p50Erosion = (p50Impact * (1 - margin) * 100).toFixed(1);
  const p90Erosion = (p90Impact * (1 - margin) * 100).toFixed(1);
  const p50Split   = (p50Erosion / 2);
  const totalCOGS  = units * unitCost;
  const p50Added   = fmtMoney(units * unitCost * p50Impact);
  const daysMsg    = days < 60 ? `With only ${days} days to deadline, time is limited.` : `You have ${days} days until the commitment deadline.`;
  let strategy     = 'Full Absorb';
  let rationale    = `P50 exposure of ${p50Erosion}pp is within the typical 2–3pp tolerance. Absorb and monitor.`;
  if (parseFloat(p90Erosion) > 7) {
    strategy  = '50/50 Split + Sourcing Diversification';
    rationale = `P90 exposure of ${p90Erosion}pp is severe. Split 50% to Vietnam/Bangladesh alternatives and pass through the remaining half. This limits worst-case erosion to ${(p90Erosion / 2).toFixed(1)}pp while keeping retail price increases defensible.`;
  } else if (parseFloat(p50Erosion) > 3.5) {
    strategy  = '50/50 Split Strategy';
    rationale = `P50 erosion of ${p50Erosion}pp exceeds tolerance. A 50/50 split limits margin impact to ${p50Split.toFixed(1)}pp while requiring a modest retail price increase — the most defensible position given documented tariff uncertainty.`;
  }
  return [
    `Category: ${catLabel} | ${units.toLocaleString()} units @ ${fmtMoney(unitCost)} = ${fmtMoney(totalCOGS)} total COGS`,
    ``,
    `Recommended Strategy: ${strategy}`,
    ``,
    rationale,
    ``,
    `P50 scenario impact: +${(p50Impact*100).toFixed(1)}% landed cost → ${p50Erosion}pp margin erosion → ${p50Added} added cost`,
    `P90 scenario impact: +${(p90Impact*100).toFixed(1)}% landed cost → ${p90Erosion}pp margin erosion`,
    ``,
    `${daysMsg} Secure supplier cost-escalation provisions before committing. Monitor Kalshi P90 probability — if it rises above 35%, accelerate Vietnam sourcing negotiations.`,
    notes ? `\nBuyer note considered: ${notes}` : '',
  ].filter(s => s !== null).join('\n');
}

/* ── Render: Summary ─────────────────────────────────────────────────────────── */
function renderSummary(summaryText) {
  const el = document.getElementById('llm-summary');
  if (!el) return;
  if (!summaryText) {
    el.innerHTML = '<p class="error-state">No summary available.</p>';
    return;
  }
  const paragraphs = summaryText.split(/\n\n+/).filter(Boolean);
  el.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
}

/* ── Utilities ───────────────────────────────────────────────────────────────── */
function showError(section, message) {
  const el = document.getElementById(section);
  if (!el) return;
  el.innerHTML = `<div class="error-state"><strong>Unable to load data</strong> — ${escapeHtml(message)}</div>`;
}

/* ── Signal Activity Panel ───────────────────────────────────────────────────── */
function renderSignalPanel(signals) {
  const panel = document.getElementById('signal-panel');
  if (!panel || !signals || !signals.signal_score) return;

  const score   = signals.signal_score || 0;
  const sent    = signals.sentiment    || 0;
  const vel     = (signals.velocity   || 'stable').toLowerCase();
  const counts  = signals.source_counts || {};
  const top     = signals.top_signals  || [];

  // Score badge
  const scoreEl = document.getElementById('signal-score-val');
  if (scoreEl) scoreEl.textContent = Math.round(score * 100) + '%';

  // Bar fill
  const barEl = document.getElementById('signal-bar-fill');
  if (barEl) barEl.style.width = Math.round(score * 100) + '%';

  // Velocity chip
  const velEl = document.getElementById('signal-velocity-val');
  if (velEl) {
    const icon = vel === 'rising' ? '↑' : vel === 'falling' ? '↓' : '→';
    velEl.textContent = icon + ' ' + vel.charAt(0).toUpperCase() + vel.slice(1);
    velEl.className = `signal-stat-val velocity-chip ${vel}`;
  }

  // Sentiment chip
  const sentEl = document.getElementById('signal-sentiment-val');
  if (sentEl) {
    const sentClass = sent > 0.2 ? 'escalation' : sent < -0.2 ? 'deescalation' : 'neutral';
    const sentLabel = sent > 0.2 ? 'Escalating' : sent < -0.2 ? 'De-escalating' : 'Neutral';
    sentEl.textContent = sentLabel;
    sentEl.className = `signal-stat-val sentiment-chip ${sentClass}`;
  }

  // Source counts
  const newsEl   = document.getElementById('signal-count-news');
  const tweetEl  = document.getElementById('signal-count-tweets');
  const eoEl     = document.getElementById('signal-count-eo');
  if (newsEl)  newsEl.textContent  = counts.news            || '0';
  if (tweetEl) tweetEl.textContent = counts.tweet           || '0';
  if (eoEl)    eoEl.textContent    = counts.executive_order || '0';

  // Top signals list
  const listEl = document.getElementById('signal-top-list');
  if (listEl) {
    if (top.length === 0) {
      listEl.innerHTML = '<p class="signal-top-title" style="color:var(--text-muted);padding:8px 0">No signal items collected yet.</p>';
    } else {
      listEl.innerHTML = top.slice(0, 5).map(s => {
        const typeClass = s.source_type === 'executive_order' ? 'eo' : s.source_type === 'tweet' ? 'tweet' : 'news';
        const typeLabel = s.source_type === 'executive_order' ? 'EO' : s.source_type === 'tweet' ? 'X/Twitter' : 'News';
        return `<div class="signal-top-item ${typeClass}">
          <span class="signal-top-source">${escapeHtml(typeLabel)}</span>
          <span class="signal-top-title">${escapeHtml(s.title || '')}</span>
        </div>`;
      }).join('');
    }
  }
}

function updateTimestamp(iso) {
  const el = document.getElementById('last-updated');
  const ft = document.getElementById('footer-ts');
  const formatted = fmtTimestamp(iso) || new Date().toLocaleString();
  if (el) el.textContent = `Updated ${formatted}`;
  if (ft) ft.textContent = formatted;
}

/* ── Main data flow ──────────────────────────────────────────────────────────── */
async function loadDashboard() {
  let tradeData = null;
  let isDemo = false;

  // ── Step 1: Fetch predictions from policy_predictor Lambda ───────────────
  try {
    const resp = await fetch(`${API_BASE}/trade-data`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    tradeData = await resp.json();
    showToast('Live AI predictions loaded', 'success', 3000);
  } catch (err) {
    console.warn('Trade data fetch failed — using demo data:', err);
    tradeData = DEMO_DATA;
    isDemo = true;
    showToast('Using demo data — connect AWS for live predictions', 'warn', 6000);
  }

  _signals = tradeData.signals || null;

  renderFeaturedContracts(tradeData.predictions || {}, tradeData.cost_impacts || {});
  renderCategoryCards(tradeData.cost_impacts || {});
  makeCardsClickable();
  renderPolicyTracker(tradeData.policy_status || []);
  renderAlerts(tradeData.alerts || []);
  renderOrderCommitment(tradeData.cost_impacts || {}, tradeData.predictions || {});
  renderPredictionsPanel(
    tradeData.predictions || {},
    tradeData.news_headlines || [],
    tradeData.has_live_news || false
  );
  renderScenarioChart(tradeData.predictions || {});
  renderCategoryChart(tradeData.cost_impacts || {});
  renderDecisionBanner(tradeData.predictions || {}, tradeData.cost_impacts || {});
  renderKPICards(tradeData.cost_impacts || {}, tradeData.predictions || {});
  renderSignalPanel(_signals);
  updateTimestamp(tradeData.timestamp);

  // ── Step 1b: Set risk gauge immediately from prediction probabilities ────
  // Don't wait for the AI call — derive risk from p90 severity weight
  {
    const probs = (tradeData.predictions || {}).scenario_probs || {};
    const p90 = probs.p90 || 0;
    const p50 = probs.p50 || 0;
    const immediateRisk = p90 >= 0.30 ? 'severe' : p90 >= 0.20 ? 'high' : p50 >= 0.50 ? 'moderate' : 'low';
    updateRiskMeter(immediateRisk);
  }

  // ── Step 2: LLM analysis via Bedrock Analyzer ────────────────────────────
  let riskLevel = 'unknown';
  if (!isDemo) {
    try {
      const body = {
        predictions: tradeData.predictions || {},
        cost_impacts: tradeData.cost_impacts || {},
        alerts: tradeData.alerts || [],
        signals: tradeData.signals || {},
      };
      const analyzeResp = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!analyzeResp.ok) throw new Error(`HTTP ${analyzeResp.status}`);
      const analyzeData = await analyzeResp.json();

      const aiRisk = analyzeData.risk_level;
      riskLevel = ['low','moderate','high','severe'].includes(aiRisk) ? aiRisk : riskLevel;
      // If Bedrock fell back internally, generate a data-driven summary instead of the static placeholder
      const summaryText = (analyzeData.summary || '').startsWith('AI analysis temporarily')
        ? generateFallbackAnalysis(tradeData.predictions, tradeData.cost_impacts)
        : analyzeData.summary;
      renderSummary(summaryText);
      if (['low','moderate','high','severe'].includes(aiRisk)) updateRiskMeter(riskLevel);
      renderRecommendations(analyzeData.recommendations || []);
    } catch (err) {
      console.warn('Analysis fetch failed:', err);
      riskLevel = 'high';
      renderSummary(generateFallbackAnalysis(tradeData.predictions, tradeData.cost_impacts));
      updateRiskMeter(riskLevel);
    }
  } else {
    riskLevel = 'high';
    renderSummary(generateFallbackAnalysis(tradeData.predictions, tradeData.cost_impacts));
    updateRiskMeter(riskLevel);
    renderRecommendations([
      'Audit China-sourced inventory across all 6 categories and quantify P50 cost impact as a share of gross margin before committing.',
      'Model Vietnam and Bangladesh orders under BOTH pause-active (10%) and pause-expired (46%/37%) scenarios — do not assume the pause renews.',
      'Negotiate price-escalation provisions with suppliers tied to published tariff rate changes before signing Spring 2027 purchase orders.',
    ]);
  }

  // ── Step 3: Render risk statement hero with final risk level ─────────────
  renderRiskStatement(tradeData.predictions || {}, tradeData.cost_impacts || {}, riskLevel);
}

/* ── Order commitment live input listeners ───────────────────────────────────── */
function initOrderCommitmentListeners() {
  ['oc-category', 'oc-units', 'oc-cost', 'oc-margin', 'oc-budget'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateOrderCommitmentResults);
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  chartDefaults();
  initTabs();
  initOrderCommitmentListeners();
  initMethodologyModal();
  initContractCall();
  renderDecisionBanner({}, null); // show deadline days immediately
  loadDashboard();
});
