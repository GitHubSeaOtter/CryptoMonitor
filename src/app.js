import { COINS, ticker, dailyHistory, intradayHistory, chartHistory } from './api.js';

const $ = id => document.getElementById(id);
const PERIODS = [
  { label: '1日', days: 1 }, { label: '1週間', days: 7 }, { label: '1ヶ月', days: 30 },
  { label: '3ヶ月', days: 90 }, { label: '6ヶ月', days: 180 }, { label: '1年', days: 365 },
];
const FRAMES = [
  { id: '1min', label: '分足', color: '#50e0b7' }, { id: '1hour', label: '時間足', color: '#6daeff' },
  { id: '1day', label: '日足', color: '#eacb75' }, { id: '1week', label: '週足', color: '#c39af6' },
  { id: '1month', label: '月足', color: '#fa9b9d' },
];
const state = { period: 1, coin: COINS[0], frames: new Set(['1day']), market: new Map(), series: new Map(), offset: 0, zoom: 1, cross: null, zeroBase: false, view: 'market' };
const yen = value => `¥${Number(value).toLocaleString('ja-JP', { maximumFractionDigits: value < 1 ? 4 : value < 100 ? 2 : 0 })}`;
const percent = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const dateLabel = time => new Date(time).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = time => new Date(time).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

function show(view) {
  state.view = view;
  $('marketView').hidden = view !== 'market';
  $('chartView').hidden = view !== 'chart';
  $('marketTab').classList.toggle('active', view === 'market');
  $('chartTab').classList.toggle('active', view === 'chart');
  $('marketTab').toggleAttribute('aria-current', view === 'market');
  $('chartTab').toggleAttribute('aria-current', view === 'chart');
  if (view === 'chart') requestAnimationFrame(drawChart);
}

