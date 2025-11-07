// app.js — Virtual Crypto Trading Demo
// Uses CoinGecko public API (no API key). Works as a static site (GitHub Pages).

/* CONFIG */
const STARTING_USD = 10000;
const COINS_TO_SHOW = 20;
const LOCAL_KEY = "crypto_demo_state_v1";

/* STATE */
let state = {
  cash: STARTING_USD,
  holdings: {}, // {id: {symbol, name, qty, avgPrice}}
  history: [],  // order history
  lastPrices: {}, // id -> price in selected currency
  currency: "usd",
};

/* UTIL */
function saveState(){ localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
function loadState(){
  const raw = localStorage.getItem(LOCAL_KEY);
  if(raw) state = JSON.parse(raw);
}
function fmt(n){ return Number(n).toLocaleString(); }
function money(n, currency){ 
  const symbol = currency === "usd" ? "$" : currency === "inr" ? "₹" : "";
  return symbol + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:8});
}

/* DOM refs */
const coinsBody = document.getElementById("coinsBody");
const cashBalance = document.getElementById("cashBalance");
const portfolioValue = document.getElementById("portfolioValue");
const portfolioList = document.getElementById("portfolioList");
const historyList = document.getElementById("historyList");
const currencySelect = document.getElementById("currencySelect");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");

/* Modal refs */
const tradeModal = new bootstrap.Modal(document.getElementById("tradeModal"));
const tradeCoinEl = document.getElementById("tradeCoin");
const tradeTypeEl = document.getElementById("tradeType");
const tradeAmountEl = document.getElementById("tradeAmount");
const tradeEstEl = document.getElementById("tradeEst");
const confirmTradeBtn = document.getElementById("confirmTrade");
let currentTrade = null; // {id, price}

/* Load saved or init */
loadState();
renderBalances();

/* API helpers */
async function fetchTopCoins(vs_currency = "usd") {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs_currency}&order=market_cap_desc&per_page=${COINS_TO_SHOW}&page=1&sparkline=false&price_change_percentage=24h`;
  const res = await fetch(url);
  return res.json();
}
async function fetchCoinMarketChart(id, vs_currency = "usd", days = 7){
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${vs_currency}&days=${days}`;
  const res = await fetch(url);
  return res.json();
}

