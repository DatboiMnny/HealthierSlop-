/* HealthierSlop — calorie tracker.
   Log food by scanning/searching (from any food result), from recent foods, or with a quick add.
   Everything is saved on this phone only (localStorage). Talks to app.js through window.FSApp. */
(function(){
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const K_LOG = 'fs_cal_log', K_GOAL = 'fs_cal_goal', K_RECENT = 'fs_cal_recent', K_UNIT = 'fs_cal_unit';
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const MEAL_NAME = Object.fromEntries(MEALS);
const DEFAULT_KCAL = 2080;                       // 8700kJ — the Australian average-adult reference the app already uses
const KJ = 4.184;

// ---------------- small helpers ----------------
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
const today = () => dayKey(new Date());
const r1 = v => Math.round(v * 10) / 10;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
const unit = () => store.get(K_UNIT, 'kcal');
const eVal = kcal => Math.round(unit() === 'kj' ? kcal * KJ : kcal);
const eUnit = () => unit() === 'kj' ? 'kJ' : 'kcal';
const eFmt = kcal => `${eVal(kcal).toLocaleString('en-AU')} ${eUnit()}`;
const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); };
const mealNow = () => { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h >= 17 && h < 21 ? 'dinner' : 'snack'; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Macro targets: 'auto' (worked out from calories + weight), 'pct' (your own % split) or 'grams' (your own numbers).
const PRESETS = [['Balanced', 20, 50, 30], ['High protein', 30, 40, 30], ['Lower carb', 30, 30, 40], ['Keto', 20, 5, 75], ['Endurance', 15, 60, 25]];
function autoMacros(kcal, w, aim){
  const protein = w ? Math.round(w * (+aim < 0 ? 1.2 : 1)) : Math.round(kcal * .2 / 4);
  const fat = Math.round(kcal * .3 / 9);
  return {protein, carbs: Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4)), fat};
}
function macrosFor(kcal, m){             // m = stored goal (mode, pct, grams, profile)
  m = m || {};
  if (m.macroMode === 'grams' && m.protein != null) return {protein: m.protein, carbs: m.carbs, fat: m.fat};
  if (m.macroMode === 'pct' && m.pct) return {protein: Math.round(kcal * m.pct.p / 100 / 4), carbs: Math.round(kcal * m.pct.c / 100 / 4), fat: Math.round(kcal * m.pct.f / 100 / 9)};
  const pr = m.profile || {};
  return autoMacros(kcal, pr.w, pr.aim);
}
function goal(){
  const g = store.get(K_GOAL, null) || {};
  const kcal = g.kcal && !g.kcalAuto ? g.kcal : DEFAULT_KCAL;
  return Object.assign({}, g, {kcal, fibre: g.fibre || 25, macroMode: g.macroMode || 'auto', isDefault: !g.kcal || !!g.kcalAuto}, macrosFor(kcal, g));
}
function saveGoal(patch){ store.set(K_GOAL, Object.assign({}, store.get(K_GOAL, null) || {}, patch)); }
const log = () => store.get(K_LOG, {});
const dayEntries = k => log()[k] || [];
function saveDay(k, list){ const L = log(); if (list.length) L[k] = list; else delete L[k]; store.set(K_LOG, L); }
const NK = ['kcal', 'p', 'c', 'f', 'sugar', 'sat', 'fib', 'na', 'alc'];   // alc = standard drinks   // energy, protein, carbs, fat, sugars, sat fat, fibre (g), sodium (mg)
// Everything else on the label. [Open Food Facts key, label, unit, group, [men, women] daily amount, 'need' | 'limit', upper limit]
// Daily needs: NHMRC Nutrient Reference Values for Australia & NZ, adults 19–50 (RDI, or AI where there's no RDI).
const MICROS = [
  ['added-sugars', 'Added sugars', 'g', 'other', [50, 50], 'limit'],
  ['trans-fat', 'Trans fat', 'g', 'other', 'trans', 'limit'],
  ['monounsaturated-fat', 'Monounsaturated fat', 'g', 'other'],
  ['polyunsaturated-fat', 'Polyunsaturated fat', 'g', 'other'],
  ['omega-3-fat', 'Omega-3', 'g', 'other', [1.3, 0.8], 'need'],
  ['omega-6-fat', 'Omega-6', 'g', 'other', [13, 8], 'need'],
  ['cholesterol', 'Cholesterol', 'mg', 'other', [300, 300], 'limit'],
  ['starch', 'Starch', 'g', 'other'],
  ['polyols', 'Polyols (sugar alcohols)', 'g', 'other'],
  ['lactose', 'Lactose', 'g', 'other'],
  ['caffeine', 'Caffeine', 'mg', 'other', [400, 400], 'limit'],
  ['vitamin-a', 'Vitamin A', 'µg', 'vit', [900, 700], 'need', 3000],
  ['vitamin-b1', 'Thiamin (B1)', 'mg', 'vit', [1.2, 1.1], 'need'],
  ['vitamin-b2', 'Riboflavin (B2)', 'mg', 'vit', [1.3, 1.1], 'need'],
  ['vitamin-pp', 'Niacin (B3)', 'mg', 'vit', [16, 14], 'need', 35],
  ['pantothenic-acid', 'Pantothenic acid (B5)', 'mg', 'vit', [6, 4], 'need'],
  ['vitamin-b6', 'Vitamin B6', 'mg', 'vit', [1.3, 1.3], 'need', 50],
  ['biotin', 'Biotin (B7)', 'µg', 'vit', [30, 25], 'need'],
  ['vitamin-b9', 'Folate (B9)', 'µg', 'vit', [400, 400], 'need', 1000],
  ['vitamin-b12', 'Vitamin B12', 'µg', 'vit', [2.4, 2.4], 'need'],
  ['vitamin-c', 'Vitamin C', 'mg', 'vit', [45, 45], 'need'],
  ['vitamin-d', 'Vitamin D', 'µg', 'vit', [5, 5], 'need', 80],
  ['vitamin-e', 'Vitamin E', 'mg', 'vit', [10, 7], 'need', 300],
  ['vitamin-k', 'Vitamin K', 'µg', 'vit', [70, 60], 'need'],
  ['choline', 'Choline', 'mg', 'vit', [550, 425], 'need', 3500],
  ['calcium', 'Calcium', 'mg', 'min', [1000, 1000], 'need', 2500],
  ['iron', 'Iron', 'mg', 'min', [8, 18], 'need', 45],
  ['magnesium', 'Magnesium', 'mg', 'min', [410, 315], 'need'],
  ['phosphorus', 'Phosphorus', 'mg', 'min', [1000, 1000], 'need', 4000],
  ['potassium', 'Potassium', 'mg', 'min', [3800, 2800], 'need'],
  ['zinc', 'Zinc', 'mg', 'min', [14, 8], 'need', 40],
  ['iodine', 'Iodine', 'µg', 'min', [150, 150], 'need', 1100],
  ['selenium', 'Selenium', 'µg', 'min', [70, 60], 'need', 400],
  ['copper', 'Copper', 'mg', 'min', [1.7, 1.2], 'need', 10],
  ['manganese', 'Manganese', 'mg', 'min', [5.5, 5], 'need'],
  ['chromium', 'Chromium', 'µg', 'min', [35, 25], 'need'],
  ['molybdenum', 'Molybdenum', 'µg', 'min', [45, 45], 'need', 2000],
  ['fluoride', 'Fluoride', 'mg', 'min', [4, 3], 'need', 10]
];
const MGROUP = [['other', 'Other nutrients'], ['vit', 'Vitamins'], ['min', 'Minerals']];
const UF = {g: 1, mg: 1e3, 'µg': 1e6};          // Open Food Facts stores these as grams per 100g
function microFrom(n){
  const out = {}; if (!n) return out;
  MICROS.forEach(([k, , u]) => {
    let v = num(n[k + '_100g']);
    if (v == null && k === 'vitamin-b9') v = num(n['folates_100g']);
    if (v != null && v > 0 && v < 100) out[k] = v * UF[u];
  });
  return out;
}
const sum = list => list.reduce((a, e) => {
  NK.forEach(k => a[k] += e[k] || 0);
  if (e.micro && Object.keys(e.micro).length){ a.microN++; for (const k in e.micro) a.micro[k] = (a.micro[k] || 0) + e.micro[k]; }
  return a;
}, Object.assign(Object.fromEntries(NK.map(k => [k, 0])), {micro: {}, microN: 0}));

// A "food" is what can be logged: {name, brand, code, per100:{kcal,p,c,f}|null, fixed:{kcal,p,c,f}|null, serveG, packG, u:'g'|'ml'}
// An entry is a food + {id, meal, qty, qunit:'g'|'serve'|'pack'|'item', kcal, p, c, f}
function compute(food, qty, qunit){
  qty = Math.max(0, num(qty) || 0);
  const grams = food.fixed ? null : qunit === 'serve' ? qty * (food.serveG || 0) : qunit === 'pack' ? qty * (food.packG || 0) : qty;
  const b = food.fixed || food.per100 || {kcal: 0}, k = food.fixed ? qty : grams / 100;
  const out = {grams, micro: {}};
  NK.forEach(n => out[n] = (b[n] || 0) * k);
  if (b.micro) for (const m in b.micro) out.micro[m] = b.micro[m] * k;
  return out;
}
function qtyText(e){
  const u = e.u || 'g';
  if (e.qunit === 'item') return e.recipeId ? `${r1(e.qty)} serve${e.qty === 1 ? '' : 's'}` : e.qty === 1 ? '' : `× ${r1(e.qty)}`;
  if (e.qunit === 'serve') return `${r1(e.qty)} serve${e.qty === 1 ? '' : 's'}${e.serveG ? ` (${Math.round(e.qty * e.serveG)}${u})` : ''}`;
  if (e.qunit === 'pack') return `${r1(e.qty)} pack${e.qty === 1 ? '' : 's'}${e.packG ? ` (${Math.round(e.qty * e.packG)}${u})` : ''}`;
  return `${Math.round(e.qty)}${u}`;
}
function remember(food, qty, qunit){
  const key = food.code || ('n:' + food.name.toLowerCase());
  const list = store.get(K_RECENT, []).filter(x => x.key !== key);
  list.unshift(Object.assign({}, food, {key, lastQty: qty, lastUnit: qunit}));
  store.set(K_RECENT, list.slice(0, 30));
}
function addEntry(food, meal, qty, qunit, dayK){
  const v = compute(food, qty, qunit);
  const e = Object.assign({}, food, v, {id: uid(), meal, qty: num(qty), qunit, ts: Date.now()});
  delete e.key; delete e.lastQty; delete e.lastUnit; delete e.grams;
  const k = dayK || day;
  saveDay(k, dayEntries(k).concat(e));
  remember(food, num(qty), qunit);
  return e;
}

