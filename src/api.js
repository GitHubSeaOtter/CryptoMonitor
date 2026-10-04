export const COINS = [
  { symbol: 'BTC', pair: 'btc_jpy', name: 'Bitcoin', color: '#f4a943', mark: '₿' },
  { symbol: 'BCC', pair: 'bcc_jpy', name: 'Bitcoin Cash', color: '#6cc584', mark: 'B' },
  { symbol: 'TRX', pair: 'trx_jpy', name: 'TRON', color: '#f27879', mark: 'T' },
  { symbol: 'RENDER', pair: 'render_jpy', name: 'Render', color: '#b8a8ef', mark: 'R' },
  { symbol: 'CHZ', pair: 'chz_jpy', name: 'Chiliz', color: '#e5859a', mark: 'C' },
  { symbol: 'DAI', pair: 'dai_jpy', name: 'Dai', color: '#efc671', mark: 'D' },
];

const cache = new Map();
const API = 'https://public.bitbank.cc';
const tokyoDate = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const ymd = d => {
  const parts = Object.fromEntries(tokyoDate.formatToParts(d).map(part => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
};
let nextRequestAt = 0;
async function requestSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + 180;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}

async function request(path, ttl = 60_000) {
  const entry = cache.get(path);
  if (entry && Date.now() - entry.time < ttl) return entry.promise;
  const promise = requestSlot().then(() => fetch(`${API}${path}`, { headers: { Accept: 'application/json' } }))
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.success !== 1) throw new Error(`Bitbank API: ${json.data?.code ?? 'unknown'}`);
      return json.data;
    });
  cache.set(path, { promise, time: Date.now() });
  promise.catch(() => cache.delete(path));
  return promise;
}

export async function ticker(pair) {
  const data = await request(`/${pair}/ticker`, 15_000);
  return { price: Number(data.last), timestamp: Number(data.timestamp) || Date.now() };
}

function parseCandles(data) {
  const rows = (data.candlestick || []).flatMap(item => item.ohlcv || []);
  return rows.map(row => ({
    open: Number(row[0]), high: Number(row[1]), low: Number(row[2]), close: Number(row[3]),
    volume: Number(row[4]), time: Number(row[5]),
  })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.close)).sort((a, b) => a.time - b.time);
}

export async function candles(pair, type, date) {
  return parseCandles(await request(`/${pair}/candlestick/${type}/${date}`, 60_000));
}

export async function dailyHistory(pair, days = 370) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  const years = [];
  for (let year = start.getFullYear(); year <= now.getFullYear(); year++) years.push(year);
  const results = await Promise.allSettled(years.map(year => candles(pair, '1day', String(year))));
  const all = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
  if (!all.length) throw new Error('日足を取得できませんでした');
  const unique = new Map(all.map(c => [c.time, c]));
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export async function intradayHistory(pair, type, days) {
  const today = Date.now();
  const dates = Array.from({ length: days }, (_, i) => {
    return ymd(new Date(today - i * 86_400_000));
  });
  const results = await Promise.allSettled(dates.map(date => candles(pair, type, date)));
  const all = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
  if (!all.length) throw new Error('足データを取得できませんでした');
  return [...new Map(all.map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
}

export async function chartHistory(pair, frame) {
  if (frame === '1min') return intradayHistory(pair, frame, 2);
  if (frame === '1hour') return intradayHistory(pair, frame, 7);
  if (frame === '1week' || frame === '1month') {
    const year = new Date().getFullYear();
    const results = await Promise.allSettled([candles(pair, frame, String(year - 1)), candles(pair, frame, String(year))]);
    const rows = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
    if (!rows.length) throw new Error('足データを取得できませんでした');
    return [...new Map(rows.map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(frame === '1week' ? -52 : -24);
  }
  const rows = await dailyHistory(pair, frame === '1day' ? 180 : 410);
  if (frame === '1day') return rows.slice(-120);
}
