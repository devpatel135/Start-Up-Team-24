'use strict';

/* ── Config ─────────────────────────────────────────────────────────────────── */
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';

/* ── Category metadata ───────────────────────────────────────────────────────── */
const CATEGORY_META = {
  basics:      { label: 'Basics',      sourcing: '72% China-sourced', icon: '<path d="M4 7l8-4 8 4v2l-2 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1v-7L4 9V7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  denim:       { label: 'Denim',       sourcing: '45% China-sourced', icon: '<path d="M5 4h14l-2 7H7L5 4z M7 11l1 9M17 11l-1 9M8 20h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  outerwear:   { label: 'Outerwear',   sourcing: '58% China-sourced', icon: '<path d="M4 7c0 0 2-3 5-3h6c3 0 5 3 5 3l1 11H3L4 7z M9 4l-1 7M15 4l1 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  footwear:    { label: 'Footwear',    sourcing: '65% China-sourced', icon: '<path d="M3 17c0 0 2-8 6-9 2-.5 4 0 6 2l3 3v4H3v-4z M9 8c0-2 1-4 3-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  accessories: { label: 'Accessories', sourcing: '68% China-sourced', icon: '<rect x="5" y="8" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 8V7a3 3 0 016 0v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  activewear:  { label: 'Activewear',  sourcing: '55% China-sourced', icon: '<path d="M13 3l5 9H6l5-9M11 12v9M13 12v9M9 21h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
};

const GAUGE_ARC_LENGTH = 219;

const RISK_CONFIG = {
  low:      { fill: 0.25, color: '#10b981', label: 'Low'      },
  moderate: { fill: 0.50, color: '#f59e0b', label: 'Moderate' },
  high:     { fill: 0.75, color: '#f43f5e', label: 'High'     },
  severe:   { fill: 1.00, color: '#dc2626', label: 'Severe'   },
  unknown:  { fill: 0,    color: '#3a4a68', label: '—'        },
};

/* ── Module-level state for price tool ──────────────────────────────────────── */
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

function impactColor(pct) {
  if (pct < 0.02) return 'var(--low)';
  if (pct < 0.05) return 'var(--moderate)';
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
      if (target === 'price-tool') updatePriceToolResults();
    });
  });
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
          <span class="scenario-delta" style="color:${s.color}">+${delta.toFixed(0)}pp</span>
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

  // Mark live dot
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

  const icon = { critical: '🔴', warning: '🟡', info: '🔵' };
  const cls  = { critical: 'alert-card--critical', warning: 'alert-card--warning', info: 'alert-card--info' };

  list.innerHTML = alerts.map(a => `
    <div class="alert-card ${cls[a.severity] || ''}">
      <div class="alert-header">
        <span class="alert-icon">${icon[a.severity] || '🔵'}</span>
        <strong class="alert-title">${escapeHtml(a.title || '')}</strong>
        <span class="alert-category">${escapeHtml(a.category || '')}</span>
      </div>
      <p class="alert-detail">${escapeHtml(a.detail || '')}</p>
    </div>`).join('');

  // Update badge
  const badge = document.getElementById('alert-badge');
  const critical = alerts.filter(a => a.severity === 'critical').length;
  if (badge) {
    badge.textContent = critical > 0 ? critical : alerts.length;
    badge.style.display = alerts.length > 0 ? '' : 'none';
    badge.className = 'alert-badge' + (critical > 0 ? ' alert-badge--critical' : '');
  }
}

/* ── Render: Price Tool ──────────────────────────────────────────────────────── */
function renderPriceTool(costImpacts, predictions) {
  _costImpacts = costImpacts;
  _predictions = predictions;
  updatePriceToolResults();
}

function updatePriceToolResults() {
  const resultsEl = document.getElementById('pt-results');
  if (!resultsEl) return;

  if (!_costImpacts || !_predictions) {
    resultsEl.innerHTML = '<p class="pt-baseline">Load dashboard data first.</p>';
    return;
  }

  const cat     = document.getElementById('pt-category')?.value || 'basics';
  const units   = parseFloat(document.getElementById('pt-units')?.value) || 500;
  const unitCost = parseFloat(document.getElementById('pt-cost')?.value) || 18;
  const margin  = parseFloat(document.getElementById('pt-margin')?.value) / 100 || 0.5;

  const impacts = _costImpacts[cat] || { p10: 0, p50: 0, p90: 0 };
  const currentRetail = unitCost / (1 - margin);

  const rows = ['p10', 'p50', 'p90'].map(s => {
    const impact = impacts[s] || 0;
    const addedCostPerUnit  = unitCost * impact;
    const newUnitCost       = unitCost + addedCostPerUnit;
    const totalAddedCost    = units * addedCostPerUnit;
    const newRetail         = newUnitCost / (1 - margin);
    const priceIncrease     = newRetail - currentRetail;
    const label = { p10: 'Optimistic', p50: 'Moderate', p90: 'Severe' }[s];
    const color = { p10: 'var(--low)', p50: 'var(--moderate)', p90: 'var(--high)' }[s];
    return { s, label, color, addedCostPerUnit, totalAddedCost, newRetail, priceIncrease, impact };
  });

  resultsEl.innerHTML = `
    <div class="pt-baseline-row">
      <span>Current unit cost: <strong>${fmtMoney(unitCost)}</strong></span>
      <span>Current retail: <strong>${fmtMoney(currentRetail)}</strong></span>
      <span>Order size: <strong>${units.toLocaleString()} units</strong></span>
    </div>
    <table class="pt-results-table" role="table">
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col">Cost Impact</th>
          <th scope="col">Added Cost/Unit</th>
          <th scope="col">Total Added Cost</th>
          <th scope="col">New Retail</th>
          <th scope="col">Price Increase</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="color:${r.color};font-weight:600">${escapeHtml(r.label)}</td>
            <td style="color:${r.color}">${fmt(r.impact)}</td>
            <td>${fmtMoney(r.addedCostPerUnit)}</td>
            <td style="color:${r.color};font-weight:600">${fmtMoney(r.totalAddedCost)}</td>
            <td>${fmtMoney(r.newRetail)}</td>
            <td style="color:${r.color}">${fmtMoney(r.priceIncrease)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
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
    renderPriceTool(tradeData.cost_impacts || {}, tradeData.predictions || {});
    renderPredictionsPanel(
      tradeData.predictions || {},
      tradeData.news_headlines || [],
      tradeData.has_live_news || false
    );
    updateTimestamp(tradeData.timestamp);

  } catch (err) {
    console.error('Trade data fetch failed:', err);
    showError('category-grid', 'Could not reach the trade data service.');
    showError('predictions-panel', 'Trade data unavailable.');
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

/* ── Price tool live inputs ──────────────────────────────────────────────────── */
function initPriceToolListeners() {
  ['pt-category', 'pt-units', 'pt-cost', 'pt-margin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePriceToolResults);
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initPriceToolListeners();
  loadDashboard();
});
