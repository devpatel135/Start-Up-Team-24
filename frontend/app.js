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

/* ── Sourcing alternatives (hardcoded for prototype) ─────────────────────────── */
const SOURCING_ALTS = [
  { origin: 'China (current)',  tariff: 145, leadDays: '90–120', capacity: 'High',     tariffFactor: 1.000 },
  { origin: 'Vietnam',          tariff: 46,  leadDays: '75–90',  capacity: 'Med-High', tariffFactor: 0.317 },
  { origin: 'Bangladesh',       tariff: 15.3,leadDays: '90–105', capacity: 'Medium',   tariffFactor: 0.106 },
  { origin: 'Mexico (USMCA)',   tariff: 0,   leadDays: '30–45',  capacity: 'Low-Med',  tariffFactor: 0.000 },
];

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
    card.className = 'category-card';
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
    <div class="oc-table-wrap">
    <table class="pt-results-table absorb-matrix" role="table">
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col">Full Absorb <span class="th-sub">0% price change</span></th>
          <th scope="col">50/50 Split <span class="th-sub">partial pass-through</span></th>
          <th scope="col">Full Pass-Through <span class="th-sub">margin protected</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="color:${r.color};font-weight:600">${escapeHtml(r.label)}</td>
            <td class="absorb-cell">
              <span class="absorb-erosion" style="color:${ppColor(r.marginErosionPp)}">−${r.marginErosionPp.toFixed(1)}pp margin</span>
              <span class="absorb-sub">${escapeHtml(fmtMoney(r.totalAddedCost))} absorbed</span>
            </td>
            <td class="absorb-cell">
              <span class="absorb-erosion" style="color:${ppColor(r.marginErosionSplit)}">−${r.marginErosionSplit.toFixed(1)}pp margin</span>
              <span class="absorb-sub">+${r.priceSplitPct.toFixed(1)}% retail price</span>
            </td>
            <td class="absorb-cell">
              <span class="absorb-erosion" style="color:var(--low)">0pp margin erosion</span>
              <span class="absorb-sub">+${r.priceIncreasePct.toFixed(1)}% retail price</span>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>

    <!-- Section 3: Sourcing Alternatives -->
    <div class="oc-section-label">Sourcing Alternatives</div>
    <p class="oc-section-desc">Estimated P50 impact if you shift production — based on current effective tariff rates.</p>
    <div class="oc-table-wrap">
    <table class="pt-results-table sourcing-table" role="table">
      <thead>
        <tr>
          <th scope="col">Origin</th>
          <th scope="col">Effective Tariff</th>
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

  // ── Step 1: Fetch predictions from policy_predictor Lambda ───────────────
  try {
    const resp = await fetch(`${API_BASE}/trade-data`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    tradeData = await resp.json();

    renderCategoryCards(tradeData.cost_impacts || {});
    renderPolicyTracker(tradeData.policy_status || []);
    renderAlerts(tradeData.alerts || []);
    renderOrderCommitment(tradeData.cost_impacts || {}, tradeData.predictions || {});
    renderPredictionsPanel(
      tradeData.predictions || {},
      tradeData.news_headlines || [],
      tradeData.has_live_news || false
    );
    renderDecisionBanner(tradeData.predictions || {}, tradeData.cost_impacts || {});
    renderKPICards(tradeData.cost_impacts || {}, tradeData.predictions || {});
    updateTimestamp(tradeData.timestamp);

  } catch (err) {
    console.error('Trade data fetch failed:', err);
    showError('category-grid', 'Could not reach the trade data service.');
    showError('predictions-panel', 'Trade data unavailable.');
    renderDecisionBanner({}, null);
    updateTimestamp(null);
  }

  // ── Step 2: LLM analysis via Bedrock Analyzer ────────────────────────────
  try {
    const body = tradeData
      ? {
          predictions: tradeData.predictions || {},
          cost_impacts: tradeData.cost_impacts || {},
          alerts: tradeData.alerts || [],
        }
      : { predictions: {}, cost_impacts: {}, alerts: [] };

    const analyzeResp = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!analyzeResp.ok) throw new Error(`HTTP ${analyzeResp.status}`);
    const analyzeData = await analyzeResp.json();

    renderSummary(analyzeData.summary);
    updateRiskMeter(analyzeData.risk_level || 'unknown');
    renderRecommendations(analyzeData.recommendations || []);

  } catch (err) {
    console.error('Analysis fetch failed:', err);
    showError('llm-summary', 'AI analysis unavailable.');
    updateRiskMeter('unknown');
  }
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
  initTabs();
  initOrderCommitmentListeners();
  renderDecisionBanner({}, null); // show deadline days immediately
  loadDashboard();
});