// ---------------- nutrient breakdown (Macros / Further information) ----------------
const profSex = () => ((store.get(K_GOAL, null) || {}).profile || {}).sex;
function refAmt(r){ if (!r) return null; if (r === 'trans') return goal().kcal * .01 / 9; const s = profSex(); return s === 'm' ? r[0] : s === 'f' ? r[1] : (r[0] + r[1]) / 2; }
const fmtA = v => v >= 100 ? Math.round(v).toLocaleString('en-AU') : v >= 10 ? r1(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
function nRow(label, v, u, ref, type, ul){
  const pct = ref ? v / ref * 100 : null, over = ul && v > ul;
  const col = over ? 'var(--g1)' : type === 'limit' ? (pct > 100 ? 'var(--g1)' : 'var(--g3)') : 'var(--brand)';
  const what = type === 'limit' ? 'daily limit' : type === 'target' ? 'your daily target' : 'daily need';
  return `<div class="nrow"><div class="top"><span>${label}</span><span><b>${fmtA(v)}${u}</b>${pct != null ? ` · ${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%` : ''}</span></div>
    ${pct != null ? `<div class="bar"><i style="width:${Math.max(1.5, Math.min(100, pct))}%;background:${col}"></i></div>` : ''}
    <p>${pct != null ? (type === 'target' ? `of your ${fmtA(ref)}${u} daily target` : `of the ${fmtA(ref)}${u} ${what}`) : 'No set daily amount'}${over ? ` · above the safe upper limit (${fmtA(ul)}${u})` : ''}</p></div>`;
}
function macroRows(v){
  const g = goal();
  return nRow('Energy', eVal(v.kcal), ' ' + eUnit(), eVal(g.kcal), 'target')
    + nRow('Protein', v.p, 'g', g.protein, 'target') + nRow('Carbohydrate', v.c, 'g', g.carbs, 'target')
    + nRow('– Sugars', v.sugar, 'g', 50, 'limit') + nRow('Fat', v.f, 'g', g.fat, 'target')
    + nRow('– Saturated fat', v.sat, 'g', g.kcal * .1 / 9, 'limit') + nRow('Fibre', v.fib, 'g', g.fibre, 'need')
    + nRow('Sodium', v.na, 'mg', 2000, 'limit')
    + (v.alc > 0 ? nRow('Alcohol', v.alc, ' std drinks', ALC_DAY_MAX, 'limit') : '');
}
function microRows(v, scope){
  const m = v.micro || {}, have = MICROS.filter(x => m[x[0]] > 0);
  const sx = profSex();
  const foot = `<p class="nfoot">Daily needs are Australian NHMRC values for adults 19–50${sx ? ` (${sx === 'm' ? 'men' : 'women'} — from your Daily target)` : ' (average of men and women — add your sex in Daily target to make it exact)'}. Upper limits are for all sources combined, including supplements. General info, not medical advice.</p>`;
  if (!have.length) return `<p class="muted">${scope === 'day' ? 'None of the foods logged on this day list vitamins or minerals.' : 'This product doesn\'t list vitamins, minerals or other nutrients — most labels only show the main nutrition panel.'}</p>`;
  const cov = scope === 'day' && v.microN < v.n ? `<div class="note" style="margin-bottom:10px">From ${v.microN} of ${v.n} foods — the others don't list vitamins or minerals, so your real totals are likely higher.</div>` : '';
  return cov + MGROUP.map(([gk, gn]) => { const rows = have.filter(x => x[3] === gk); if (!rows.length) return '';
    return `<h4 class="ngh">${gn}</h4>` + rows.map(([k, label, u, , r, type, ul]) => nRow(label, m[k], u, k === 'caffeine' ? cafLimit() : refAmt(r), type, ul)).join(''); }).join('') + foot;
}
function nutTabs(id){
  return `<div class="tabs ntabs" role="tablist" data-for="${id}"><button role="tab" data-t="mac" aria-selected="true">Macros</button><button role="tab" data-t="more" aria-selected="false">Further information</button></div>
    <div class="npane" data-p="mac"></div><div class="npane hidden" data-p="more"></div>`;
}
function bindTabs(root, onTab){
  root.querySelectorAll('.ntabs button').forEach(b => b.onclick = () => {
    const box = b.closest('.ntabs').parentElement;
    box.querySelectorAll('.ntabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    box.querySelectorAll(':scope > .npane').forEach(p => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    onTab && onTab(b.dataset.t);
  });
}

// ---------------- day health score ----------------
// 60% food quality (calorie-weighted average of each food's HealthierSlop score) + 40% balance for the day
// (protein, fibre, sugars, saturated fat, sodium). Foods added with Quick add have no score and only count towards balance.
const scoreCol = s => s >= 80 ? 'var(--g5)' : s >= 60 ? 'var(--g4)' : s >= 40 ? 'var(--g3)' : s >= 20 ? 'var(--g2)' : 'var(--g1)';
const scoreWord = s => s >= 80 ? 'Excellent' : s >= 60 ? 'Good' : s >= 40 ? 'Mediocre' : s >= 20 ? 'Poor' : 'Bad';
const lin = (v, good, bad) => v <= good ? 1 : v >= bad ? 0 : 1 - (v - good) / (bad - good);
function dayScore(list, g){
  if (!list.length) return null;
  const t = sum(list); g = g || goal();
  const scored = list.filter(e => typeof e.score === 'number' && e.kcal > 0);
  const sk = scored.reduce((a, e) => a + e.kcal, 0);
  const quality = sk > 0 ? scored.reduce((a, e) => a + e.score * e.kcal, 0) / sk : null;
  const parts = [
    {k: 'protein', name: 'Protein', v: Math.min(1, t.p / (g.protein || 60)), val: `${Math.round(t.p)}g of ${g.protein}g`, tip: 'Add protein: eggs, Greek yoghurt, legumes, fish, chicken or tofu.'},
    {k: 'fibre', name: 'Fibre', v: Math.min(1, t.fib / g.fibre), val: `${Math.round(t.fib)}g of ${g.fibre}g`, tip: 'More fibre: veg, fruit, beans, lentils, oats or wholegrain bread.'},
    {k: 'sugar', name: 'Sugars', v: lin(t.sugar, 50, 100), val: `${Math.round(t.sugar)}g (aim under 50g)`, tip: 'Sugars are high — swap soft drinks, lollies and sweet snacks for fruit, nuts or water.'},
    {k: 'sat', name: 'Saturated fat', v: lin(t.sat, 24, 40), val: `${Math.round(t.sat)}g (aim under 24g)`, tip: 'Saturated fat is high — try olive oil, nuts, avocado or leaner cuts.'},
    {k: 'na', name: 'Sodium', v: lin(t.na, 2000, 3500), val: `${Math.round(t.na).toLocaleString('en-AU')}mg (aim under 2,000mg)`, tip: 'Sodium is high — processed meats, sauces, chips and takeaway are the usual sources.'}
  ];
  const bal = parts.reduce((a, x) => a + x.v, 0) / parts.length * 100;
  const alcPen = alcPenalty(t.alc);
  const score = Math.max(0, Math.round(quality != null ? quality * .6 + bal * .4 : bal) - alcPen);
  const tips = parts.filter(x => x.v < .7).sort((a, b) => a.v - b.v).slice(0, 2).map(x => x.tip);
  if (alcPen) tips.unshift(`Alcohol took ${alcPen} points off — ${r1(t.alc)} standard drink${Math.abs(t.alc - 1) < .05 ? '' : 's'}. Alcohol-free days help most.`);
  if (quality != null && quality < 50) tips.unshift('Most of what you ate today scores low — tap a food to see its score and healthier swaps.');
  return {score, alc: t.alc || 0, alcPen, quality: quality != null ? Math.round(quality) : null, balance: Math.round(bal), parts, tips: tips.slice(0, 3), scoredN: scored.length, n: list.length};
}
function healthCard(k){
  const list = dayEntries(k), d = dayScore(list);
  if (!d) return '';
  const C = 2 * Math.PI * 34, c = scoreCol(d.score);
  return `<div class="card calhealth">
    <h2>${k === today() ? "Today's health score" : 'Health score'}</h2>
    <div class="hs">
      <div class="hring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="34" fill="none" stroke="var(--line)" stroke-width="9"/>
        <circle cx="42" cy="42" r="34" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - d.score / 100)}" transform="rotate(-90 42 42)"/></svg>
        <b>${d.score}</b></div>
      <div><span class="grade" style="background:${c}">${scoreWord(d.score)}</span>
        <p class="muted" style="margin-top:6px">${d.quality != null ? `Food quality ${d.quality}/100 · ` : ''}Balance ${d.balance}/100${d.alcPen ? ` · <b style="color:var(--g1)">Alcohol −${d.alcPen}</b>` : ''}</p>
        <p class="muted">${d.scoredN === d.n ? `All ${d.n} food${d.n > 1 ? 's' : ''} scored.` : `${d.scoredN} of ${d.n} foods have a product score — Quick adds only count towards balance.`}</p></div>
    </div>
    ${d.parts.map(x => `<div class="calbal"><div class="top"><span>${x.name}</span><span>${esc(x.val)}</span></div><div class="bar"><i style="width:${Math.max(3, x.v * 100)}%;background:${scoreCol(x.v * 100)}"></i></div></div>`).join('')}
    ${d.tips.length ? `<ul class="plain caltips">${d.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${k === today() ? '<p class="muted" style="margin-top:8px">Protein and fibre fill up as you log the rest of the day.</p>' : ''}
    <details style="margin-top:8px"><summary class="muted" style="cursor:pointer">How the day score works</summary>
      <p class="muted" style="margin-top:6px">60% is food quality — the average HealthierSlop score of what you ate, weighted by calories, so a big meal counts more than a snack. 40% is balance: reaching your protein and fibre targets, and keeping sugars under 50g, saturated fat under 24g and sodium under 2,000mg. Alcohol then takes about 4 points off per standard drink (10 more past 4 drinks). General guidance, not medical advice.</p></details>
  </div>`;
}

// ---------------- state ----------------
let day = today();
let sumTab = 'mac';                // Today summary tab: 'mac' | 'more'
let month = today().slice(0, 7);  // calendar month shown, 'YYYY-MM'
let sel = today();                // calendar day selected
let pending = null;               // {meal, ts}: set when the person leaves the tracker to scan/search for a meal
const PENDING_MS = 15 * 60 * 1000;
const pendingMealGet = () => pending && Date.now() - pending.ts < PENDING_MS ? pending.meal : null;

// ---------------- modal sheet ----------------
function sheet(html, bind){
  const m = $('#modal');
  m.innerHTML = `<div class="sheet calsheet">${html}</div>`;
  m.classList.remove('hidden');
  m.onclick = ev => { if (ev.target === m) close(); };
  bind && bind(m.querySelector('.sheet'));
}
function close(){ const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; m.onclick = null; }

// ---------------- day type: training (default) · rest · sick · off ----------------
const K_STATUS = 'fs_cal_status';
const STATUS = {
  train: {name: 'Training', desc: 'A normal or training day. This is the default.', col: 'var(--st-train)',
    icon: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'},
  rest: {name: 'Rest day', desc: 'A recovery day with no training.', col: 'var(--st-rest)',
    icon: '<path d="M3 18V7M3 14h18v4M21 14v-1.5A2.5 2.5 0 0 0 18.5 10H11v4"/><circle cx="7" cy="11.5" r="1.6"/>'},
  sick: {name: 'Sick', desc: 'Unwell. Eating differently is expected.', col: 'var(--st-sick)',
    icon: '<path d="M14 14.6V5a2 2 0 0 0-4 0v9.6a4 4 0 1 0 4 0z"/><path d="M12 9v6.5"/>'},
  off: {name: 'Off', desc: 'Taking a break from tracking. Left out of your averages.', col: 'var(--st-off)',
    icon: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'}
};
const STATUS_ORDER = ['train', 'rest', 'sick', 'off'];
const stIcon = (s, size) => `<svg class="sti" width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" aria-hidden="true" style="color:${STATUS[s].col}">${STATUS[s].icon}</svg>`;
const statusMap = () => store.get(K_STATUS, {});
const statusOf = k => statusMap()[k] || 'train';
const statusSet = k => !!statusMap()[k];
function setStatus(k, s){ const m = statusMap(); if (s === 'train') delete m[k]; else m[k] = s; store.set(K_STATUS, m); }
function openStatus(k, after){
  const cur = statusOf(k);
  sheet(`<h2>What kind of day ${k === today() ? 'is today' : 'was it'}?</h2>
    <p class="muted">${esc(fromKey(k).toLocaleDateString('en-AU', {weekday: 'long', day: 'numeric', month: 'long'}))}. Shown on your calendar.</p>
    <div class="stlist">${STATUS_ORDER.map(s => `<button class="stopt${s === cur ? ' on' : ''}" data-s="${s}">
      <span class="stic" style="background:color-mix(in srgb, ${STATUS[s].col} 16%, transparent)">${stIcon(s, 22)}</span>
      <span class="t"><b>${STATUS[s].name}</b><span>${STATUS[s].desc}</span></span>
      ${s === cur ? '<svg class="tick" viewBox="0 0 24 24" width="20" height="20"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}</button>`).join('')}</div>
    <button class="btn plain" id="stClose" style="margin-top:12px">Cancel</button>`, s => {
    s.querySelector('#stClose').onclick = close;
    s.querySelectorAll('.stopt').forEach(b => b.onclick = () => { setStatus(k, b.dataset.s); close(); toast(STATUS[b.dataset.s].name); after && after(); });
  });
}

// ---------------- shared bits ----------------
function dayLabel(k){
  if (k === today()) return 'Today';
  if (k === addDays(today(), -1)) return 'Yesterday';
  return fromKey(k).toLocaleDateString('en-AU', {weekday: 'long'});
}
const CHEV_L = '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>', CHEV_R = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
const CHEV_D = '<svg class="cd" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>', ARROW = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
function miniRing(frac, col){        // small progress ring for the macro tiles
  const C = 2 * Math.PI * 8;
  return `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8" fill="none" stroke="color-mix(in srgb, ${col} 25%, transparent)" stroke-width="3"/>
    <circle cx="11" cy="11" r="8" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, frac))}" transform="rotate(-90 11 11)"/></svg>`;
}
function tickRing(frac, col, inner){ // 28 short ticks around a circle; the first part coloured by score
  const n = 28, on = Math.round(Math.max(0, Math.min(1, frac)) * n);
  let ticks = '';
  for (let i = 0; i < n; i++){
    const a = (i / n) * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    ticks += `<line x1="${(20 + c * 13).toFixed(2)}" y1="${(20 + s * 13).toFixed(2)}" x2="${(20 + c * 18).toFixed(2)}" y2="${(20 + s * 18).toFixed(2)}" stroke="${i < on ? col : 'var(--tick)'}"/>`;
  }
  return `<svg class="tring" viewBox="0 0 40 40" aria-hidden="true"><g stroke-width="2.2" stroke-linecap="round">${ticks}</g>${inner || ''}</svg>`;
}
function dots(frac, col){             // 6 × 12 dot grid, filled in proportion
  const R = 6, Cn = 12, on = Math.round(Math.max(0, Math.min(1, frac)) * R * Cn);
  let out = '';
  for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++){
    const i = r * Cn + c;
    out += `<circle cx="${4 + c * 8}" cy="${4 + r * 8}" r="2.6" fill="${col}" opacity="${i < on ? 1 : .18}"/>`;
  }
  return `<svg class="dots" viewBox="0 0 96 48" preserveAspectRatio="xMinYMid meet" aria-hidden="true">${out}</svg>`;
}
const kfmt = v => { v = eVal(v); return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(v); };

// ---------------- Today ----------------
let ndUnit = 'g';
function render(){
  const el = $('#v-cal'); if (!el) return;
  if (day > today()) day = today();
  const auto = runHabits();
  if (auto) setTimeout(() => toast(`Added ${auto} item${auto > 1 ? 's' : ''} from your habits`), 300);
  const g = goal(), list = dayEntries(day), t = sum(list), st = statusOf(day);
  const left = g.kcal - t.kcal;
  // last 7 days for the mini chart
  const wk = []; for (let i = 6; i >= 0; i--){ const k = addDays(day, -i); wk.push({k, kcal: sum(dayEntries(k)).kcal}); }
  const wmax = Math.max(g.kcal * 1.15, ...wk.map(d => d.kcal)), tY = 100 - g.kcal / wmax * 100;
  const M = [['f', 'Fat', t.f, g.fat, 'var(--fat)'], ['c', 'Carbs', t.c, g.carbs, 'var(--carb)'], ['p', 'Protein', t.p, g.protein, 'var(--pro)']];
  el.innerHTML = `
  <div class="tdhead">
    <div class="tdl">
      <button class="tdate" id="calToMonth" aria-label="Open calendar">${esc(dayLabel(day))}${CHEV_D}</button>
      <button class="stbtn" id="calStatus" style="--sc:${STATUS[st].col}" aria-label="Day type: ${STATUS[st].name}">${stIcon(st, 15)}<span>${STATUS[st].name}</span></button>
    </div>
    <div class="rbtns"><button class="rb" id="calPrev" aria-label="Previous day">${CHEV_L}</button><button class="rb" id="calNext" aria-label="Next day" ${day >= today() ? 'disabled' : ''}>${CHEV_R}</button></div>
  </div>
  <p class="tdsub">${fromKey(day).toLocaleDateString('en-AU', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})}</p>

  ${g.isDefault ? `<div class="card calnudge"><div><b>Set your daily target</b><p class="muted">Using a general ${eFmt(DEFAULT_KCAL)} for now. Work out yours from your height, weight and activity.</p></div>
    <button class="btn ghost" id="calSetup">Set target</button></div>` : ''}
  ${st === 'off' ? `<div class="card stnote">${stIcon('off', 18)}<p>You've marked this day as a break from tracking. It won't count towards your averages.</p></div>` : ''}

  <div class="card goals">
    <div class="ch"><h2>Goals</h2><button class="ar" id="calGoalsGo" aria-label="Change targets">${ARROW}</button></div>
    <button class="gcal" id="calWeek" aria-label="Open calendar">
      <div class="gl"><b>Calories</b><span>${eFmt(Math.abs(left))} ${left >= 0 ? 'left' : 'over'}</span></div>
      <div class="gch"><span class="tlab" style="top:calc(${tY}% - 15px)">${kfmt(g.kcal)}</span><i class="tdash" style="top:${tY}%"></i>
        ${wk.map(d => `<span class="b${d.k === day ? ' on' : ''}" style="height:${Math.max(d.kcal ? 6 : 3, d.kcal / wmax * 100)}%"></span>`).join('')}</div>
    </button>
    <div class="gtiles">${M.map(([k, n, v, tg, c]) => { const lf = tg - v; return `<button class="gt" data-m="${k}"><div class="gn"><b>${n}</b>${miniRing(tg ? v / tg : 0, c)}</div>
      <span>${Math.round(Math.abs(lf))}g ${lf >= 0 ? 'left' : 'over'}</span></button>`; }).join('')}</div>
  </div>

  <button class="scanbar" id="calScanHero"><span class="sbi"><svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6"/></svg></span>
    <span class="t"><b>Scan food to log</b><span>Adds it to ${MEAL_NAME[mealNow()]} with a health score</span></span>${ARROW}</button>

  ${waterCard(day)}

  ${drinksCard(day)}

  <div class="card ndet daybox nbox">
    <div class="ch"><h2>Nutritional details</h2><div class="useg" id="ndUnit"><button data-u="g" class="${ndUnit === 'g' ? 'on' : ''}">g</button><button data-u="%" class="${ndUnit === '%' ? 'on' : ''}">%</button></div></div>
    <div class="tabs ntabs" role="tablist"><button role="tab" data-t="mac" aria-selected="${sumTab === 'mac'}">Macros</button><button role="tab" data-t="more" aria-selected="${sumTab === 'more'}">Further information</button></div>
    <div class="npane${sumTab === 'mac' ? '' : ' hidden'}" data-p="mac">
      <div class="dgrid">${M.map(([k, n, v, tg, c]) => `<div>${dots(tg ? v / tg : 0, c)}<b>${ndUnit === 'g' ? Math.round(v) + 'g' : Math.round(tg ? v / tg * 100 : 0) + '%'}</b><span style="color:${c}">${n}</span></div>`).join('')}</div>
      ${list.length ? `<details class="nmore"><summary>Sugars, saturated fat, fibre & sodium</summary>${macroRows(t)}</details>` : ''}
    </div>
    <div class="npane${sumTab === 'more' ? '' : ' hidden'}" data-p="more">${list.length ? microRows(Object.assign({n: list.length}, t), 'day') : '<p class="muted">Log some food to see vitamins, minerals and more.</p>'}</div>
  </div>

  ${healthCard(day)}

  ${MEALS.map(([m, name]) => {
    const items = list.filter(e => e.meal === m), s = sum(items);
    return `<div class="card calmeal">
      <div class="mh"><h2>${name}</h2><span>${items.length ? eFmt(s.kcal) : ''}</span></div>
      ${items.map(e => `<div class="cale" data-id="${esc(e.id)}" role="button" tabindex="0">
        <div class="t"><b class="notr">${esc(e.name)}</b><span>${e.habit ? `<span class="hmini">${ICON_REPEAT}</span>` : ''}<span class="notr">${esc([e.brand, qtyText(e)].filter(Boolean).join(' · '))}</span></span></div>
        ${typeof e.score === 'number' ? `<span class="fsc" style="background:${scoreCol(e.score)}" title="Health score">${e.score}</span>` : ''}
        <div class="k">${eVal(e.kcal).toLocaleString('en-AU')}</div></div>`).join('')}
      <button class="caladd" data-m="${m}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add food</button>
    </div>`; }).join('')}

  <div class="card">
    <h2>Tracker settings</h2>
    <label class="lbl" style="margin-top:0">Show energy in</label>
    <div class="seg" id="calUnit"><button data-u="kcal" class="${unit() === 'kcal' ? 'on' : ''}">Calories (kcal)</button><button data-u="kj" class="${unit() === 'kj' ? 'on' : ''}">Kilojoules (kJ)</button></div>
    <button class="btn plain" id="calSetup2" style="margin-top:12px">Daily target · ${eFmt(g.kcal)}</button>
    <button class="btn plain" id="calMac" style="margin-top:8px">Macros · ${g.protein}g protein · ${g.carbs}g carbs · ${g.fat}g fat</button>
    <button class="btn plain" id="calWater" style="margin-top:8px">Water goal · ${fmtL(waterGoal())}</button>
    <button class="btn plain" id="calCaf" style="margin-top:8px">Caffeine limit · ${cafLimit()} mg</button>
    <button class="btn plain" id="calCopy" style="margin-top:8px" ${dayEntries(addDays(day, -1)).length ? '' : 'disabled'}>Copy the previous day's food</button>
    <p class="muted" style="margin-top:10px">Saved on this phone only. Targets are general estimates, not medical or dietary advice.</p>
  </div>`;

  const toMonth = () => { sel = day; month = day.slice(0, 7); window.FSApp && FSApp.show('month'); };
  $('#calPrev').onclick = () => { day = addDays(day, -1); render(); };
  $('#calNext').onclick = () => { if (day < today()){ day = addDays(day, 1); render(); } };
  $('#calToMonth').onclick = toMonth; $('#calWeek').onclick = toMonth;
  $('#calStatus').onclick = () => openStatus(day, render);
  const hero = $('#calScanHero');
  hero.onclick = () => { pending = {meal: mealNow(), ts: Date.now()}; if (window.FSApp){ FSApp.show('scan'); FSApp.startScan(); } };
  [$('#calSetup'), $('#calSetup2')].forEach(b => b && (b.onclick = openGoal));
  [$('#calMac'), $('#calGoalsGo')].forEach(b => b.onclick = openMacros);
  el.querySelectorAll('.gt').forEach(b => b.onclick = openMacros);
  bindWater(day, render);
  bindDrinks(day, render);
  $('#calWater').onclick = () => openWaterGoal(render);
  $('#calCaf').onclick = () => openCafLimit(render);
  el.querySelectorAll('#ndUnit button').forEach(b => b.onclick = () => { ndUnit = b.dataset.u; render(); });
  bindTabs(el.querySelector('.daybox'), x => { sumTab = x; });
  el.querySelectorAll('.caladd').forEach(b => b.onclick = () => openAdd(b.dataset.m));
  el.querySelectorAll('.cale').forEach(r => { const f = () => openEdit(r.dataset.id); r.onclick = f; r.onkeydown = ev => { if (ev.key === 'Enter') f(); }; });
  el.querySelectorAll('#calUnit button').forEach(b => b.onclick = () => { store.set(K_UNIT, b.dataset.u); render(); });
  $('#calCopy').onclick = () => {
    const prev = dayEntries(addDays(day, -1)); if (!prev.length) return;
    saveDay(day, dayEntries(day).concat(prev.map(e => Object.assign({}, e, {id: uid(), ts: Date.now()}))));
    toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`); render();
  };
}

// ---------------- calendar ----------------
function monthName(mk){ const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-AU', {month: 'long', year: 'numeric'}); }
function renderMonth(){
  const el = $('#v-month'); if (!el) return;
  const [y, m] = month.split('-').map(Number), first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;               // weeks start on Monday
  const L = log(), g = goal(), tk = today(), SM = statusMap();
  const keys = []; for (let d = 1; d <= days; d++) keys.push(`${month}-${pad(d)}`);
  const tracked = keys.filter(k => (L[k] || []).length && SM[k] !== 'off');
  const scores = tracked.map(k => dayScore(L[k], g)).filter(Boolean);
  const avgS = scores.length ? Math.round(scores.reduce((a, d) => a + d.score, 0) / scores.length) : null;
  const avgK = tracked.length ? tracked.reduce((a, k) => a + sum(L[k]).kcal, 0) / tracked.length : 0;
  const counts = {train: 0, rest: 0, sick: 0, off: 0};
  keys.forEach(k => { if (k > tk) return; const s = SM[k] || ((L[k] || []).length ? 'train' : null); if (s) counts[s]++; });
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="mc blank"></div>');
  keys.forEach((k, i) => {
    const list = L[k] || [], s = SM[k], future = k > tk;
    const off = s === 'off', ds = !off && list.length ? dayScore(list, g) : null;
    const showSt = !future && (s || list.length);
    const ringH = off ? tickRing(1, 'var(--st-off)', `<g transform="translate(13 12.5) scale(.6)" fill="none" stroke="var(--st-off)" stroke-width="2.6" stroke-linecap="round">${STATUS.off.icon}</g>`)
      : ds ? tickRing(ds.score / 100, scoreCol(ds.score), `<text x="20" y="24" text-anchor="middle" class="rs">${ds.score}</text>`) : tickRing(0, '');
    cells.push(`<button class="mc${k === sel ? ' on' : ''}${k === tk ? ' today' : ''}${future ? ' fut' : ''}" data-k="${k}" ${future ? 'disabled' : ''}
      aria-label="${esc(fromKey(k).toLocaleDateString('en-AU', {day: 'numeric', month: 'long'}))}${ds ? ', health score ' + ds.score : ''}${showSt ? ', ' + STATUS[s || 'train'].name : ''}">
      ${ringH}<span class="d">${i + 1}</span><span class="si">${showSt ? stIcon(s || 'train', 14) : ''}</span></button>`);
  });
  const canNext = month < tk.slice(0, 7);
  el.innerHTML = `
  <div class="tdhead">
    <div class="tdl"><button class="tdate" id="mPick">${esc(monthName(month))}${CHEV_D}</button></div>
    <div class="rbtns"><button class="rb" id="mPrev" aria-label="Previous month">${CHEV_L}</button><button class="rb" id="mNext" aria-label="Next month" ${canNext ? '' : 'disabled'}>${CHEV_R}</button></div>
  </div>
  <div class="card mcard">
    <div class="mgrid mhead">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="mgrid">${cells.join('')}</div>
    <div class="mlegend">${STATUS_ORDER.map(s => `<span>${stIcon(s, 14)}${STATUS[s].name}</span>`).join('')}<span><i class="lg"></i>Health score</span></div>
  </div>
  <div class="mtools">${month !== tk.slice(0, 7) || sel !== tk ? '<button class="pillbtn" id="mToday">Today</button>' : '<span></span>'}<button class="rb" id="mInfo" aria-label="What the calendar shows"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg></button></div>
  <div class="card mstat">
    <div class="ms3">
      <div><b>${tracked.length}</b><span>days tracked</span></div>
      <div><b style="${avgS != null ? 'color:' + scoreCol(avgS) : ''}">${avgS != null ? avgS : '—'}</b><span>avg health score</span></div>
      <div><b>${tracked.length ? kfmt(avgK) : '—'}</b><span>avg ${eUnit()} a day</span></div>
    </div>
    <div class="ms4">${STATUS_ORDER.map(s => `<div style="--sc:${STATUS[s].col}">${stIcon(s, 18)}<b>${counts[s]}</b><span>${STATUS[s].name}</span></div>`).join('')}</div>
  </div>
  <div id="mDay">${dayDetail(sel)}</div>`;
  const go = mk => { month = mk; renderMonth(); };
  $('#mPrev').onclick = () => { const d = new Date(y, m - 2, 1); go(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  $('#mNext').onclick = () => { if (!canNext) return; const d = new Date(y, m, 1); go(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const tb = $('#mToday'); if (tb) tb.onclick = () => { sel = tk; go(tk.slice(0, 7)); };
  $('#mPick').onclick = () => {
    const opts = []; const d0 = fromKey(tk); for (let i = 0; i < 12; i++){ const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); opts.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
    sheet(`<h2>Go to month</h2><div class="stlist">${opts.map(o => { const n = Object.keys(L).filter(k => k.startsWith(o) && L[k].length && SM[k] !== 'off').length;
      return `<button class="stopt${o === month ? ' on' : ''}" data-m="${o}"><span class="t"><b>${esc(monthName(o))}</b><span>${n ? n + ' day' + (n > 1 ? 's' : '') + ' tracked' : 'Nothing tracked'}</span></span></button>`; }).join('')}</div>
      <button class="btn plain" id="stClose" style="margin-top:12px">Cancel</button>`, s => {
      s.querySelector('#stClose').onclick = close;
      s.querySelectorAll('.stopt').forEach(b => b.onclick = () => { close(); go(b.dataset.m); });
    });
  };
  $('#mInfo').onclick = () => sheet(`<h2>Your calendar</h2>
    <div class="infolist">
      <p>${tickRing(.75, 'var(--g4)', '<text x="20" y="24" text-anchor="middle" class="rs">75</text>')}<span><b>Health score</b> for each day you tracked — 60% how healthy the foods were, 40% how balanced the day was. Green is best, red is lowest.</span></p>
      ${STATUS_ORDER.map(s => `<p><span class="stic" style="background:color-mix(in srgb, ${STATUS[s].col} 16%, transparent)">${stIcon(s, 20)}</span><span><b>${STATUS[s].name}</b> — ${STATUS[s].desc}</span></p>`).join('')}
      <p class="muted">Change the type of day with the button next to the date on Today.</p>
    </div><button class="btn primary" id="stClose" style="margin-top:12px">Got it</button>`, s => { s.querySelector('#stClose').onclick = close; });
  el.querySelectorAll('.mc[data-k]').forEach(b => b.onclick = () => { sel = b.dataset.k; renderMonth(); const d = $('#mDay'); d && d.scrollIntoView({behavior: 'smooth', block: 'start'}); });
  bindDetail();
}
function dayDetail(k){
  const list = dayEntries(k), t = sum(list), g = goal(), st = statusOf(k);
  const head = `<div class="ddh"><h3>${esc(fromKey(k).toLocaleDateString('en-AU', {weekday: 'long', day: 'numeric', month: 'long'}))}</h3>
    <button class="stbtn" id="mStatus" style="--sc:${STATUS[st].col}">${stIcon(st, 15)}<span>${STATUS[st].name}</span></button></div>`;
  if (!list.length) return head + `<div class="card"><p class="muted">Nothing recorded on this day.${waterTotal(k) ? ` 💧 ${fmtL(waterTotal(k))} of water.` : ''}</p>
    <button class="btn ghost" id="mEdit" style="margin-top:10px">${k === today() ? 'Log food for today' : 'Add food to this day'}</button></div>`;
  return head + `<div class="card">
    ${waterTotal(k) || (t.micro && t.micro.caffeine) || t.alc ? `<p class="wline">${[waterTotal(k) ? `💧 ${fmtL(waterTotal(k))} water` : '', t.micro && t.micro.caffeine ? `☕ ${Math.round(t.micro.caffeine)} mg caffeine` : '', t.alc ? `🍺 ${r1(t.alc)} standard drink${Math.abs(t.alc - 1) < .05 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
    <div class="mtot"><div><b>${eFmt(t.kcal)}</b><span>of ${eFmt(g.kcal)}</span></div>
      <div><b style="color:var(--pro)">${Math.round(t.p)}g</b><span>protein</span></div><div><b style="color:var(--carb)">${Math.round(t.c)}g</b><span>carbs</span></div><div><b style="color:var(--fat)">${Math.round(t.f)}g</b><span>fat</span></div></div>
    ${MEALS.map(([m, name]) => { const items = list.filter(e => e.meal === m); if (!items.length) return '';
      return `<div class="mmeal"><div class="mh"><b>${name}</b><span>${eFmt(sum(items).kcal)}</span></div>
        ${items.map(e => `<div class="cale ro"><div class="t"><b class="notr">${esc(e.name)}</b><span class="notr">${esc([e.brand, qtyText(e)].filter(Boolean).join(' · '))}</span></div>
          ${typeof e.score === 'number' ? `<span class="fsc" style="background:${scoreCol(e.score)}">${e.score}</span>` : ''}
          <div class="k">${eVal(e.kcal).toLocaleString('en-AU')}</div></div>`).join('')}</div>`; }).join('')}
    <details class="nmore" style="margin-top:12px"><summary>Further information — all nutrients</summary>${macroRows(t)}${microRows(Object.assign({n: list.length}, t), 'day')}</details>
    <div class="row" style="margin-top:12px"><button class="btn plain" id="mEdit">Edit this day</button>${k !== today() ? '<button class="btn plain" id="mCopy">Add to today</button>' : ''}</div>
  </div>${st === 'off' ? '' : healthCard(k)}`;
}
function bindDetail(){
  const e = $('#mEdit'); if (e) e.onclick = () => { day = sel; window.FSApp && FSApp.show('cal'); };
  const s = $('#mStatus'); if (s) s.onclick = () => openStatus(sel, renderMonth);
  const c = $('#mCopy'); if (c) c.onclick = () => {
    const src = dayEntries(sel); if (!src.length) return;
    saveDay(today(), dayEntries(today()).concat(src.map(x => Object.assign({}, x, {id: uid(), ts: Date.now()}))));
    toast(`Added ${src.length} item${src.length > 1 ? 's' : ''} to today`);
  };
}

// ---------------- add food ----------------
function openAdd(meal){
  const rec = store.get(K_RECENT, []).filter(f => !f.recipeId);
  sheet(`<h2>Add to ${MEAL_NAME[meal]}</h2>
    <div class="row" style="margin-top:4px"><button class="btn primary" id="aScan">Scan a barcode</button><button class="btn plain" id="aSearch">Search</button></div>
    ${(() => { const R = Object.values(recipes()).sort((a, b) => (b.fav - a.fav) || (b.updated || 0) - (a.updated || 0));
      return `<div class="lblrow"><label class="lbl">Recipes</label><button class="lnk" id="aNewRec">+ New recipe</button></div>` + (R.length ? `<div class="plist calrec" style="margin-top:8px">${R.slice(0, 8).map(r => { const f = recipeFood(r);
        return `<div class="pl" data-r="${esc(r.id)}" role="button" tabindex="0"><div class="t"><b class="notr">${r.fav ? '★ ' : ''}${esc(r.name)}</b><span>${eFmt(f.fixed.kcal)} per serve</span></div><div class="plus">+</div></div>`; }).join('')}</div>`
        : '<p class="muted" style="margin-top:6px">Save meals you make often as recipes to log them in one tap.</p>'); })()}
    ${rec.length ? `<label class="lbl">Recent foods</label><div class="plist calrec" style="margin-top:8px">${rec.slice(0, 12).map((f, i) => `<div class="pl" data-i="${i}" role="button" tabindex="0">
      <div class="t"><b class="notr">${esc(f.name)}</b><span class="notr">${esc([f.brand, f.fixed ? eFmt(f.fixed.kcal) : f.per100 ? eFmt(f.per100.kcal) + ' / 100' + (f.u || 'g') : ''].filter(Boolean).join(' · '))}</span></div>
      <div class="plus">+</div></div>`).join('')}</div>` : ''}
    <label class="lbl">Quick add</label>
    <input class="field" id="qName" placeholder="What did you eat? (optional)">
    <div class="ngrid3">
      <div><span class="muted">Energy (${eUnit()})</span><input class="field" id="qE" inputmode="decimal" placeholder="0"></div>
      <div><span class="muted">Servings</span><input class="field" id="qN" inputmode="decimal" value="1"></div>
    </div>
    <div class="ngrid3">
      <div><span class="muted">Protein g</span><input class="field" id="qP" inputmode="decimal" placeholder="—"></div>
      <div><span class="muted">Carbs g</span><input class="field" id="qC" inputmode="decimal" placeholder="—"></div>
      <div><span class="muted">Fat g</span><input class="field" id="qF" inputmode="decimal" placeholder="—"></div>
    </div>
    <button class="btn ghost" id="qGoAdd" style="margin-top:12px">Add</button>
    <button class="btn plain" id="aClose" style="margin-top:8px">Cancel</button>`, s => {
    s.querySelector('#aClose').onclick = close;
    s.querySelector('#aScan').onclick = () => { pending = {meal, ts: Date.now()}; close(); if (window.FSApp){ FSApp.show('scan'); FSApp.startScan(); } };
    s.querySelector('#aSearch').onclick = () => { pending = {meal, ts: Date.now()}; close(); if (window.FSApp){ FSApp.show('scan'); setTimeout(() => { const q = $('#q'); if (q){ q.focus(); q.scrollIntoView({block: 'center'}); } }, 50); } };
    s.querySelectorAll('.calrec .pl[data-i]').forEach(r => r.onclick = () => openAmount(rec[+r.dataset.i], meal));
    s.querySelectorAll('.calrec .pl[data-r]').forEach(r => r.onclick = () => openAmount(recipeFood(recipes()[r.dataset.r]), meal));
    s.querySelector('#aNewRec').onclick = () => { close(); window.FSApp && FSApp.show('recipes'); openRecipeEditor(null); };
    s.querySelector('#qGoAdd').onclick = () => {
      const e = num(s.querySelector('#qE').value);
      if (!e || e <= 0){ s.querySelector('#qE').focus(); toast('Enter the energy first'); return; }
      const kcal = unit() === 'kj' ? e / KJ : e;
      const food = {name: s.querySelector('#qName').value.trim() || 'Quick add', brand: '', code: '', per100: null,
        fixed: {kcal, p: num(s.querySelector('#qP').value) || 0, c: num(s.querySelector('#qC').value) || 0, f: num(s.querySelector('#qF').value) || 0}};
      addEntry(food, meal, num(s.querySelector('#qN').value) || 1, 'item');
      close(); toast(`Added to ${MEAL_NAME[meal]}`); render();
    };
  });
}

// amount picker (recent foods + editing an entry)
function unitsFor(food){
  if (food.fixed) return [['item', food.recipeId ? 'Serves' : 'Servings']];
  const u = [['g', food.u === 'ml' ? 'ml' : 'grams']];
  if (food.serveG) u.push(['serve', 'Serves']);
  if (food.packG) u.push(['pack', 'Packs']);
  return u;
}
function amountBlock(food, qty, qunit, meal){
  return `${meal === null ? '' : `<label class="lbl" style="margin-top:6px">Meal</label>
    <div class="seg calms">${MEALS.map(([m, n]) => `<button data-m="${m}" class="${m === meal ? 'on' : ''}">${n}</button>`).join('')}</div>`}
    <label class="lbl">Amount</label>
    <div class="calamt"><input class="field" id="amtQ" inputmode="decimal" value="${esc(qty)}">
      <div class="seg calus">${unitsFor(food).map(([u, n]) => `<button data-u="${u}" class="${u === qunit ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <p class="calprev" id="amtPrev"></p>
    <div class="nbox">${nutTabs('amt')}</div>`;
}
function bindAmount(s, food, state){
  const prev = () => {
    const v = compute(food, s.querySelector('#amtQ').value, state.qunit);
    s.querySelector('#amtPrev').innerHTML = `<b>${eFmt(v.kcal)}</b> for this amount`;
    s.querySelector('.nbox [data-p="mac"]').innerHTML = macroRows(v);
    s.querySelector('.nbox [data-p="more"]').innerHTML = microRows(v, 'food');
  };
  bindTabs(s.querySelector('.nbox'));
  s.querySelectorAll('.calms button').forEach(b => b.onclick = () => { state.meal = b.dataset.m; s.querySelectorAll('.calms button').forEach(x => x.classList.toggle('on', x === b)); });
  s.querySelectorAll('.calus button').forEach(b => b.onclick = () => {
    const was = state.qunit; state.qunit = b.dataset.u;
    s.querySelectorAll('.calus button').forEach(x => x.classList.toggle('on', x === b));
    if (was !== state.qunit){                 // keep the same amount of food when switching units
      const q = num(s.querySelector('#amtQ').value) || 0;
      const grams = was === 'serve' ? q * (food.serveG || 0) : was === 'pack' ? q * (food.packG || 0) : q;
      const nq = state.qunit === 'serve' ? grams / food.serveG : state.qunit === 'pack' ? grams / food.packG : grams;
      s.querySelector('#amtQ').value = grams > 0 ? (state.qunit === 'g' ? Math.round(nq) : r1(nq)) : (state.qunit === 'g' ? 100 : 1);
    }
    prev();
  });
  s.querySelector('#amtQ').oninput = prev;
  prev();
}
function openAmount(food, meal, fromRecipes, onAdded){
  const state = {meal, qunit: food.fixed ? 'item' : (food.lastUnit && unitsFor(food).some(u => u[0] === food.lastUnit) ? food.lastUnit : food.serveG ? 'serve' : 'g')};
  const qty = food.lastQty != null && food.lastUnit === state.qunit ? food.lastQty : state.qunit === 'g' ? 100 : 1;
  sheet(`<h2 class="notr">${esc(food.name)}</h2>${food.brand ? `<p class="muted notr">${esc(food.brand)}</p>` : ''}
    ${amountBlock(food, qty, state.qunit, meal)}
    <button class="btn primary" id="amtGo" style="margin-top:12px">Add</button>
    <button class="btn plain" id="amtBack" style="margin-top:8px">Back</button>`, s => {
    bindAmount(s, food, state);
    s.querySelector('#amtBack').onclick = () => fromRecipes ? close() : openAdd(meal);
    s.querySelector('#amtGo').onclick = () => {
      const q = num(s.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
      addEntry(food, state.meal, q, state.qunit, fromRecipes ? (fromRecipes === 'day' ? day : today()) : day); close(); toast(`Added to ${MEAL_NAME[state.meal]}`); render();
      if (onAdded) onAdded(state.meal);
    };
  });
}
function openEdit(id){
  const list = dayEntries(day), e = list.find(x => x.id === id); if (!e) return;
  const state = {meal: e.meal, qunit: e.qunit};
  sheet(`<h2 class="notr">${esc(e.name)}</h2>${e.brand ? `<p class="muted notr">${esc(e.brand)}</p>` : ''}
    ${amountBlock(e, e.qty, e.qunit, e.meal)}
    <div class="row" style="margin-top:12px"><button class="btn danger" id="eDel">Delete</button><button class="btn primary" id="eSave">Save</button></div>
    <button class="btn ghost" id="eHab" style="margin-top:8px">${e.habit && habits().some(h => h.id === e.habit) ? 'Edit habit' : 'Make it a habit'}</button>
    ${e.recipeId && recipes()[e.recipeId] ? `<button class="btn plain" id="eRec" style="margin-top:8px">Open recipe</button>` : ''}
    ${e.code && window.FSApp ? `<button class="btn plain" id="eOpen" style="margin-top:8px">See product score</button>` : ''}
    <button class="btn plain" id="eClose" style="margin-top:8px">Cancel</button>`, s => {
    s.querySelector('#eHab').onclick = () => {
      const ex = e.habit && habits().find(h => h.id === e.habit);
      if (ex) return openHabit(null, ex);
      openHabit(e.recipeId && recipes()[e.recipeId] ? {kind: 'recipe', recipeId: e.recipeId, name: e.name, meal: e.meal, qty: e.qty, qunit: e.qunit}
        : {kind: 'food', food: cleanFood(e), name: e.name, meal: e.meal, qty: e.qty, qunit: e.qunit});
    };
    const er = s.querySelector('#eRec'); if (er) er.onclick = () => { window.FSApp && FSApp.show('recipes'); openRecipe(e.recipeId); };
    bindAmount(s, e, state);
    s.querySelector('#eClose').onclick = close;
    s.querySelector('#eDel').onclick = () => { saveDay(day, list.filter(x => x.id !== id)); close(); toast('Removed'); render(); };
    s.querySelector('#eSave').onclick = () => {
      const q = num(s.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
      const v = compute(e, q, state.qunit);
      delete v.grams; Object.assign(e, v, {qty: q, qunit: state.qunit, meal: state.meal});
      saveDay(day, list); close(); toast('Saved'); render();
    };
    const o = s.querySelector('#eOpen'); if (o) o.onclick = () => { close(); FSApp.lookup(e.code); };
  });
}

// ---------------- daily target ----------------
function openGoal(){
  const g = store.get(K_GOAL, {}) || {}, pr = g.profile || {};
  const ACT = [['1.2', 'Mostly sitting'], ['1.375', 'Light (1–3 workouts a week)'], ['1.55', 'Moderate (3–5 a week)'], ['1.725', 'Very active (6–7 a week)'], ['1.9', 'Physical job + training']];
  const AIM = [['-500', 'Lose about 0.5kg a week'], ['-250', 'Lose slowly'], ['0', 'Stay the same'], ['250', 'Gain slowly'], ['500', 'Gain about 0.5kg a week']];
  sheet(`<h2>Daily target</h2>
    <p class="muted">Worked out with the Mifflin–St Jeor formula. Saved on this phone only.</p>
    <label class="lbl">Sex</label>
    <div class="seg" id="gSex"><button data-s="f" class="${pr.sex === 'f' ? 'on' : ''}">Female</button><button data-s="m" class="${pr.sex === 'm' ? 'on' : ''}">Male</button></div>
    <div class="ngrid3">
      <div><span class="muted">Age</span><input class="field" id="gAge" inputmode="numeric" value="${esc(pr.age || '')}"></div>
      <div><span class="muted">Height cm</span><input class="field" id="gH" inputmode="decimal" value="${esc(pr.h || '')}"></div>
      <div><span class="muted">Weight kg</span><input class="field" id="gW" inputmode="decimal" value="${esc(pr.w || '')}"></div>
    </div>
    <label class="lbl">Activity</label>
    <select class="field" id="gAct">${ACT.map(([v, n]) => `<option value="${v}" ${String(pr.act || '1.375') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <label class="lbl">Goal</label>
    <select class="field" id="gAim">${AIM.map(([v, n]) => `<option value="${v}" ${String(pr.aim ?? '0') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <div class="calcalc" id="gOut"></div>
    <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Or type your own target</summary>
      <input class="field" id="gOwn" inputmode="decimal" placeholder="e.g. ${unit() === 'kj' ? '8700' : '2000'} ${eUnit()}" value="${g.manual ? eVal(g.kcal) : ''}"></details>
    <button class="btn primary" id="gSave" style="margin-top:14px">Save target</button>
    <button class="btn ghost" id="gMac" style="margin-top:8px">Set your own macros</button>
    ${g.kcal && !g.kcalAuto ? '<button class="btn plain" id="gReset" style="margin-top:8px">Reset to the general target</button>' : ''}
    <button class="btn plain" id="gClose" style="margin-top:8px">Cancel</button>`, s => {
    let sex = pr.sex || null;
    const calc = () => {
      const own = num(s.querySelector('#gOwn').value);
      if (own){ const kcal = unit() === 'kj' ? own / KJ : own; return {kcal: Math.round(kcal), manual: true}; }
      const age = num(s.querySelector('#gAge').value), h = num(s.querySelector('#gH').value), w = num(s.querySelector('#gW').value);
      if (!sex || !age || !h || !w) return null;
      const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'm' ? 5 : -161);
      const tdee = bmr * +s.querySelector('#gAct').value;
      const floor = sex === 'm' ? 1500 : 1200;
      let kcal = Math.round((tdee + +s.querySelector('#gAim').value) / 10) * 10, floored = false;
      if (kcal < floor){ kcal = floor; floored = true; }
      return {kcal, bmr: Math.round(bmr), tdee: Math.round(tdee), floored, w, profile: {sex, age, h, w, act: s.querySelector('#gAct').value, aim: s.querySelector('#gAim').value}};
    };
    const out = () => {
      const c = calc(), o = s.querySelector('#gOut');
      if (!c){ o.innerHTML = '<p class="muted">Fill in sex, age, height and weight to see your number.</p>'; return; }
      o.innerHTML = `<div class="big"><b>${eFmt(c.kcal)}</b><span>a day</span></div>` + (c.manual ? '' :
        `<p class="muted">Your body uses about ${eFmt(c.bmr)} at rest and ${eFmt(c.tdee)} with your activity.${c.floored ? ` Kept at ${eFmt(c.kcal)} — going lower than this isn't recommended without a doctor or dietitian.` : ''}</p>`);
    };
    s.querySelectorAll('#gSex button').forEach(b => b.onclick = () => { sex = b.dataset.s; s.querySelectorAll('#gSex button').forEach(x => x.classList.toggle('on', x === b)); out(); });
    s.querySelectorAll('input,select').forEach(i => { i.oninput = out; i.onchange = out; });
    out();
    s.querySelector('#gClose').onclick = close;
    s.querySelector('#gMac').onclick = openMacros;
    const rs = s.querySelector('#gReset'); if (rs) rs.onclick = () => { saveGoal({kcalAuto: true, manual: false}); close(); render(); toast('Back to the general target'); };
    s.querySelector('#gSave').onclick = () => {
      const c = calc(); if (!c){ toast('Fill in your details or type a number'); return; }
      saveGoal({kcal: c.kcal, kcalAuto: false, manual: !!c.manual, profile: c.profile || pr});
      const mm = goal().macroMode;
      close(); render(); toast(mm === 'grams' ? 'Target saved — your own macro grams are kept' : 'Target saved');
    };
  });
}

// ---------------- your own macros ----------------
function openMacros(){
  const g = goal(), stored = store.get(K_GOAL, null) || {}, w = (stored.profile || {}).w;
  let mode = g.macroMode;
  const pct0 = stored.pct || {p: Math.round(g.protein * 4 / g.kcal * 100), c: Math.round(g.carbs * 4 / g.kcal * 100), f: 0};
  if (!stored.pct) pct0.f = 100 - pct0.p - pct0.c;
  sheet(`<h2>Macro targets</h2>
    <p class="muted">Daily target ${eFmt(g.kcal)}. Choose how you want to set protein, carbs and fat.</p>
    <div class="seg" id="mMode"><button data-m="auto">Auto</button><button data-m="pct">By %</button><button data-m="grams">By grams</button></div>
    <div id="mAuto" class="mpane"><p class="muted" style="margin-top:10px">Protein from your body weight (about 1g per kg, 1.2g when losing weight), 30% fat, and the rest carbs. Add your weight in Daily target to make it personal.</p></div>
    <div id="mPct" class="mpane">
      <div class="chips" id="mPre">${PRESETS.map(([n, p, c, f]) => `<span class="chip" data-p="${p}" data-c="${c}" data-f="${f}">${n} <span class="muted">${p}/${c}/${f}</span></span>`).join('')}</div>
      <div class="ngrid3">
        <div><span class="muted">Protein %</span><input class="field" id="mPp" inputmode="numeric" value="${pct0.p}"></div>
        <div><span class="muted">Carbs %</span><input class="field" id="mPc" inputmode="numeric" value="${pct0.c}"></div>
        <div><span class="muted">Fat %</span><input class="field" id="mPf" inputmode="numeric" value="${pct0.f}"></div>
      </div></div>
    <div id="mGr" class="mpane">
      <div class="ngrid3">
        <div><span class="muted">Protein g</span><input class="field" id="mGp" inputmode="numeric" value="${g.protein}"></div>
        <div><span class="muted">Carbs g</span><input class="field" id="mGc" inputmode="numeric" value="${g.carbs}"></div>
        <div><span class="muted">Fat g</span><input class="field" id="mGf" inputmode="numeric" value="${g.fat}"></div>
      </div></div>
    <div class="ngrid3"><div><span class="muted">Fibre g</span><input class="field" id="mFib" inputmode="numeric" value="${g.fibre}"></div></div>
    <div class="calcalc" id="mOut"></div>
    <button class="btn primary" id="mSave" style="margin-top:14px">Save macros</button>
    <button class="btn plain" id="mClose" style="margin-top:8px">Cancel</button>`, s => {
    const v = id => num(s.querySelector(id).value) || 0;
    const result = () => {
      if (mode === 'pct'){ const p = v('#mPp'), c = v('#mPc'), f = v('#mPf');
        return {p, c, f, ok: Math.round(p + c + f) === 100, g: {protein: Math.round(g.kcal * p / 400), carbs: Math.round(g.kcal * c / 400), fat: Math.round(g.kcal * f / 900)}}; }
      if (mode === 'grams'){ const gg = {protein: v('#mGp'), carbs: v('#mGc'), fat: v('#mGf')}; return {g: gg, ok: gg.protein + gg.carbs + gg.fat > 0}; }
      return {g: autoMacros(g.kcal, w, (stored.profile || {}).aim), ok: true};
    };
    const out = () => {
      ['auto', 'pct', 'grams'].forEach(m => s.querySelector({auto: '#mAuto', pct: '#mPct', grams: '#mGr'}[m]).classList.toggle('hidden', m !== mode));
      s.querySelectorAll('#mMode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      const r = result(), m = r.g, kcal = m.protein * 4 + m.carbs * 4 + m.fat * 9;
      let note = '';
      if (mode === 'pct' && !r.ok) note = `<p style="color:var(--warn-ink);margin-top:6px">Your percentages add up to ${Math.round(r.p + r.c + r.f)}% — they need to make 100%.</p>`;
      if (mode === 'grams' && Math.abs(kcal - g.kcal) > g.kcal * .05) note = `<p class="muted" style="margin-top:6px">These add up to ${eFmt(kcal)}, ${kcal > g.kcal ? 'more' : 'less'} than your ${eFmt(g.kcal)} target.</p><button class="btn plain" id="mMatch" style="margin-top:8px">Make ${eFmt(kcal)} my daily target</button>`;
      s.querySelector('#mOut').innerHTML = `<div class="mres"><div><b>${m.protein}g</b><span>protein</span></div><div><b>${m.carbs}g</b><span>carbs</span></div><div><b>${m.fat}g</b><span>fat</span></div></div>
        ${w && m.protein ? `<p class="muted" style="margin-top:6px">Protein is ${r1(m.protein / w)}g per kg of body weight.</p>` : ''}${note}`;
      const mm = s.querySelector('#mMatch'); if (mm) mm.onclick = () => {
        saveGoal(Object.assign({kcal: Math.round(kcal), kcalAuto: false, manual: true, macroMode: 'grams', fibre: Math.max(5, Math.min(80, v('#mFib') || 25))}, m));
        close(); render(); toast('Target and macros saved');
      };
    };
    s.querySelectorAll('#mMode button').forEach(b => b.onclick = () => { mode = b.dataset.m; out(); });
    s.querySelectorAll('#mPre .chip').forEach(c => c.onclick = () => { s.querySelector('#mPp').value = c.dataset.p; s.querySelector('#mPc').value = c.dataset.c; s.querySelector('#mPf').value = c.dataset.f; out(); });
    s.querySelectorAll('input').forEach(i => i.oninput = out);
    out();
    s.querySelector('#mClose').onclick = close;
    s.querySelector('#mSave').onclick = () => {
      const r = result(); if (!r.ok){ toast(mode === 'pct' ? 'Percentages need to add up to 100' : 'Enter your macros'); return; }
      const fib = Math.max(5, Math.min(80, v('#mFib') || 25));
      const patch = {macroMode: mode, fibre: fib};
      if (mode === 'pct') patch.pct = {p: r.p, c: r.c, f: r.f};
      if (mode === 'grams') Object.assign(patch, r.g);
      if (!stored.kcal) Object.assign(patch, {kcal: DEFAULT_KCAL, kcalAuto: true});
      saveGoal(patch); close(); render(); toast('Macros saved');
    };
  });
}

// ======================================================================
// Recipes · habits (auto-add) · hydration
// ======================================================================
const K_RECIPES = 'fs_recipes', K_HABITS = 'fs_habits', K_WATER = 'fs_water', K_WATER_GOAL = 'fs_water_goal';
const recipes = () => store.get(K_RECIPES, {});
const saveRecipes = r => store.set(K_RECIPES, r);
const habits = () => store.get(K_HABITS, []);
const saveHabits = h => store.set(K_HABITS, h);
const ICON_STAR = on => `<svg viewBox="0 0 24 24" class="star${on ? ' on' : ''}" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`;
const ICON_REPEAT = '<svg viewBox="0 0 24 24" class="rep" aria-hidden="true"><path d="M4 12a7 7 0 0 1 12-4.9L18 9M20 12a7 7 0 0 1-12 4.9L6 15M18 4v5h-5M6 20v-5h5"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const MEAL_TIME = {breakfast: '07:30', lunch: '12:30', dinner: '18:30', snack: '15:00'};
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];       // index 0 = Monday
const wd = k => (fromKey(k).getDay() + 6) % 7;
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)}${h < 12 ? 'am' : 'pm'}`; };

// ---------------- recipes: nutrition ----------------
function recipeTotals(r){
  const parts = (r.items || []).map(it => Object.assign(compute(it.food, it.qty, it.qunit), {score: it.food.score}));
  const t = sum(parts);
  const sc = parts.filter(x => typeof x.score === 'number' && x.kcal > 0), sk = sc.reduce((a, x) => a + x.kcal, 0);
  t.score = sk > 0 ? Math.round(sc.reduce((a, x) => a + x.score * x.kcal, 0) / sk) : null;
  return t;
}
function recipeFood(r){                 // a recipe as something that can be logged, per serve
  const t = recipeTotals(r), n = Math.max(1, r.serves || 1), fixed = {micro: {}};
  NK.forEach(k => fixed[k] = t[k] / n);
  for (const m in t.micro) fixed.micro[m] = t.micro[m] / n;
  return {name: r.name, brand: 'Recipe', code: '', recipeId: r.id, fixed, per100: null, score: t.score, u: 'g'};
}
function ingText(it){ return it.qunit === 'item' ? (it.qty === 1 ? '1 serve' : `${r1(it.qty)} serves`) : qtyText(it.food && Object.assign({}, it.food, {qty: it.qty, qunit: it.qunit})); }

// ---------------- recipes: list view ----------------
let recTab = 'all', draft = null;
function renderRecipes(){
  const el = $('#v-recipes'); if (!el) return;
  const R = Object.values(recipes()).sort((a, b) => (b.fav - a.fav) || (b.updated || 0) - (a.updated || 0));
  const H = habits();
  const list = recTab === 'fav' ? R.filter(r => r.fav) : R;
  const habitFor = id => H.find(h => h.recipeId === id && h.on);
  el.innerHTML = `
  <div class="tdhead"><div class="tdl"><h1 class="vtitle">Recipes</h1></div>
    <div class="rbtns"><button class="rb rbp" id="rNew" aria-label="New recipe">${ICON_PLUS}</button></div></div>
  <p class="tdsub">Save meals you make often, then log them in one tap or let them add themselves.</p>
  <div class="useg wide" id="rTabs"><button data-t="all" class="${recTab === 'all' ? 'on' : ''}">All</button><button data-t="fav" class="${recTab === 'fav' ? 'on' : ''}">Favourites</button><button data-t="hab" class="${recTab === 'hab' ? 'on' : ''}">Habits${H.length ? ` · ${H.length}` : ''}</button></div>
  ${recTab === 'hab' ? habitsList(H) : list.length ? `<div class="rlist">${list.map(r => { const f = recipeFood(r), h = habitFor(r.id);
    return `<div class="card rcard" data-id="${esc(r.id)}" role="button" tabindex="0">
      <div class="rtop"><div class="t"><b class="notr">${esc(r.name)}</b><span>${r.serves} serve${r.serves > 1 ? 's' : ''} · ${(r.items || []).length} ingredient${(r.items || []).length === 1 ? '' : 's'}</span></div>
        ${typeof f.score === 'number' ? `<span class="fsc" style="background:${scoreCol(f.score)}">${f.score}</span>` : ''}
        <button class="rfav" data-fav="${esc(r.id)}" aria-label="${r.fav ? 'Remove from favourites' : 'Add to favourites'}">${ICON_STAR(r.fav)}</button></div>
      <div class="rmac"><span><b>${eVal(f.fixed.kcal).toLocaleString('en-AU')}</b> ${eUnit()}</span><span style="color:var(--pro)"><b>${Math.round(f.fixed.p)}g</b> protein</span><span style="color:var(--carb)"><b>${Math.round(f.fixed.c)}g</b> carbs</span><span style="color:var(--fat)"><b>${Math.round(f.fixed.f)}g</b> fat</span></div>
      <div class="rfoot"><span class="muted">per serve</span>${h ? `<span class="hbadge">${ICON_REPEAT}${esc(habitWhen(h))}</span>` : ''}<button class="rlog" data-log="${esc(r.id)}">${ICON_PLUS}Log</button></div>
    </div>`; }).join('')}</div>`
    : `<div class="card rempty"><b>${recTab === 'fav' ? 'No favourites yet' : 'No recipes yet'}</b><p class="muted">${recTab === 'fav' ? 'Tap the star on a recipe to keep it here.' : 'Build one from foods you\'ve scanned, fruit & veg, or your own numbers. HealthierSlop works out the calories, macros and health score per serve.'}</p>
       ${recTab === 'fav' ? '' : '<button class="btn primary" id="rNew2" style="margin-top:12px">Create a recipe</button>'}</div>`}`;
  const nw = () => openRecipeEditor(null);
  $('#rNew').onclick = nw; const n2 = $('#rNew2'); if (n2) n2.onclick = nw;
  el.querySelectorAll('#rTabs button').forEach(b => b.onclick = () => { recTab = b.dataset.t; renderRecipes(); });
  el.querySelectorAll('.rcard').forEach(c => c.onclick = ev => {
    const fv = ev.target.closest('[data-fav]'), lg = ev.target.closest('[data-log]');
    if (fv){ const R2 = recipes(); R2[fv.dataset.fav].fav = !R2[fv.dataset.fav].fav; saveRecipes(R2); renderRecipes(); toast(R2[fv.dataset.fav].fav ? 'Added to favourites' : 'Removed from favourites'); return; }
    if (lg){ openAmount(recipeFood(recipes()[lg.dataset.log]), mealNow(), true); return; }
    openRecipe(c.dataset.id);
  });
  el.querySelectorAll('.hrow').forEach(r => r.onclick = ev => {
    const H2 = habits(), h = H2.find(x => x.id === r.dataset.id); if (!h) return;
    if (ev.target.closest('.tgl')){ h.on = !h.on; saveHabits(H2); renderRecipes(); toast(h.on ? 'Habit on' : 'Habit paused'); return; }
    openHabit(null, h);
  });
}
function habitWhen(h){
  const d = h.days || [0, 1, 2, 3, 4, 5, 6];
  const rep = d.length === 7 ? 'Daily' : d.join() === '0,1,2,3,4' ? 'Weekdays' : d.join() === '5,6' ? 'Weekends' : d.map(i => DAYS_SHORT[i]).join(', ');
  return `${rep} · ${fmtTime(h.time)}`;
}
function habitsList(H){
  if (!H.length) return `<div class="card rempty"><b>No habits yet</b><p class="muted">Open a recipe (or tap a food you've logged) and choose <b>Make it a habit</b>. It'll be added for you at the time and days you pick.</p></div>`;
  return `<div class="card hlist">${H.map(h => `<div class="hrow" data-id="${esc(h.id)}" role="button" tabindex="0">
      <span class="hic${h.on ? '' : ' off'}">${ICON_REPEAT}</span>
      <div class="t"><b class="notr">${esc(h.name)}</b><span>${esc(MEAL_NAME[h.meal])} · ${esc(habitWhen(h))}</span></div>
      <button class="tgl${h.on ? ' on' : ''}" aria-label="${h.on ? 'Pause habit' : 'Turn habit on'}"><i></i></button></div>`).join('')}
    <p class="muted" style="margin-top:10px">Habits add themselves when you open HealthierSlop after their time. Days marked Off are skipped, and anything you delete stays deleted.</p></div>`;
}

// ---------------- recipes: detail ----------------
function openRecipe(id){
  const r = recipes()[id]; if (!r) return;
  const f = recipeFood(r), h = habits().find(x => x.recipeId === id);
  sheet(`<div class="rdh"><h2 class="notr">${esc(r.name)}</h2><button class="rfav" id="rdFav">${ICON_STAR(r.fav)}</button></div>
    <p class="muted">${r.serves} serve${r.serves > 1 ? 's' : ''} · nutrition per serve</p>
    <div class="rdsum"><div><b>${eVal(f.fixed.kcal).toLocaleString('en-AU')}</b><span>${eUnit()}</span></div><div><b style="color:var(--pro)">${Math.round(f.fixed.p)}g</b><span>protein</span></div><div><b style="color:var(--carb)">${Math.round(f.fixed.c)}g</b><span>carbs</span></div><div><b style="color:var(--fat)">${Math.round(f.fixed.f)}g</b><span>fat</span></div>
      ${typeof f.score === 'number' ? `<div><b style="color:${scoreCol(f.score)}">${f.score}</b><span>health</span></div>` : ''}</div>
    <div class="nbox" id="rdNut">${nutTabs('rd')}</div>
    <label class="lbl">Ingredients</label>
    <div class="rings">${(r.items || []).map(it => `<div class="ri"><div class="t"><b class="notr">${esc(it.food.name)}</b><span class="notr">${esc(ingText(it))}</span></div><span class="k">${eVal(compute(it.food, it.qty, it.qunit).kcal)}</span></div>`).join('') || '<p class="muted">No ingredients.</p>'}</div>
    ${r.notes ? `<label class="lbl">Method & notes</label><p class="rnotes notr">${esc(r.notes)}</p>` : ''}
    <button class="btn primary" id="rdLog" style="margin-top:16px">Add to today</button>
    <button class="btn ghost" id="rdHab" style="margin-top:8px">${h ? `Habit: ${esc(habitWhen(h))}` : 'Make it a habit'}</button>
    <div class="row" style="margin-top:8px"><button class="btn plain" id="rdEdit">Edit</button><button class="btn plain" id="rdDup">Duplicate</button></div>
    <button class="btn danger" id="rdDel" style="margin-top:8px">Delete recipe</button>
    <button class="btn plain" id="rdClose" style="margin-top:8px">Close</button>`, s => {
    const nb = s.querySelector('#rdNut'), v = Object.assign({}, f.fixed);
    nb.querySelector('[data-p="mac"]').innerHTML = macroRows(v); nb.querySelector('[data-p="more"]').innerHTML = microRows(v, 'food');
    bindTabs(nb);
    s.querySelector('#rdClose').onclick = close;
    s.querySelector('#rdFav').onclick = () => { const R = recipes(); R[id].fav = !R[id].fav; saveRecipes(R); openRecipe(id); renderRecipes(); };
    s.querySelector('#rdLog').onclick = () => openAmount(recipeFood(recipes()[id]), mealNow(), true);
    s.querySelector('#rdHab').onclick = () => openHabit({kind: 'recipe', recipeId: id, name: r.name}, h);
    s.querySelector('#rdEdit').onclick = () => openRecipeEditor(id);
    s.querySelector('#rdDup').onclick = () => { const R = recipes(), c = JSON.parse(JSON.stringify(R[id])); c.id = uid(); c.name += ' (copy)'; c.fav = false; c.updated = Date.now(); R[c.id] = c; saveRecipes(R); renderRecipes(); openRecipe(c.id); toast('Duplicated'); };
    const del = s.querySelector('#rdDel');
    del.onclick = () => {
      if (!del.dataset.armed){ del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
      const R = recipes(); delete R[id]; saveRecipes(R); saveHabits(habits().filter(x => x.recipeId !== id)); close(); renderRecipes(); toast('Recipe deleted');
    };
  });
}

// ---------------- recipes: editor ----------------
function openRecipeEditor(id){
  if (id !== undefined && !(draft && draft._editing === id && draft._resume)){
    const r = id ? recipes()[id] : null;
    draft = r ? Object.assign(JSON.parse(JSON.stringify(r)), {_editing: id}) : {id: uid(), name: '', serves: 1, items: [], notes: '', fav: false, _editing: null};
  }
  if (!draft) return;
  draft._resume = false;
  const t = recipeTotals(draft), n = Math.max(1, num(draft.serves) || 1);
  sheet(`<h2>${draft._editing ? 'Edit recipe' : 'New recipe'}</h2>
    <label class="lbl">Name</label><input class="field" id="reName" placeholder="e.g. Overnight oats" value="${esc(draft.name)}">
    <label class="lbl">Makes how many serves?</label>
    <div class="stepper"><button id="reMinus" aria-label="Fewer serves">−</button><input class="field" id="reServes" inputmode="numeric" value="${esc(draft.serves)}"><button id="rePlus" aria-label="More serves">+</button></div>
    <label class="lbl">Ingredients</label>
    <div class="rings">${draft.items.map((it, i) => `<div class="ri" data-i="${i}"><div class="t"><b class="notr">${esc(it.food.name)}</b><span class="notr">${esc(ingText(it))} · ${eFmt(compute(it.food, it.qty, it.qunit).kcal)}</span></div>
      <button class="rix" data-x="${i}" aria-label="Remove">×</button></div>`).join('') || '<p class="muted" style="margin:4px 0 6px">Add what goes in it — amounts for the whole recipe.</p>'}</div>
    <div class="addgrid">
      <button class="addb" id="reScan"><b>Scan or search</b><span>Any food or drink</span></button>
      <button class="addb" id="reRecent"><b>Recent foods</b><span>Things you've logged</span></button>
      <button class="addb" id="reFresh"><b>Fruit & veg</b><span>Built-in list</span></button>
      <button class="addb" id="reOwn"><b>Type it in</b><span>Your own numbers</span></button>
    </div>
    ${draft.items.length ? `<div class="calcalc"><div class="big"><b>${eFmt(t.kcal / n)}</b><span>per serve</span></div>
      <p class="muted">Protein ${r1(t.p / n)}g · Carbs ${r1(t.c / n)}g · Fat ${r1(t.f / n)}g${t.score != null ? ` · Health score ${t.score}` : ''}</p></div>` : ''}
    <label class="lbl">Method & notes (optional)</label><textarea class="field" id="reNotes" placeholder="How you make it">${esc(draft.notes || '')}</textarea>
    <button class="btn primary" id="reSave" style="margin-top:14px">Save recipe</button>
    <button class="btn plain" id="reCancel" style="margin-top:8px">Cancel</button>`, s => {
    const sync = () => { draft.name = s.querySelector('#reName').value; draft.serves = Math.max(1, Math.round(num(s.querySelector('#reServes').value) || 1)); draft.notes = s.querySelector('#reNotes').value; };
    ['#reName', '#reNotes'].forEach(q => s.querySelector(q).oninput = sync);
    s.querySelector('#reServes').onchange = () => { sync(); openRecipeEditor(); };
    s.querySelector('#reMinus').onclick = () => { sync(); draft.serves = Math.max(1, draft.serves - 1); openRecipeEditor(); };
    s.querySelector('#rePlus').onclick = () => { sync(); draft.serves = Math.min(100, draft.serves + 1); openRecipeEditor(); };
    s.querySelectorAll('.rix').forEach(b => b.onclick = ev => { ev.stopPropagation(); sync(); draft.items.splice(+b.dataset.x, 1); openRecipeEditor(); });
    s.querySelectorAll('.ri[data-i]').forEach(r => r.onclick = () => { sync(); const it = draft.items[+r.dataset.i]; ingAmount(it.food, it.qty, it.qunit, (q, u) => { it.qty = q; it.qunit = u; }); });
    s.querySelector('#reScan').onclick = () => { sync(); pending = {recipe: true, ts: Date.now()}; draft._resume = true; close(); if (window.FSApp){ FSApp.show('scan'); setTimeout(() => { const q = $('#q'); if (q) q.scrollIntoView({block: 'center'}); }, 50); } toast('Scan or search for an ingredient'); };
    s.querySelector('#reRecent').onclick = () => { sync(); pickRecent(); };
    s.querySelector('#reFresh').onclick = () => { sync(); pickFresh(); };
    s.querySelector('#reOwn').onclick = () => { sync(); ownIngredient(); };
    s.querySelector('#reCancel').onclick = () => { draft = null; close(); };
    s.querySelector('#reSave').onclick = () => {
      sync();
      if (!draft.name.trim()){ toast('Give it a name'); s.querySelector('#reName').focus(); return; }
      if (!draft.items.length){ toast('Add at least one ingredient'); return; }
      const R = recipes(), rec = {id: draft._editing || draft.id, name: draft.name.trim(), serves: draft.serves, items: draft.items, notes: draft.notes || '', fav: !!draft.fav, updated: Date.now()};
      R[rec.id] = rec; saveRecipes(R); draft = null; close(); renderRecipes(); toast('Recipe saved'); openRecipe(rec.id);
    };
  });
}
function ingAmount(food, qty, qunit, done){       // amount for one ingredient (no meal)
  const state = {qunit: qunit || (food.fixed ? 'item' : food.serveG ? 'serve' : 'g')};
  qty = qty != null ? qty : state.qunit === 'g' ? 100 : 1;
  sheet(`<h2 class="notr">${esc(food.name)}</h2><p class="muted">How much goes into the whole recipe?</p>${amountBlock(food, qty, state.qunit, null)}
    <button class="btn primary" id="iaGo" style="margin-top:12px">${done ? 'Save' : 'Add to recipe'}</button><button class="btn plain" id="iaBack" style="margin-top:8px">Back</button>`, s => {
    bindAmount(s, food, state);
    s.querySelector('#iaBack').onclick = () => { draft._resume = true; openRecipeEditor(); };
    s.querySelector('#iaGo').onclick = () => {
      const q = num(s.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
      if (done) done(q, state.qunit); else draft.items.push({food: cleanFood(food), qty: q, qunit: state.qunit});
      draft._resume = true; openRecipeEditor();
    };
  });
}
function cleanFood(f){ const c = Object.assign({}, f); ['key', 'lastQty', 'lastUnit', 'id', 'meal', 'qty', 'qunit', 'ts', 'habit'].forEach(k => delete c[k]); NK.forEach(k => { if (!c.fixed) delete c[k]; }); delete c.micro; return c; }
function pickRecent(){
  const rec = store.get(K_RECENT, []).filter(f => !f.recipeId);
  sheet(`<h2>Recent foods</h2>${rec.length ? `<div class="plist calrec" style="margin-top:10px">${rec.map((f, i) => `<div class="pl" data-i="${i}" role="button" tabindex="0">
      <div class="t"><b class="notr">${esc(f.name)}</b><span class="notr">${esc([f.brand, f.fixed ? eFmt(f.fixed.kcal) : f.per100 ? eFmt(f.per100.kcal) + ' / 100' + (f.u || 'g') : ''].filter(Boolean).join(' · '))}</span></div><div class="plus">+</div></div>`).join('')}</div>`
    : '<p class="muted" style="margin-top:8px">Nothing yet — foods you log or scan show up here.</p>'}
    <button class="btn plain" id="prBack" style="margin-top:12px">Back</button>`, s => {
    s.querySelector('#prBack').onclick = () => { draft._resume = true; openRecipeEditor(); };
    s.querySelectorAll('.pl').forEach(r => r.onclick = () => ingAmount(rec[+r.dataset.i]));
  });
}
function pickFresh(){
  sheet(`<h2>Fruit & veg</h2><input class="field" id="pfQ" placeholder="e.g. banana, spinach, avocado" autocomplete="off"><div id="pfRes" class="plist calrec" style="margin-top:10px"></div>
    <button class="btn plain" id="pfBack" style="margin-top:12px">Back</button>`, s => {
    const q = s.querySelector('#pfQ'), out = s.querySelector('#pfRes');
    const run = () => {
      const res = window.FSProduce && q.value.trim().length >= 3 ? FSProduce.search(q.value).slice(0, 12) : [];
      out.innerHTML = res.length ? res.map(r => `<div class="pl" data-c="${esc(r.code)}" role="button"><div class="t"><b class="notr">${esc(r.name || r.product_name || r.code)}</b><span>PLU ${esc(r.code)}</span></div><div class="plus">+</div></div>`).join('')
        : `<p class="empty">${q.value.trim().length < 3 ? 'Type at least 3 letters.' : 'No match in the built-in list — try Scan or search, or Type it in.'}</p>`;
      out.querySelectorAll('.pl').forEach(el => el.onclick = () => {
        const p = FSProduce.build(el.dataset.c), A = window.FSApp && FSApp.analyse ? FSApp.analyse(p) : null;
        const food = foodFrom({name: p.product_name, brand: '', code: p.code, score: A ? A.score : null, N: A ? A.N : null, nutriments: p.nutriments, produce: true});
        if (food) ingAmount(food, 100, 'g');
      });
    };
    q.oninput = run; run(); setTimeout(() => q.focus(), 50);
    s.querySelector('#pfBack').onclick = () => { draft._resume = true; openRecipeEditor(); };
  });
}
function ownIngredient(){
  sheet(`<h2>Type it in</h2><p class="muted">For the amount you're putting in the whole recipe.</p>
    <input class="field" id="oiN" placeholder="Ingredient, e.g. 2 tbsp peanut butter">
    <div class="ngrid3"><div><span class="muted">Energy (${eUnit()})</span><input class="field" id="oiE" inputmode="decimal"></div></div>
    <div class="ngrid3"><div><span class="muted">Protein g</span><input class="field" id="oiP" inputmode="decimal" placeholder="—"></div><div><span class="muted">Carbs g</span><input class="field" id="oiC" inputmode="decimal" placeholder="—"></div><div><span class="muted">Fat g</span><input class="field" id="oiF" inputmode="decimal" placeholder="—"></div></div>
    <button class="btn primary" id="oiGo" style="margin-top:12px">Add to recipe</button><button class="btn plain" id="oiBack" style="margin-top:8px">Back</button>`, s => {
    s.querySelector('#oiBack').onclick = () => { draft._resume = true; openRecipeEditor(); };
    s.querySelector('#oiGo').onclick = () => {
      const nm = s.querySelector('#oiN').value.trim(), e = num(s.querySelector('#oiE').value);
      if (!nm){ toast('Name the ingredient'); return; } if (e == null || e < 0){ toast('Enter the energy'); return; }
      const fixed = {kcal: unit() === 'kj' ? e / KJ : e, p: num(s.querySelector('#oiP').value) || 0, c: num(s.querySelector('#oiC').value) || 0, f: num(s.querySelector('#oiF').value) || 0};
      draft.items.push({food: {name: nm, brand: '', code: '', per100: null, fixed}, qty: 1, qunit: 'item'});
      draft._resume = true; openRecipeEditor();
    };
  });
}
// add-to-recipe card on a scanned product (replaces "Add to calorie tracker" while building a recipe)
const pendingRecipe = () => pending && pending.recipe && Date.now() - pending.ts < PENDING_MS && draft;
function mountRecipeAdd(el, food){
  const state = {qunit: food.serveG ? 'serve' : 'g'};
  el.innerHTML = `<div class="card callog"><h2>Add to your recipe</h2><p class="muted notr">${esc(draft.name || 'New recipe')} · amount for the whole recipe</p>
    ${amountBlock(food, state.qunit === 'g' ? 100 : 1, state.qunit, null)}
    <button class="btn primary" id="logGo" style="margin-top:12px">Add to recipe</button>
    <button class="btn plain" id="logCancel" style="margin-top:8px">Back to recipe</button></div>`;
  const card = el.querySelector('.callog');
  bindAmount(card, food, state);
  const back = () => { pending = null; draft._resume = true; window.FSApp && FSApp.show('recipes'); openRecipeEditor(); };
  card.querySelector('#logCancel').onclick = back;
  card.querySelector('#logGo').onclick = () => {
    const q = num(card.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
    draft.items.push({food: cleanFood(food), qty: q, qunit: state.qunit}); toast('Added to recipe'); back();
  };
}

// ---------------- habits ----------------
function openHabit(src, existing){
  const h = existing ? Object.assign({}, existing) : {id: uid(), kind: src.kind, recipeId: src.recipeId || null, food: src.food || null, name: src.name,
    meal: src.meal || mealNow(), qty: src.qty || 1, qunit: src.qunit || 'item', days: [0, 1, 2, 3, 4, 5, 6], time: MEAL_TIME[src.meal || mealNow()], on: true, done: {}};
  const food = h.recipeId ? (recipes()[h.recipeId] ? recipeFood(recipes()[h.recipeId]) : null) : h.food;
  if (!food){ toast('That recipe no longer exists'); return; }
  let days = [...h.days];
  sheet(`<h2>${existing ? 'Edit habit' : 'Make it a habit'}</h2><p class="muted notr">${esc(h.name)}</p>
    ${amountBlock(food, h.qty, h.qunit, h.meal)}
    <label class="lbl">Repeat</label>
    <div class="chips" id="hbRep"><span class="chip" data-r="all">Every day</span><span class="chip" data-r="wk">Weekdays</span><span class="chip" data-r="we">Weekends</span></div>
    <div class="dayrow" id="hbDays">${DAYS_SHORT.map((d, i) => `<button data-d="${i}" class="${days.includes(i) ? 'on' : ''}">${d[0]}</button>`).join('')}</div>
    <label class="lbl">Add it at</label><input class="field" type="time" id="hbTime" value="${esc(h.time)}">
    ${existing ? '' : `<label class="chk"><input type="checkbox" id="hbToday" checked> Start today</label>`}
    <p class="muted" style="margin-top:10px">It's added to your log when you open the app after this time, on the days you pick. Days marked Off are skipped.</p>
    <button class="btn primary" id="hbSave" style="margin-top:14px">${existing ? 'Save habit' : 'Start habit'}</button>
    ${existing ? `<div class="row" style="margin-top:8px"><button class="btn plain" id="hbPause">${h.on ? 'Pause' : 'Resume'}</button><button class="btn danger" id="hbDel">Delete habit</button></div>` : ''}
    <button class="btn plain" id="hbClose" style="margin-top:8px">Cancel</button>`, s => {
    const state = {meal: h.meal, qunit: h.qunit};
    bindAmount(s, food, state);
    const nb = s.querySelector('.nbox'); if (nb) nb.classList.add('hidden');
    const paint = () => {
      s.querySelectorAll('#hbDays button').forEach(b => b.classList.toggle('on', days.includes(+b.dataset.d)));
      const j = [...days].sort().join();
      s.querySelectorAll('#hbRep .chip').forEach(c => c.classList.toggle('on', (c.dataset.r === 'all' && days.length === 7) || (c.dataset.r === 'wk' && j === '0,1,2,3,4') || (c.dataset.r === 'we' && j === '5,6')));
    };
    s.querySelectorAll('#hbDays button').forEach(b => b.onclick = () => { const d = +b.dataset.d; days = days.includes(d) ? days.filter(x => x !== d) : days.concat(d); paint(); });
    s.querySelectorAll('#hbRep .chip').forEach(c => c.onclick = () => { days = c.dataset.r === 'all' ? [0, 1, 2, 3, 4, 5, 6] : c.dataset.r === 'wk' ? [0, 1, 2, 3, 4] : [5, 6]; paint(); });
    s.querySelectorAll('.calms button').forEach(b => b.addEventListener('click', () => { const t = s.querySelector('#hbTime'); if (!existing) t.value = MEAL_TIME[b.dataset.m]; }));
    paint();
    s.querySelector('#hbClose').onclick = close;
    s.querySelector('#hbSave').onclick = () => {
      const q = num(s.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
      if (!days.length){ toast('Pick at least one day'); return; }
      const t = s.querySelector('#hbTime').value || MEAL_TIME[state.meal];
      Object.assign(h, {meal: state.meal, qty: q, qunit: state.qunit, days: days.sort(), time: t});
      if (!existing){ const td = s.querySelector('#hbToday'); h.start = td && td.checked ? today() : addDays(today(), 1); if (td && !td.checked) h.done[today()] = 1; }
      const H = habits().filter(x => x.id !== h.id); H.push(h); saveHabits(H);
      close(); const added = runHabits(); render(); renderRecipes();
      toast(existing ? 'Habit saved' : added ? `Habit started — added to ${MEAL_NAME[h.meal]}` : 'Habit started');
    };
    const del = s.querySelector('#hbDel'); if (del) del.onclick = () => { saveHabits(habits().filter(x => x.id !== h.id)); close(); renderRecipes(); toast('Habit deleted'); };
    const pz = s.querySelector('#hbPause'); if (pz) pz.onclick = () => { const H = habits(), x = H.find(y => y.id === h.id); x.on = !x.on; saveHabits(H); close(); renderRecipes(); toast(x.on ? 'Habit resumed' : 'Habit paused'); };
  });
}
function runHabits(){                   // add due habit entries (catches up on the last 7 days)
  const H = habits(); if (!H.length) return 0;
  const tk = today(), now = nowHM(), R = recipes(), L = log(); let added = 0, changed = false;
  for (const h of H){
    if (!h.on) continue;
    h.done = h.done || {};
    const food = h.recipeId ? (R[h.recipeId] ? recipeFood(R[h.recipeId]) : null) : h.food;
    if (!food) continue;
    for (let i = 6; i >= 0; i--){
      const k = addDays(tk, -i);
      if (k < (h.start || tk) || h.done[k] || !h.days.includes(wd(k)) || statusOf(k) === 'off') continue;
      if (k === tk && now < h.time) continue;
      const e = Object.assign({}, food, compute(food, h.qty, h.qunit), {id: uid(), meal: h.meal, qty: h.qty, qunit: h.qunit, ts: Date.now(), habit: h.id});
      delete e.grams;
      L[k] = (L[k] || []).concat(e); h.done[k] = 1; added++; changed = true;
    }
    for (const k in h.done) if (k < addDays(tk, -30)) delete h.done[k];
  }
  if (changed){ store.set(K_LOG, L); saveHabits(H); }
  return added;
}

// ---------------- hydration ----------------
const waterGoal = () => store.get(K_WATER_GOAL, 2000);
const waterLog = k => (store.get(K_WATER, {})[k] || []);
const waterTotal = k => waterLog(k).reduce((a, x) => a + x, 0);
function addWater(k, ml){
  const W = store.get(K_WATER, {}); W[k] = (W[k] || []).concat(ml); if (!W[k].length) delete W[k]; store.set(K_WATER, W);
}
function undoWater(k){ const W = store.get(K_WATER, {}); (W[k] || []).pop(); if (W[k] && !W[k].length) delete W[k]; store.set(K_WATER, W); }
const fmtL = ml => ml >= 1000 ? `${Math.round(ml / 100) / 10} L` : `${Math.round(ml)} ml`;
function waterCard(k){
  const tot = waterTotal(k), goal = waterGoal(), frac = Math.min(1, tot / goal), left = goal - tot;
  const fillY = 54 - 46 * frac;
  return `<div class="card water">
    <div class="ch"><h2>Hydration</h2><button class="ar" id="wGoal" aria-label="Change water goal">${ARROW}</button></div>
    <div class="wrow">
      <svg class="glass" viewBox="0 0 44 60" aria-hidden="true"><defs><clipPath id="gcl"><path d="M6 6h32l-4 48a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z"/></clipPath></defs>
        <g clip-path="url(#gcl)"><rect x="0" y="0" width="44" height="60" fill="color-mix(in srgb, var(--water) 12%, transparent)"/>
        <path d="M0 ${fillY} q5.5 -3 11 0 t11 0 t11 0 t11 0 V60 H0z" fill="var(--water)"/></g>
        <path d="M6 6h32l-4 48a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="none" stroke="color-mix(in srgb, var(--water) 55%, transparent)" stroke-width="2"/></svg>
      <div class="wt"><b>${fmtL(tot)}</b><span>${left > 0 ? `${fmtL(left)} to go · goal ${fmtL(goal)}` : `Goal reached 🎉 · ${fmtL(goal)}`}</span>
        <div class="wbar"><i style="width:${frac * 100}%"></i></div></div>
    </div>
    <div class="wbtns"><button data-ml="250">+250 ml<span>Glass</span></button><button data-ml="500">+500 ml<span>Bottle</span></button><button id="wCustom">+ Custom<span>Any amount</span></button></div>
    ${waterLog(k).length ? `<button class="wundo" id="wUndo">Undo last (${fmtL(waterLog(k).slice(-1)[0])})</button>` : ''}
  </div>`;
}
function bindWater(k, redraw){
  document.querySelectorAll('.water .wbtns [data-ml]').forEach(b => b.onclick = () => { addWater(k, +b.dataset.ml); redraw(); toast(`+${b.dataset.ml} ml`); });
  const c = $('#wCustom'); if (c) c.onclick = () => openWaterCustom(k, redraw);
  const u = $('#wUndo'); if (u) u.onclick = () => { undoWater(k); redraw(); };
  const g = $('#wGoal'); if (g) g.onclick = () => openWaterGoal(redraw);
}
function openWaterCustom(k, redraw){
  sheet(`<h2>Add water</h2><div class="chips" id="wcQuick">${[100, 200, 330, 600, 750, 1000].map(v => `<span class="chip" data-v="${v}">${fmtL(v)}</span>`).join('')}</div>
    <label class="lbl">Amount (ml)</label><input class="field" id="wcMl" inputmode="numeric" placeholder="e.g. 350">
    <button class="btn primary" id="wcGo" style="margin-top:12px">Add</button><button class="btn plain" id="wcClose" style="margin-top:8px">Cancel</button>`, s => {
    const inp = s.querySelector('#wcMl');
    s.querySelectorAll('#wcQuick .chip').forEach(c => c.onclick = () => { inp.value = c.dataset.v; s.querySelectorAll('#wcQuick .chip').forEach(x => x.classList.toggle('on', x === c)); });
    s.querySelector('#wcClose').onclick = close;
    s.querySelector('#wcGo').onclick = () => { const v = num(inp.value); if (!v || v <= 0 || v > 5000){ toast('Enter an amount in ml'); return; } addWater(k, Math.round(v)); close(); redraw(); toast(`+${Math.round(v)} ml`); };
    setTimeout(() => inp.focus(), 50);
  });
}
function openWaterGoal(redraw){
  const g = waterGoal();
  sheet(`<h2>Daily water goal</h2><p class="muted">2 litres is a common everyday goal. You'll need more in hot weather or when you train.</p>
    <div class="chips" id="wgQuick">${[1500, 2000, 2500, 3000, 3500].map(v => `<span class="chip${v === g ? ' on' : ''}" data-v="${v}">${fmtL(v)}</span>`).join('')}</div>
    <label class="lbl">Goal (ml)</label><input class="field" id="wgMl" inputmode="numeric" value="${g}">
    <button class="btn primary" id="wgGo" style="margin-top:12px">Save goal</button><button class="btn plain" id="wgClose" style="margin-top:8px">Cancel</button>`, s => {
    const inp = s.querySelector('#wgMl');
    s.querySelectorAll('#wgQuick .chip').forEach(c => c.onclick = () => { inp.value = c.dataset.v; s.querySelectorAll('#wgQuick .chip').forEach(x => x.classList.toggle('on', x === c)); });
    s.querySelector('#wgClose').onclick = close;
    s.querySelector('#wgGo').onclick = () => { const v = num(inp.value); if (!v || v < 250 || v > 8000){ toast('Enter a goal between 250 and 8000 ml'); return; } store.set(K_WATER_GOAL, Math.round(v)); close(); redraw(); toast(`Goal set to ${fmtL(v)}`); };
  });
}

// ---------------- caffeine & alcohol ----------------
// Caffeine comes from anything logged that lists caffeine (scanned products or the presets below).
// Alcohol is counted in Australian standard drinks (10g of alcohol) and lowers the day's health score.
const K_CAF_LIMIT = 'fs_caf_limit';
const cafLimit = () => store.get(K_CAF_LIMIT, 400);
const SD_PER_ML_PCT = 0.789 / 10 / 100;        // standard drinks per ml per % ABV
const sdOf = (ml, abv) => ml * abv * SD_PER_ML_PCT;
const ALC_DAY_MAX = 4, ALC_WEEK_MAX = 10;        // NHMRC 2020 guideline for healthy adults
function alcPenalty(sd){ if (!(sd > 0)) return 0; return Math.min(40, Math.round(sd * 4) + (sd > ALC_DAY_MAX ? 10 : 0)); }
const CAF_PRESETS = [   // [name, caffeine mg, kcal, protein, carbs, fat, sugars] — typical values, vary by brand
  ['Espresso / long black', 80, 4, 0.3, 0.5, 0, 0], ['Flat white / latte (regular)', 80, 130, 7, 10, 7, 10],
  ['Cappuccino (regular)', 80, 100, 5.5, 8, 5, 8], ['Instant coffee (1 tsp, black)', 60, 4, 0.2, 0.6, 0, 0],
  ['Black tea (cup)', 30, 2, 0, 0.3, 0, 0], ['Green tea (cup)', 25, 2, 0, 0.3, 0, 0],
  ['Energy drink (250ml)', 80, 113, 0, 27, 0, 27], ['Sugar-free energy drink (250ml)', 80, 8, 0, 1, 0, 0],
  ['Cola (375ml can)', 40, 160, 0, 40, 0, 40], ['Pre-workout (1 scoop)', 200, 5, 0, 1, 0, 0]
];
const ALC_PRESETS = [   // [name, ml, ABV %, carbs per 100ml, sugars per 100ml, score]
  ['Beer — schooner (425ml, 4.8%)', 425, 4.8, 3.2, 0.2, 25], ['Beer — pint (570ml, 4.8%)', 570, 4.8, 3.2, 0.2, 25],
  ['Light beer — schooner (425ml, 2.7%)', 425, 2.7, 2.5, 0.2, 35], ['Beer — can/stubby (375ml, 4.8%)', 375, 4.8, 3.2, 0.2, 25],
  ['Wine — glass (150ml, 13%)', 150, 13, 2.6, 0.8, 30], ['Sparkling wine — glass (150ml, 11.5%)', 150, 11.5, 2.5, 1.5, 30],
  ['Spirit — shot (30ml, 40%)', 30, 40, 0, 0, 25], ['Pre-mix / RTD can (375ml, 5%)', 375, 5, 7, 7, 15],
  ['Cider (375ml, 5%)', 375, 5, 6, 5.5, 20], ['Cocktail (approx.)', 200, 12, 10, 9, 15]
];
function alcFood(name, ml, abv, carb100, sug100, score){
  const sd = sdOf(ml, abv), g = sd * 10, c = (carb100 || 0) * ml / 100;
  return {name, brand: `${r1(sd)} standard drink${Math.abs(sd - 1) < .05 ? '' : 's'}`, code: '', per100: null, score: score != null ? score : 20,
    fixed: {kcal: g * 7 + c * 4, p: 0, c, f: 0, sugar: (sug100 || 0) * ml / 100, sat: 0, fib: 0, na: 0, alc: sd}};
}
function cafFood(name, mg, kcal, p, c, f, s){
  return {name, brand: `${mg} mg caffeine`, code: '', per100: null, score: null,
    fixed: {kcal: kcal || 0, p: p || 0, c: c || 0, f: f || 0, sugar: s || 0, sat: 0, fib: 0, na: 0, micro: {caffeine: mg}}};
}
function weekAlc(k){ let t = 0; for (let i = 0; i < 7; i++) t += sum(dayEntries(addDays(k, -i))).alc || 0; return t; }
function lastCaffeine(list){
  const c = list.filter(e => e.micro && e.micro.caffeine > 0 && e.ts).sort((a, b) => b.ts - a.ts)[0];
  return c ? new Date(c.ts) : null;
}
const ICON_CUP = '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>';
const ICON_GLASS = '<path d="M7 3h10l-1 8a4 4 0 0 1-8 0zM12 15v5M8.5 20.5h7M7.5 7h9"/>';
function drinksCard(k){
  const list = dayEntries(k), t = sum(list), caf = (t.micro && t.micro.caffeine) || 0, lim = cafLimit();
  const sd = t.alc || 0, wk = weekAlc(k), pen = alcPenalty(sd), last = k === today() ? lastCaffeine(list) : null;
  const cafCol = caf > lim ? 'var(--g1)' : caf > lim * .75 ? 'var(--g3)' : 'var(--caf)';
  const lateNote = last && last.getHours() >= 14 ? ` Last one at ${last.toLocaleTimeString('en-AU', {hour: 'numeric', minute: '2-digit'})} — caffeine can affect sleep for 6+ hours.` : '';
  return `<div class="card drinks">
    <div class="ch"><h2>Caffeine & alcohol</h2><button class="ar" id="dkSet" aria-label="Caffeine limit and alcohol guidelines">${ARROW}</button></div>
    <div class="dk">
      <div class="dkh"><span class="dki" style="--c:var(--caf)"><svg viewBox="0 0 24 24">${ICON_CUP}</svg></span>
        <div class="t"><b style="color:${cafCol}">${Math.round(caf)} mg</b><span>caffeine · limit ${lim} mg</span></div><button class="dkadd" id="cafAdd">${ICON_PLUS}Add</button></div>
      <div class="dkbar"><i style="width:${Math.min(100, caf / lim * 100)}%;background:${cafCol}"></i></div>
      <p class="dkn">${caf > lim ? `<b style="color:var(--g1)">${Math.round(caf - lim)} mg over your daily limit.</b>` : caf ? `${Math.round(lim - caf)} mg left before your limit.` : 'No caffeine logged.'}${lateNote}</p>
    </div>
    <div class="dk">
      <div class="dkh"><span class="dki" style="--c:var(--alc)"><svg viewBox="0 0 24 24">${ICON_GLASS}</svg></span>
        <div class="t"><b style="color:${sd ? 'var(--alc)' : 'var(--ink)'}">${r1(sd)}</b><span>standard drink${Math.abs(sd - 1) < .05 ? '' : 's'} · ${r1(wk)} of ${ALC_WEEK_MAX} this week</span></div><button class="dkadd" id="alcAdd">${ICON_PLUS}Add</button></div>
      <div class="dkbar"><i style="width:${Math.min(100, wk / ALC_WEEK_MAX * 100)}%;background:${wk > ALC_WEEK_MAX ? 'var(--g1)' : 'var(--alc)'}"></i></div>
      <p class="dkn">${sd ? `<b style="color:var(--g1)">−${pen} points</b> off ${k === today() ? "today's" : "this day's"} health score.${sd > ALC_DAY_MAX ? ` More than ${ALC_DAY_MAX} standard drinks in a day raises the risk of injury.` : ''}${wk > ALC_WEEK_MAX ? ` Over the ${ALC_WEEK_MAX}-a-week guideline.` : ''}`
        : `Alcohol-free ${k === today() ? 'today' : 'this day'} ✓`}</p>
    </div>
  </div>`;
}
function bindDrinks(k, redraw){
  const ca = $('#cafAdd'); if (ca) ca.onclick = () => openCaffeine(k, redraw);
  const aa = $('#alcAdd'); if (aa) aa.onclick = () => openAlcohol(k, redraw);
  const ds = $('#dkSet'); if (ds) ds.onclick = () => openCafLimit(redraw);
}
function presetSheet(title, intro, rows, custom, bindCustom){
  sheet(`<h2>${title}</h2><p class="muted">${intro}</p>
    <div class="plist calrec" style="margin-top:10px;max-height:300px">${rows.map((r, i) => `<div class="pl" data-i="${i}" role="button" tabindex="0"><div class="t"><b>${esc(r[0])}</b><span>${esc(r[1])}</span></div><div class="plus">+</div></div>`).join('')}</div>
    <label class="lbl">Something else</label>${custom}
    <button class="btn plain" id="psClose" style="margin-top:8px">Cancel</button>`, s => { s.querySelector('#psClose').onclick = close; bindCustom(s); });
}
function openCaffeine(k, redraw){
  presetSheet('Add caffeine', 'Typical amounts — cafés and brands vary a lot. Each one is added to your food log.',
    CAF_PRESETS.map(p => [p[0], `${p[1]} mg · ${eFmt(p[2])}`]),
    `<div class="ngrid3"><div><span class="muted">Caffeine mg</span><input class="field" id="ccMg" inputmode="numeric"></div><div><span class="muted">Energy (${eUnit()})</span><input class="field" id="ccE" inputmode="decimal" placeholder="0"></div></div>
     <input class="field" id="ccN" placeholder="Name (optional)"><button class="btn ghost" id="ccGo" style="margin-top:10px">Next</button>`, s => {
    s.querySelectorAll('.pl').forEach(r => r.onclick = () => { const p = CAF_PRESETS[+r.dataset.i]; openAmount(cafFood(...p), mealNow(), 'day', redraw); });
    s.querySelector('#ccGo').onclick = () => {
      const mg = num(s.querySelector('#ccMg').value); if (!mg || mg <= 0 || mg > 1000){ toast('Enter the caffeine in mg'); return; }
      const e = num(s.querySelector('#ccE').value) || 0;
      openAmount(cafFood(s.querySelector('#ccN').value.trim() || 'Caffeine', Math.round(mg), unit() === 'kj' ? e / KJ : e), mealNow(), 'day', redraw);
    };
  });
}
function openAlcohol(k, redraw){
  presetSheet('Add a drink', `Alcohol is counted in Australian standard drinks (10g of alcohol) and lowers your health score. Guideline for healthy adults: no more than ${ALC_WEEK_MAX} a week and ${ALC_DAY_MAX} on any one day.`,
    ALC_PRESETS.map(p => [p[0], `${r1(sdOf(p[1], p[2]))} standard drinks · ${eFmt(alcFood(...p).fixed.kcal)}`]),
    `<input class="field" id="acN" placeholder="Name, e.g. Margarita">
     <div class="ngrid3"><div><span class="muted">Amount (ml)</span><input class="field" id="acMl" inputmode="decimal"></div><div><span class="muted">Alcohol %</span><input class="field" id="acAbv" inputmode="decimal"></div><div><span class="muted">= standard drinks</span><input class="field" id="acSd" disabled></div></div>
     <button class="btn ghost" id="acGo" style="margin-top:10px">Next</button>`, s => {
    s.querySelectorAll('.pl').forEach(r => r.onclick = () => openAmount(alcFood(...ALC_PRESETS[+r.dataset.i]), mealNow(), 'day', redraw));
    const upd = () => { const ml = num(s.querySelector('#acMl').value), a = num(s.querySelector('#acAbv').value); s.querySelector('#acSd').value = ml && a ? r1(sdOf(ml, a)) : ''; };
    ['#acMl', '#acAbv'].forEach(q => s.querySelector(q).oninput = upd);
    s.querySelector('#acGo').onclick = () => {
      const ml = num(s.querySelector('#acMl').value), a = num(s.querySelector('#acAbv').value);
      if (!ml || ml <= 0 || !a || a <= 0 || a > 100){ toast('Enter the amount and alcohol %'); return; }
      openAmount(alcFood(s.querySelector('#acN').value.trim() || 'Drink', ml, a, 0, 0, 20), mealNow(), 'day', redraw);
    };
  });
}
function openCafLimit(redraw){
  const lim = cafLimit();
  sheet(`<h2>Caffeine & alcohol</h2>
    <label class="lbl">Daily caffeine limit</label>
    <div class="chips" id="clQuick">${[200, 300, 400].map(v => `<span class="chip${v === lim ? ' on' : ''}" data-v="${v}">${v} mg</span>`).join('')}</div>
    <input class="field" id="clMg" inputmode="numeric" value="${lim}">
    <p class="muted" style="margin-top:8px">Up to 400 mg a day is considered safe for most healthy adults. 200 mg is the usual advice during pregnancy. Your limit only changes the warnings — caffeine doesn't affect your health score.</p>
    <label class="lbl">Alcohol</label>
    <p class="muted">Follows the Australian guideline for healthy adults: no more than ${ALC_WEEK_MAX} standard drinks a week and no more than ${ALC_DAY_MAX} on any one day — the less, the lower the risk. Each standard drink takes about 4 points off that day's health score, plus 10 more past ${ALC_DAY_MAX} drinks.</p>
    <button class="btn primary" id="clGo" style="margin-top:14px">Save</button><button class="btn plain" id="clClose" style="margin-top:8px">Cancel</button>`, s => {
    const inp = s.querySelector('#clMg');
    s.querySelectorAll('#clQuick .chip').forEach(c => c.onclick = () => { inp.value = c.dataset.v; s.querySelectorAll('#clQuick .chip').forEach(x => x.classList.toggle('on', x === c)); });
    s.querySelector('#clClose').onclick = close;
    s.querySelector('#clGo').onclick = () => { const v = num(inp.value); if (!v || v < 25 || v > 1200){ toast('Enter a limit between 25 and 1200 mg'); return; } store.set(K_CAF_LIMIT, Math.round(v)); close(); redraw(); toast(`Caffeine limit set to ${Math.round(v)} mg`); };
  });
}

// ---------------- "Which meal?" bar pinned to the bottom of food results ----------------
const MEAL_ONE = {breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack'};
const MEAL_ICON = {
  breakfast: '<path d="M4 15h16M6 15a6 6 0 0 1 12 0M12 5v2M5.6 7.6 7 9M18.4 7.6 17 9M3 19h18"/>',
  lunch: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  dinner: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  snack: '<path d="M12 7c-1-2-3-3-5-2 0 2 1.5 3.5 3.5 3.5M12 7c3.5-1 7 1.5 7 6s-3 7-7 7-7-2.5-7-7c0-3 1.5-5 3.5-5.5"/>'
};
function mountMealBar(food, suggested){
  const old = $('#mealBar'); if (old) old.remove();
  const host = $('#v-result'); if (!host) return;
  const back = !!pendingMealGet();
  host.insertAdjacentHTML('beforeend', `<div class="mealbar" id="mealBar" role="group" aria-label="Add to your calories">
    <p>Add to your calories — which meal?</p>
    <div class="mbtns">${MEALS.map(([m]) => `<button data-m="${m}" class="${m === suggested ? 'on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${MEAL_ICON[m]}</svg>${MEAL_ONE[m]}</button>`).join('')}</div></div>`);
  host.classList.add('hasbar');
  const fab = $('#fab'); if (fab) fab.classList.add('hidden');
  host.querySelectorAll('#mealBar button').forEach(b => b.onclick = () => openAmount(food, b.dataset.m, back ? 'day' : true, m => {
    pending = null;
    if (back && window.FSApp){ FSApp.show('cal'); return; }
    const bar = $('#mealBar'); if (!bar) return;
    bar.querySelector('p').innerHTML = `Added to ${esc(MEAL_ONE[m])} ✓ <button class="lnk" id="mbView">View today</button>`;
    bar.querySelectorAll('.mbtns button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
    bar.querySelector('#mbView').onclick = () => { day = today(); window.FSApp && FSApp.show('cal'); };
  }));
}

// ---------------- "Add to calorie tracker" card on food results ----------------
// info: {name, brand, code, N (per 100: kj, protein, carbs, fat, fibre…), serving:{g,unit}|null, pack:{g,unit}|null, isDrink, produce}
function foodFrom(info){
  const N = info.N || {};
  if (N.kj == null) return null;
  const kcal = N.kj / KJ;
  let c = N.carbs;
  if (c == null && N.protein != null && N.fat != null){   // estimate (e.g. loose fruit & veg) from the energy that's left
    c = Math.max(0, (N.kj - N.protein * 17 - N.fat * 37 - (N.fibre || 0) * 8) / 17);
  }
  const s = info.serving && info.serving.g > 0 && info.serving.g < 2000 ? info.serving : null;
  const pk = info.pack && info.pack.g > 0 && info.pack.g <= 5000 && (!s || Math.abs(info.pack.g - s.g) > 1) ? info.pack : null;
  return {name: info.name || 'Food', brand: info.brand || '', code: info.code || '', score: typeof info.score === 'number' ? info.score : null,
    per100: {kcal, p: N.protein || 0, c: c || 0, f: N.fat || 0, sugar: N.sugar || 0, sat: N.sat || 0, fib: N.fibre || 0, na: N.sodium || 0, alc: info.abv ? sdOf(100, info.abv) : 0, micro: microFrom(info.nutriments)},
    full: N.sugar != null && N.sodium != null && N.sat != null,
    fixed: null, serveG: s ? s.g : null, packG: pk ? pk.g : null, u: (s && s.unit) || (pk && pk.unit) || (info.isDrink ? 'ml' : 'g'), produce: !!info.produce};
}
function mountLog(el, info){
  if (!el) return;
  const food = foodFrom(info);
  if (!food){
    el.innerHTML = `<div class="card"><h2>Add to calorie tracker</h2><p class="muted">This product has no energy info, so it can't be added automatically. Use Quick add in the Calories tab with the number from the label.</p></div>`;
    return;
  }
  if (pendingRecipe()){ const ob = $('#mealBar'); if (ob) ob.remove(); return mountRecipeAdd(el, food); }
  const meal = pendingMealGet() || mealNow();
  const rec = store.get(K_RECENT, []).find(x => x.key === (food.code || ''));
  const state = {meal, qunit: rec && rec.lastUnit && unitsFor(food).some(u => u[0] === rec.lastUnit) ? rec.lastUnit : food.serveG ? 'serve' : 'g'};
  const qty = rec && rec.lastUnit === state.qunit ? rec.lastQty : state.qunit === 'g' ? 100 : 1;
  mountMealBar(food, meal);
  el.innerHTML = `<div class="card callog"><h2>Add to calorie tracker</h2>
    <p class="muted">${eFmt(food.per100.kcal)} per 100${food.u}${food.serveG ? ` · ${eFmt(food.per100.kcal * food.serveG / 100)} per serve` : ''}</p>
    ${amountBlock(food, qty, state.qunit, meal)}
    <button class="btn primary" id="logGo" style="margin-top:12px">Add to ${MEAL_NAME[meal]}</button></div>`;
  const card = el.querySelector('.callog');
  bindAmount(card, food, state);
  const go = card.querySelector('#logGo');
  card.querySelectorAll('.calms button').forEach(b => b.addEventListener('click', () => { go.textContent = `Add to ${MEAL_NAME[state.meal]}`; }));
  go.onclick = () => {
    const q = num(card.querySelector('#amtQ').value); if (!q || q <= 0){ toast('Enter an amount'); return; }
    const back = !!pendingMealGet();
    addEntry(food, state.meal, q, state.qunit, back ? day : today());
    pending = null;
    if (back && window.FSApp){ FSApp.show('cal'); toast(`Added to ${MEAL_NAME[state.meal]}`); return; }
    go.textContent = `Added ✓ — open tracker`;
    go.onclick = () => { day = today(); window.FSApp && FSApp.show('cal'); };
    toast(`Added to ${MEAL_NAME[state.meal]}`);
  };
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ const v = $('#v-cal'); if (v && !v.classList.contains('hidden')) render(); else runHabits(); } });
window.FSCal = {render: () => render(), renderMonth: () => renderMonth(), renderRecipes: () => renderRecipes(), mountLog, open: () => { pending = null; render(); }};
})();
