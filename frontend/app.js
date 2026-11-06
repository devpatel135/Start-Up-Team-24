'use strict';

/* ── Config ─────────────────────────────────────────────────────────────────── */
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';

/* ── SVG icon paths per category ────────────────────────────────────────────── */
const CATEGORY_META = {
  basics:      { label: 'Basics',      sourcing: '72% China-sourced', icon: '<path d="M4 7l8-4 8 4v2l-2 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1v-7L4 9V7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  denim:       { label: 'Denim',       sourcing: '45% China-sourced', icon: '<path d="M5 4h14l-2 7H7L5 4z M7 11l1 9M17 11l-1 9M8 20h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  outerwear:   { label: 'Outerwear',   sourcing: '58% China-sourced', icon: '<path d="M4 7c0 0 2-3 5-3h6c3 0 5 3 5 3l1 11H3L4 7z M9 4l-1 7M15 4l1 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  footwear:    { label: 'Footwear',    sourcing: '65% China-sourced', icon: '<path d="M3 17c0 0 2-8 6-9 2-.5 4 0 6 2l3 3v4H3v-4z M9 8c0-2 1-4 3-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  accessories: { label: 'Accessories', sourcing: '68% China-sourced', icon: '<rect x="5" y="8" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 8V7a3 3 0 016 0v1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
  activewear:  { label: 'Activewear',  sourcing: '55% China-sourced', icon: '<path d="M13 3l5 9H6l5-9M11 12v9M13 12v9M9 21h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' },
};

/* ── Gauge arc (270°, clockwise from bottom-left) ───────────────────────────── */
const GAUGE_ARC_LENGTH = 219; // length of the 270° arc path in SVG units

const RISK_CONFIG = {
  low:      { fill: 0.25, color: '#10b981', label: 'Low'      },
  moderate: { fill: 0.50, color: '#f59e0b', label: 'Moderate' },
  high:     { fill: 0.75, color: '#f43f5e', label: 'High'     },
  severe:   { fill: 1.00, color: '#dc2626', label: 'Severe'   },
  unknown:  { fill: 0,    color: '#3a4a68', label: '—'        },
};

/* ── Utilities ──────────────────────────────────────────────────────────────── */
function impactColor(pct) {
  if (pct < 0.02) return 'var(--low)';
  if (pct < 0.05) return 'var(--moderate)';
  return 'var(--high)';
}

function impactAccent(pct) {
  if (pct < 0.02) return 'var(--low)';
  if (pct < 0.05) return 'var(--moderate)';
  return 'var(--high)';
}

function fmt(pct) {
  if (pct === 0) return '0.0%';
  return (pct * 100).toFixed(1) + '%';
}

function daysUntil(isoStr) {
  if (!isoStr) return '—';
  const diff = new Date(isoStr) - Date.now();
  const days = Math.round(diff / 86400000);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  return days + 'd';
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

/* ── Render: Risk Gauge ─────────────────────────────────────────────────────── */
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

  // Highlight matching legend chip
  document.querySelectorAll('.legend-item').forEach(el => {
    el.style.opacity = el.classList.contains(`legend-item--${riskLevel}`) ? '1' : '0.3';
  });
}

/* ── Render: Category Cards ─────────────────────────────────────────────────── */
function renderCategoryCards(costImpacts) {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    const impacts = costImpacts[cat] || { p10: 0, p50: 0, p90: 0 };
    const p50 = impacts.p50 || 0;
    const accent = impactAccent(p50);
    const maxPct = Math.max(impacts.p90 || 0, 0.08); // scale bars to max 8% or actual

    const card = document.createElement('div');
    card.className = 'category-card';
    card.style.setProperty('--card-accent', accent);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${meta.icon}</svg>
        </div>
        <div>
          <div class="card-name">${meta.label}</div>
          <div class="card-sourcing">${meta.sourcing}</div>
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
                <div class="impact-bar-fill" style="width:${barWidth}%; --bar-color:${color}"></div>
              </div>
              <span class="impact-pct" style="--pct-color:${color}">${fmt(val)}</span>
            </div>`;
        }).join('')}
      </div>`;

    grid.appendChild(card);
  }
}

/* ── Render: Kalshi Feed ────────────────────────────────────────────────────── */
function renderKalshiFeed(markets) {
  const list = document.getElementById('market-list');
  const note = document.getElementById('market-note');
  if (!list) return;
  list.innerHTML = '';

  if (!markets || markets.length === 0) {
    list.innerHTML = '<div class="market-empty">No trade-related markets found on Kalshi at this time.</div>';
    if (note) note.textContent = 'Markets refresh on page load.';
    return;
  }

  markets.slice(0, 8).forEach(market => {
    const prob = typeof market.yes_price === 'number' ? market.yes_price : 0.5;
    const probPct = Math.round(prob * 100);
    const days = daysUntil(market.expiry);

    const item = document.createElement('div');
    item.className = 'market-item';
    item.innerHTML = `
      <div class="market-title">${escapeHtml(market.title || market.id)}</div>
      <div class="market-meta">
        <span class="market-prob">${probPct}% <span style="font-size:10px;color:var(--text-muted)">YES</span></span>
        <span class="market-expiry">Expires in ${days}</span>
      </div>
      <div class="prob-track">
        <div class="prob-fill" style="width:${probPct}%"></div>
      </div>`;
    list.appendChild(item);
  });

  if (note) {
    note.textContent = `${markets.length} market${markets.length !== 1 ? 's' : ''} matched · refreshes on reload`;
  }

  // Live indicator
  const dot = document.getElementById('live-dot');
  if (dot) dot.classList.add('live');
}

/* ── Render: Price Impact Table ─────────────────────────────────────────────── */
function renderPriceTable(costImpacts) {
  const wrap = document.getElementById('price-table-wrap');
  if (!wrap) return;

  const rows = Object.entries(CATEGORY_META).map(([cat, meta]) => {
    const p50 = (costImpacts[cat] || {}).p50 || 0;
    // If absorbed: margin erosion = p50 impact directly
    // If passed through: price increase = p50 / (1 - margin); assume 50% retail margin
    const marginAtRisk = p50;
    const priceIncrease = p50 / 0.50;
    const accent = impactAccent(p50);
    return { cat, meta, p50, marginAtRisk, priceIncrease, accent };
  });

  wrap.innerHTML = `
    <table class="price-table" role="table">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">P50 Cost Impact</th>
          <th scope="col">Margin at Risk</th>
          <th scope="col">Price ↑ to Pass Through</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              <div class="td-category">
                <span class="td-dot" style="background:${r.accent}"></span>
                ${r.meta.label}
              </div>
            </td>
            <td class="td-number" style="color:${r.accent}">${fmt(r.p50 || 0)}</td>
            <td class="td-number at-risk">${fmt(r.marginAtRisk)}</td>
            <td class="td-number pass-through">${fmt(r.priceIncrease)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  function fmt(v) {
    return (v === undefined || v === null) ? '—' : (v * 100).toFixed(1) + '%';
  }
}

/* ── Render: LLM Summary ────────────────────────────────────────────────────── */
function renderSummary(summaryText) {
  const el = document.getElementById('llm-summary');
  if (!el) return;
  if (!summaryText) {
    el.innerHTML = '<p class="error-state">No summary available.</p>';
    return;
  }

  // Split on double newline for two paragraphs
  const paragraphs = summaryText.split(/\n\n+/).filter(Boolean);
  el.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
}

/* ── XSS safety ─────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Error state ────────────────────────────────────────────────────────────── */
function showError(section, message) {
  const el = document.getElementById(section);
  if (!el) return;
  el.innerHTML = `<div class="error-state"><strong>Unable to load data</strong>${escapeHtml(message)}</div>`;
}

/* ── Timestamp ──────────────────────────────────────────────────────────────── */
function updateTimestamp(iso) {
  const el = document.getElementById('last-updated');
  const ft = document.getElementById('footer-ts');
  const formatted = fmtTimestamp(iso) || new Date().toLocaleString();
  if (el) el.textContent = `Updated ${formatted}`;
  if (ft) ft.textContent = formatted;
}

/* ── Main data flow ─────────────────────────────────────────────────────────── */
async function loadDashboard() {
  let tradeData = null;

  // ── Step 1: Fetch trade data (Kalshi + cost model) ────────────────────────
  try {
    const resp = await fetch(`${API_BASE}/trade-data`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    tradeData = await resp.json();

    renderCategoryCards(tradeData.cost_impacts || {});
    renderKalshiFeed(tradeData.markets || []);
    updateTimestamp(tradeData.timestamp);
    if (tradeData.simulated) {
      const badge = document.getElementById('demo-badge');
      const liveChip = document.getElementById('live-chip');
      if (badge) badge.style.display = '';
      if (liveChip) liveChip.style.display = 'none';
    }

  } catch (err) {
    console.error('Trade data fetch failed:', err);
    showError('category-grid', 'Could not reach the trade data service. Check API endpoint.');
    showError('market-list', 'Kalshi market data unavailable.');
    renderCategoryCards({});
    updateTimestamp(null);
  }

  // ── Step 2: LLM analysis via Bedrock ─────────────────────────────────────
  try {
    const body = tradeData
      ? { markets: tradeData.markets || [], cost_impacts: tradeData.cost_impacts || {} }
      : { markets: [], cost_impacts: {} };

    const analyzeResp = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!analyzeResp.ok) throw new Error(`HTTP ${analyzeResp.status}`);
    const analyzeData = await analyzeResp.json();

    renderSummary(analyzeData.summary);
    updateRiskMeter(analyzeData.risk_level || 'unknown');
    if (tradeData) renderPriceTable(tradeData.cost_impacts || {});

  } catch (err) {
    console.error('Analysis fetch failed:', err);
    showError('llm-summary', 'AI analysis unavailable. Review Kalshi market data directly.');
    updateRiskMeter('unknown');
    if (tradeData) renderPriceTable(tradeData.cost_impacts || {});
  }
}

/* ── Boot ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', loadDashboard);