function lineSvg(points, positive) {
  if (points.length < 2) return '<svg class="spark" viewBox="0 0 90 40" aria-hidden="true"></svg>';
  const lo = Math.min(...points), hi = Math.max(...points), range = hi - lo || 1;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1) * 90).toFixed(1)},${(36 - (p - lo) / range * 32).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 90 40" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="${positive ? '#50e0b7' : '#f1898b'}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderPeriods() {
  $('listPeriods').innerHTML = PERIODS.map((period, index) => `<button type="button" data-period="${index}" class="${index === state.period ? 'selected' : ''}" aria-pressed="${index === state.period}">${period.label}</button>`).join('');
}

function historyForPeriod(record) {
  const days = PERIODS[state.period].days;
  const points = days === 1 ? (record.hourly || record.daily || []) : (record.daily || []);
  const from = Date.now() - days * 86_400_000;
  const recent = points.filter(c => c.time >= from);
  const base = points.filter(c => c.time < from).at(-1)?.close ?? recent[0]?.open;
  return { recent, base };
}

function renderMarket() {
  const rows = COINS.map(coin => {
    const record = state.market.get(coin.pair) || {};
    const { recent, base } = historyForPeriod(record);
    const price = record.price ?? recent.at(-1)?.close;
    const change = price != null && base ? (price / base - 1) * 100 : null;
    return { coin, recent, price, change, error: record.error };
  }).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  $('coinList').innerHTML = rows.map(({ coin, recent, price, change, error }) => `
    <button class="coin-row" data-pair="${coin.pair}" aria-label="${coin.symbol} のチャートを開く">
      <span class="coin-identity"><span class="coin-icon" style="background:${coin.color}24;color:${coin.color}">${coin.mark}</span><span><span class="coin-name">${coin.symbol}</span><span class="coin-sub">${coin.name}</span></span></span>
      ${lineSvg([...recent.map(c => c.close), ...(price != null ? [price] : [])], change == null || change >= 0)}
      <span class="coin-numbers"><span class="coin-price">${price == null ? '—' : yen(price)}</span><br><span class="coin-change ${change == null ? 'muted' : change >= 0 ? 'up' : 'down'}">${change == null ? error ? '取得失敗' : '読込中' : percent(change)}</span></span>
    </button>`).join('');
  const available = rows.filter(row => row.price != null).length;
  $('connection').textContent = available ? '接続中' : '未接続';
  $('connection').classList.toggle('offline', !available);
  if (state.view === 'chart') { renderChartHeading(); drawChart(); }
}

function renderChartHeading() {
  const market = state.market.get(state.coin.pair);
  $('chartTitle').textContent = `${state.coin.symbol} / JPY`;
  $('chartCurrent').textContent = market?.price == null ? '—' : yen(market.price);
  const base = historyForPeriod(market || {}).base;
  const change = market?.price != null && base ? (market.price / base - 1) * 100 : null;
  $('chartChange').textContent = change == null ? '—' : `${PERIODS[state.period].label} ${percent(change)}`;
  $('chartChange').className = change == null ? 'muted' : change >= 0 ? 'up' : 'down';
}

let marketRequest = 0;
async function loadMarket(force = false) {
  const requestId = ++marketRequest;
  $('marketError').hidden = true;
  if (force) state.market.clear();
  renderMarket();
  await Promise.all(COINS.map(async coin => {
    const previous = state.market.get(coin.pair) || {};
    const settled = await Promise.allSettled([
      ticker(coin.pair), dailyHistory(coin.pair), intradayHistory(coin.pair, '1hour', 2),
    ]);
    if (requestId !== marketRequest) return;
    const next = { ...previous };
    if (settled[0].status === 'fulfilled') next.price = settled[0].value.price;
    if (settled[1].status === 'fulfilled') next.daily = settled[1].value;
    if (settled[2].status === 'fulfilled') next.hourly = settled[2].value;
    if (settled.every(result => result.status === 'rejected')) next.error = true;
    state.market.set(coin.pair, next);
    renderMarket();
  }));
  if (requestId !== marketRequest) return;
  const count = [...state.market.values()].filter(v => v.price != null).length;
  $('updatedAt').textContent = count ? `${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 更新` : '取得できませんでした';
  if (!count) { $('marketError').textContent = 'Bitbankに接続できません。ネットワーク接続を確認して更新してください。'; $('marketError').hidden = false; }
}

function renderFrames() {
  $('timeframes').innerHTML = FRAMES.map(frame => `<button type="button" data-frame="${frame.id}" class="${state.frames.has(frame.id) ? 'selected' : ''}" style="--frame-color:${frame.color}" aria-pressed="${state.frames.has(frame.id)}">${frame.label}</button>`).join('');
}

async function openCoin(coin) {
  state.coin = coin; state.series.clear(); state.offset = 0; state.zoom = 1; state.cross = null;
  renderChartHeading();
  show('chart');
  loadChart();
}

let chartRequest = 0;
async function loadChart() {
  const id = ++chartRequest;
  const pair = state.coin.pair;
  $('chartError').hidden = true;
  drawChart();
  await Promise.all([...state.frames].map(async frame => {
    try {
      const data = await chartHistory(pair, frame);
      if (id !== chartRequest || pair !== state.coin.pair) return;
      state.series.set(frame, data);
    } catch (error) {
      if (id !== chartRequest) return;
      state.series.delete(frame);
    }
    drawChart();
  }));
  if (id !== chartRequest) return;
  if (![...state.frames].some(frame => state.series.get(frame)?.length)) {
    $('chartError').textContent = '選択した足データを取得できません。接続を確認して、別の足を選択してください。';
    $('chartError').hidden = false;
  }
}

const canvas = $('chartCanvas');
const ctx = canvas.getContext('2d');
function drawChart() {
  if (state.view !== 'chart') return;
  const box = canvas.getBoundingClientRect();
  const w = box.width, h = box.height;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = 14, right = w - 68, top = 20, bottom = h - 36, plotH = bottom - top, plotW = right - left;
  const candleRight = right - 18;
  const selected = FRAMES.filter(f => state.frames.has(f.id) && state.series.get(f.id)?.length);
  if (!selected.length) { ctx.fillStyle = '#829fa3'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('チャートを読み込み中…', w / 2, h / 2); return; }
  const windows = selected.map(frame => {
    const rows = state.series.get(frame.id);
    const count = Math.max(12, Math.round(Math.min(rows.length, 46) / state.zoom));
    const end = Math.max(1, rows.length - Math.round(state.offset));
    return { frame, rows: rows.slice(Math.max(0, end - count), end), count };
  });
  const all = windows.flatMap(v => v.rows);
  const live = state.market.get(state.coin.pair)?.price ?? all.at(-1)?.close ?? 0;
  let lo = state.zeroBase ? 0 : Math.min(...all.map(v => v.low), live);
  let hi = Math.max(...all.map(v => v.high), live);
  const padding = state.zeroBase ? hi * .06 : Math.max((hi - lo) * .15, live * .001);
  if (!state.zeroBase) lo = Math.max(0, lo - padding);
  hi += padding;
  const y = price => bottom - ((price - lo) / (hi - lo || 1)) * plotH;
  ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const py = top + i * plotH / 4;
    ctx.strokeStyle = '#25414a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
    ctx.fillStyle = '#89a6aa'; ctx.fillText(yen(hi - i * (hi - lo) / 4), right + 7, py + 4);
  }
  const zeroY = y(0);
  if (zeroY >= top && zeroY <= bottom) { ctx.setLineDash([3, 4]); ctx.strokeStyle = '#91a7aa'; ctx.beginPath(); ctx.moveTo(left, zeroY); ctx.lineTo(right, zeroY); ctx.stroke(); ctx.setLineDash([]); }
  windows.forEach(({ frame, rows, count }, layer) => {
    const step = (plotW - 18) / Math.max(count, 2), width = Math.max(2, Math.min(10, step * (windows.length > 1 ? .46 : .62)));
    const alpha = windows.length > 1 ? .73 : 1;
    rows.forEach((c, i) => {
      const x = candleRight - (rows.length - 1 - i) * step - layer * Math.min(3, width / 2);
      if (x < left || x > right) return;
      const rising = c.close >= c.open;
      ctx.strokeStyle = windows.length > 1 ? frame.color : rising ? '#50e0b7' : '#f1898b';
      ctx.fillStyle = rising ? '#50e0b7' : '#f1898b'; ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
      const bodyTop = Math.min(y(c.open), y(c.close)), bodyH = Math.max(2, Math.abs(y(c.open) - y(c.close)));
      ctx.fillRect(x - width / 2, bodyTop, width, bodyH);
      if (windows.length > 1) ctx.strokeRect(x - width / 2, bodyTop, width, bodyH);
      ctx.globalAlpha = 1;
    });
    if (!state.offset && rows.length) {
      ctx.strokeStyle = frame.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(candleRight - layer * Math.min(3, width / 2), y(rows.at(-1).close)); ctx.lineTo(right, y(live)); ctx.stroke();
    }
  });
  const liveY = y(live);
  if (liveY >= top && liveY <= bottom) {
    ctx.strokeStyle = '#eacb75'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(left, liveY); ctx.lineTo(right, liveY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#eacb75'; ctx.fillRect(right + 2, liveY - 10, 65, 20); ctx.fillStyle = '#13242a'; ctx.font = 'bold 10px sans-serif'; ctx.fillText(yen(live).slice(0, 11), right + 5, liveY + 4);
    if (!state.offset) { ctx.fillStyle = '#eacb75'; ctx.beginPath(); ctx.arc(right, liveY, 3.5, 0, Math.PI * 2); ctx.fill(); }
  }
  const primary = windows[0].rows;
  ctx.fillStyle = '#89a6aa'; ctx.font = '11px sans-serif';
  if (primary.length) { ctx.fillText(shortDate(primary[0].time), left, h - 12); ctx.textAlign = 'right'; ctx.fillText(shortDate(primary.at(-1).time), right, h - 12); }
  if (state.cross) {
    const x = Math.max(left, Math.min(right, state.cross.x)), cy = Math.max(top, Math.min(bottom, state.cross.y));
    ctx.strokeStyle = '#f4f6f3'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.moveTo(left, cy); ctx.lineTo(right, cy); ctx.stroke(); ctx.setLineDash([]);
    const price = lo + (bottom - cy) / plotH * (hi - lo);
    ctx.fillStyle = '#edf7f5'; ctx.fillRect(right + 2, cy - 10, 65, 20); ctx.fillStyle = '#10232d'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(yen(price).slice(0, 11), right + 5, cy + 4);
    const index = Math.max(0, Math.min(primary.length - 1, Math.round(primary.length - 1 - (candleRight - x) / ((plotW - 18) / Math.max(windows[0].count, 2)))));
    if (primary[index]) { const label = dateLabel(primary[index].time); ctx.fillStyle = '#edf7f5'; ctx.fillRect(Math.max(left, Math.min(right - 98, x - 49)), bottom + 3, 98, 21); ctx.fillStyle = '#10232d'; ctx.textAlign = 'center'; ctx.fillText(label, Math.max(left + 49, Math.min(right - 49, x)), bottom + 18); }
  }
}

const pointers = new Map(); let touchStart = null, holdTimer = null;
function pos(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId); const p = pos(event); pointers.set(event.pointerId, p);
  if (pointers.size === 1) { touchStart = { ...p, offset: state.offset, moved: false }; holdTimer = setTimeout(() => { state.cross = p; drawChart(); }, 470); }
  else { clearTimeout(holdTimer); touchStart = null; }
});
canvas.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  const p = pos(event), old = pointers.get(event.pointerId); pointers.set(event.pointerId, p);
  if (pointers.size === 2) {
    const vals = [...pointers.values()], previous = vals.map(v => v === p ? old : v);
    const distance = Math.abs(vals[0].x - vals[1].x), before = Math.abs(previous[0].x - previous[1].x);
    if (before > 10) state.zoom = Math.max(.55, Math.min(4, state.zoom * distance / before));
    drawChart(); return;
  }
  if (state.cross) { state.cross = p; drawChart(); return; }
  if (touchStart) {
    const dx = p.x - touchStart.x;
    if (Math.abs(dx) > 7 || Math.abs(p.y - touchStart.y) > 7) { touchStart.moved = true; clearTimeout(holdTimer); }
    if (touchStart.moved) { state.offset = Math.max(0, Math.min(300, touchStart.offset + dx / 9)); drawChart(); }
  }
});
function release(event) { pointers.delete(event.pointerId); clearTimeout(holdTimer); if (!pointers.size) { touchStart = null; state.cross = null; drawChart(); } }
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', event => { event.preventDefault(); state.zoom = Math.max(.55, Math.min(4, state.zoom * (event.deltaY < 0 ? 1.12 : .89))); drawChart(); }, { passive: false });
new ResizeObserver(drawChart).observe($('chartWrap'));