/* Render market table */
let currentCoins = [];
async function loadMarket(){
  const vs = state.currency;
  try {
    const data = await fetchTopCoins(vs);
    currentCoins = data;
    coinsBody.innerHTML = "";
    data.forEach((c, idx)=>{
      state.lastPrices[c.id] = c.current_price;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td>
          <div class="d-flex align-items-center">
            <img src="${c.image}" style="width:24px;height:24px;margin-right:8px;border-radius:50%">
            <div><strong>${c.name}</strong><div class="small text-muted">${c.symbol.toUpperCase()}</div></div>
          </div>
        </td>
        <td>${money(c.current_price, vs)}</td>
        <td class="${c.price_change_percentage_24h >=0 ? 'text-success' : 'text-danger'}">${(c.price_change_percentage_24h||0).toFixed(2)}%</td>
        <td>${money(c.market_cap, vs)}</td>
        <td>
          <button class="btn btn-sm btn-outline-success me-1" data-id="${c.id}" data-action="buy">Buy</button>
          <button class="btn btn-sm btn-outline-danger" data-id="${c.id}" data-action="sell">Sell</button>
        </td>
      `;
      coinsBody.appendChild(tr);
    });

    // attach handlers
    document.querySelectorAll('#coinsBody button').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        openTradeModal(id, action);
      });
    });

    renderBalances();
  } catch (err){
    console.error("Market load error", err);
  }
}

/* Open trade modal */
function openTradeModal(id, action){
  const coin = currentCoins.find(c=>c.id===id);
  if(!coin) return;
  currentTrade = { id: coin.id, symbol: coin.symbol, name: coin.name, price: state.lastPrices[id] || coin.current_price };
  tradeCoinEl.textContent = `${coin.name} (${coin.symbol.toUpperCase()}) - ${money(currentTrade.price, state.currency)}`;
  tradeTypeEl.value = action;
  tradeAmountEl.value = "";
  tradeEstEl.textContent = money(0, state.currency);
  tradeModal.show();
}

/* Update estimated cost in modal */
tradeAmountEl.addEventListener('input', ()=>{
  const amt = Number(tradeAmountEl.value) || 0;
  tradeEstEl.textContent = money(amt * (currentTrade?.price || 0), state.currency);
});

/* Confirm trade (simulated market order) */
confirmTradeBtn.addEventListener('click', ()=>{
  const type = tradeTypeEl.value;
  const qty = Number(tradeAmountEl.value);
  if(!currentTrade || qty <= 0){ alert('Enter a valid amount'); return; }

  const cost = qty * currentTrade.price;
  if(type === 'buy'){
    if(cost > state.cash){ alert('Not enough cash'); return; }
    state.cash -= cost;
    if(!state.holdings[currentTrade.id]) state.holdings[currentTrade.id] = { symbol: currentTrade.symbol, name: currentTrade.name, qty:0, avgPrice:0 };
    const h = state.holdings[currentTrade.id];
    // update avg cost
    const totalBefore = h.qty * h.avgPrice;
    h.qty += qty;
    h.avgPrice = (totalBefore + cost) / h.qty;
    state.history.unshift({ ts: Date.now(), type: 'BUY', id: currentTrade.id, symbol: currentTrade.symbol, qty, price: currentTrade.price, cost });
  } else {
    // sell
    const h = state.holdings[currentTrade.id];
    if(!h || h.qty < qty){ alert('Not enough coin to sell'); return; }
    h.qty -= qty;
    state.cash += cost;
    state.history.unshift({ ts: Date.now(), type: 'SELL', id: currentTrade.id, symbol: currentTrade.symbol, qty, price: currentTrade.price, cost });
    if(h.qty === 0) delete state.holdings[currentTrade.id];
  }
  saveState();
  tradeModal.hide();
  renderBalances();
});

/* Render wallet & portfolio */
function renderBalances(){
  cashBalance.textContent = money(state.cash, state.currency);

  // compute portfolio market value
  let pv = 0;
  portfolioList.innerHTML = "";
  for(const [id,h] of Object.entries(state.holdings)){
    const price = state.lastPrices[id] || 0;
    const val = h.qty * price;
    pv += val;
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.innerHTML = `<div><strong>${h.symbol.toUpperCase()}</strong> • ${h.name}<div class="small text-muted">Qty: ${h.qty}</div></div><div>${money(val, state.currency)}</div>`;
    portfolioList.appendChild(li);
  }
  portfolioValue.textContent = money(pv, state.currency);

  // history
  historyList.innerHTML = "";
  state.history.slice(0,50).forEach(h=>{
    const li = document.createElement('li');
    li.className = 'list-group-item';
    const time = new Date(h.ts).toLocaleString();
    li.innerHTML = `<div><strong class="${h.type==='BUY'?'text-success':'text-danger'}">${h.type}</strong> ${h.qty} ${h.symbol.toUpperCase()} @ ${money(h.price, state.currency)}</div><div class="small text-muted">${time}</div>`;
    historyList.appendChild(li);
  });
}

/* Reset demo */
resetBtn.addEventListener('click', ()=>{
  if(!confirm('Reset demo and clear local data?')) return;
  state = { cash: STARTING_USD, holdings:{}, history:[], lastPrices:{}, currency: state.currency };
  saveState(); loadMarket();
});

/* Export CSV */
exportBtn.addEventListener('click', ()=>{
  const rows = [["ts","type","symbol","qty","price","cost"]];
  state.history.forEach(h=> rows.push([new Date(h.ts).toISOString(), h.type, h.symbol, h.qty, h.price, h.cost]));
  const csv = rows.map(r=> r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'crypto_demo_history.csv';
  a.click(); URL.revokeObjectURL(url);
});

/* currency select */
currencySelect.value = state.currency;
currencySelect.addEventListener('change', ()=>{
  state.currency = currencySelect.value;
  saveState();
  loadMarket();
});

/* auto-refresh prices every 30 seconds */
loadMarket();
setInterval(loadMarket, 30_000);

/* initial render done */