$('listPeriods').addEventListener('click', event => {
  const button = event.target.closest('[data-period]'); if (!button) return;
  state.period = Number(button.dataset.period); renderPeriods(); renderMarket();
});
$('coinList').addEventListener('click', event => { const row = event.target.closest('[data-pair]'); if (row) openCoin(COINS.find(c => c.pair === row.dataset.pair)); });
$('timeframes').addEventListener('click', event => {
  const button = event.target.closest('[data-frame]'); if (!button) return;
  const frame = button.dataset.frame;
  if (state.frames.has(frame) && state.frames.size > 1) state.frames.delete(frame);
  else state.frames.add(frame);
  renderFrames(); loadChart();
});
$('marketTab').addEventListener('click', () => show('market'));
$('chartTab').addEventListener('click', () => { show('chart'); if (!state.series.size) loadChart(); });
$('backButton').addEventListener('click', () => show('market'));
$('refreshButton').addEventListener('click', () => loadMarket(true));
$('zeroButton').addEventListener('click', () => { state.zeroBase = !state.zeroBase; $('zeroButton').setAttribute('aria-pressed', String(state.zeroBase)); drawChart(); });
const dialog = $('settingsDialog');
$('settingsButton').addEventListener('click', () => { $('apiKey').value = localStorage.getItem('bitbank-api-key') || ''; $('keyStatus').textContent = ''; dialog.showModal(); });
$('saveKey').addEventListener('click', () => { const key = $('apiKey').value.trim(); if (key) { localStorage.setItem('bitbank-api-key', key); $('keyStatus').textContent = 'このブラウザに保存しました。'; } else $('keyStatus').textContent = 'APIキーを入力してください。'; });
$('deleteKey').addEventListener('click', () => { localStorage.removeItem('bitbank-api-key'); $('apiKey').value = ''; $('keyStatus').textContent = '保存したキーを削除しました。'; });
renderPeriods(); renderFrames(); renderMarket(); loadMarket();
setInterval(() => { if (!document.hidden) loadMarket(); }, 60_000);
