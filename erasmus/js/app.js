// Erasmus at 40 — app wiring. One state (year, sector, focus country) drives every view.
import { COLORS, fmt, fmtShort, createStore, yearTotal, tween, reducedMotion, hideTip } from "./util.js";
import { createGlobe } from "./globe.js";
import { createSankey } from "./sankey.js";
import { createStream } from "./stream.js";
import { createTimeline } from "./timeline.js";

const data = await fetch("data/erasmus.json").then((r) => r.json());
const years = data.years;
const cname = (c) => (data.countries[c] ? data.countries[c][0] : c);
const SECTORS = data.meta.sectors;
const lastIdx = years.length - 1;

const store = createStore({ idx: reducedMotion ? lastIdx : 0, sector: "ALL", focus: null, playing: false });

// ---------- derived data ----------------------------------------------------
function sectorKey(y, sector) {
  // pre-2014 data is higher education only
  if (y.era === "erasmus") return sector === "ALL" || sector === "HE" ? "HE" : null;
  return sector;
}
function slice(state) {
  const y = years[state.idx];
  const sk = sectorKey(y, state.sector);
  const flows = sk && data.flows[y.key] ? data.flows[y.key][sk] || [] : [];
  const nodes = sk && data.nodes[y.key] ? data.nodes[y.key][sk] || {} : {};
  return { y, flows, nodes, hasPairs: flows.length > 0, hasNodes: Object.keys(nodes).length > 0 };
}
const cumCache = new Map();
function cumulative(idx, sector, focus) {
  const k = idx + "|" + sector + "|" + focus;
  if (cumCache.has(k)) return cumCache.get(k);
  let s = 0;
  for (let i = 0; i <= idx; i++) {
    const y = years[i];
    if (!focus) s += yearTotal(y, sector);
    else {
      const sk = sectorKey(y, sector);
      const nd = sk && data.nodes[y.key] && data.nodes[y.key][sk];
      if (nd && nd[focus]) s += nd[focus][0];
    }
  }
  cumCache.set(k, s);
  return s;
}
function yearValue(idx, sector, focus) {
  if (idx < 0) return null;
  const y = years[idx];
  if (!focus) return yearTotal(y, sector);
  const sk = sectorKey(y, sector);
  const nd = sk && data.nodes[y.key] && data.nodes[y.key][sk];
  return nd && nd[focus] ? nd[focus][0] : null;
}

// ---------- year notes (all derived from the data) ---------------------------
function topRoute(flows) {
  if (!flows.length) return "";
  const f = flows[0];
  return ` Busiest route: <b>${esc(cname(f[0]))} → ${esc(cname(f[1]))}</b> (${fmt(f[2])}).`;
}
// countries sending students for the first time in the records (Erasmus era only)
function newcomers(idx) {
  const y = years[idx];
  const cur = data.nodes[y.key] && data.nodes[y.key].HE;
  if (!cur || idx === 0) return "";
  const seen = new Set();
  for (let i = 0; i < idx; i++) { const nd = data.nodes[years[i].key] && data.nodes[years[i].key].HE; if (nd) Object.keys(nd).forEach((c) => nd[c][0] && seen.add(c)); }
  const fresh = Object.keys(cur).filter((c) => cur[c][0] && !seen.has(c) && data.countries[c]).sort((a, b) => cur[b][0] - cur[a][0]).map(cname);
  if (!fresh.length) return "";
  const list = fresh.length > 6 ? fresh.slice(0, 6).join(", ") + ` and ${fresh.length - 6} more` : fresh.length > 1 ? fresh.slice(0, -1).join(", ") + " and " + fresh[fresh.length - 1] : fresh[0];
  return ` First students from <b>${esc(list)}</b>.`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function noteFor(state, sl) {
  const { y, flows, nodes } = sl;
  const sector = state.sector;
  const v = yearTotal(y, sector);
  const first = years[0].total;
  if (state.focus) {
    const nd = nodes[state.focus];
    if (!nd) return `No country breakdown for <b>${esc(cname(state.focus))}</b> in ${y.label}.`;
    if (nd[1] == null) return `<b>${esc(cname(state.focus))}</b> in ${y.label}: <b>${fmt(nd[0])}</b> students sent abroad (arrivals per country were not published for this year).`;
    return `<b>${esc(cname(state.focus))}</b> in ${y.label}: <b>${fmt(nd[0])}</b> departures, <b>${fmt(nd[1])}</b> arrivals.`;
  }
  if (y.era === "erasmus" && sector !== "ALL" && sector !== "HE") {
    return `Before 2014 the open records cover university students only — no ${esc(data.meta.sectorNames[sector].toLowerCase())} figures.`;
  }
  if (y.key === "1987") return `<b>${fmt(v)} students</b> from the 11 founding countries go abroad in the first Erasmus year. Each country glows with the students it sent.`;
  if (y.key === "2013") return `Last year of the original programme: a record <b>${fmt(v)}</b> students.`;
  if (y.key === "2014") return `Erasmus+ opens to schools, vocational learners, adults, youth and sport. Launch year, only partly recorded: <b>${fmt(v)}</b> participants.${topRoute(flows)}`;
  if (y.key === "2020") {
    const prev = yearTotal(years[years.findIndex((d) => d.key === "2019")], sector);
    return `Covid-19: departures fall to <b>${fmt(v)}</b>, ${Math.round((1 - v / prev) * 100)}% below 2019.`;
  }
  if (y.key === "2021") return `A new programme, 2021–2027, starts while travel restrictions linger: <b>${fmt(v)}</b> participants.${topRoute(flows)}`;
  if (y.key === "2024") return `<b>${fmt(v)}</b> participants, the busiest year in the open records.${topRoute(flows)}`;
  if (y.era === "erasmus") {
    const mult = Math.round(v / first);
    const nw = newcomers(state.idx);
    if (y.level === "pairs") return `<b>${fmt(v)}</b> students, ${mult}× the first year.${nw}${topRoute(flows)}`;
    if (y.level === "outgoing") return `<b>${fmt(v)}</b> students, ${mult}× the first year.${nw} Countries glow with the students they sent; where they went isn't in the archive for this year.`;
    if (y.level === "countries") return `<b>${fmt(v)}</b> students, ${mult}× the first year.${nw} Countries glow with their students; routes between them aren't in the archive for this year.`;
    return `<b>${fmt(v)}</b> students, ${mult}× the first year. The open archive has no country detail for this year.`;
  }
  return `<b>${fmt(v)}</b> participants.${topRoute(flows)}`;
}

// ---------- components --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const recordedTotal = years.reduce((s, y) => s + y.total, 0);
$("aboutRecorded").textContent = (recordedTotal / 1e6).toFixed(1) + " million";

// sector chips (also the streamgraph's colour key)
const chips = $("chips");
[["ALL", "All"], ...SECTORS.map((k) => [k, { HE: "Higher ed", VET: "VET", YOU: "Youth & sport", SCH: "School", ADU: "Adult" }[k]])].forEach(([k, label]) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.dataset.sector = k;
  if (k !== "ALL") { const i = document.createElement("i"); i.style.background = COLORS.sector[k]; b.appendChild(i); }
  b.appendChild(document.createTextNode(label));
  b.title = k === "ALL" ? "All sectors" : data.meta.sectorNames[k];
  b.addEventListener("click", () => store.set({ sector: store.get().sector === k ? "ALL" : k }));
  chips.appendChild(b);
});
$("focusChip").addEventListener("click", () => store.set({ focus: null }));

const timeline = createTimeline($("timeline"), data, {
  onChange: (i, user) => { if (user) stop(); store.set({ idx: i }); },
});
const sankey = createSankey($("sankey"), data, { onSelect: (c) => store.set({ focus: c }) });
const stream = createStream($("stream"), data, {
  onPickYear: (k) => { const i = years.findIndex((y) => y.key === k); if (i >= 0) { stop(); store.set({ idx: i }); } },
});

let globe = null;
createGlobe({
  canvas: $("globe"), labelsEl: $("globeLabels"), data,
  onSelect: (c) => store.set({ focus: c && c === store.get().focus ? null : c }),
}).then((g) => { globe = g; renderGlobe(store.get()); })
  .catch((err) => { console.error(err); $("globeWrap").classList.add("no-webgl"); });

function renderGlobe(state) {
  if (!globe) return;
  const sl = slice(state);
  globe.update({
    flows: sl.flows, nodes: sl.nodes, label: sl.y.label, hasPairs: sl.hasPairs, focus: state.focus,
  });
}

// counter
let shown = 0, cancelTween = () => {};
function renderCounter(state) {
  const target = cumulative(state.idx, state.sector, state.focus);
  cancelTween();
  cancelTween = tween(shown, target, state.playing ? 900 : 700, (v) => { shown = v; $("count").textContent = fmt(v); });
  const y = years[state.idx];
  const sub = state.focus
    ? `recorded departures from ${cname(state.focus)}, years with country data, to ${y.label}`
    : state.sector === "ALL" ? `recorded participants, 1987/88 → ${y.label}` : `${data.meta.sectorNames[state.sector].toLowerCase()} participants recorded to ${y.label}`;
  $("countSub").textContent = sub;
  $("yearLabelSmall").textContent = state.focus ? `Departures in ${y.label}` : `In ${y.label}`;
  const cur = yearValue(state.idx, state.sector, state.focus);
  const prev = yearValue(state.idx - 1, state.sector, state.focus);
  $("yearCount").textContent = cur == null ? "–" : fmt(cur);
  const dEl = $("yearDelta");
  dEl.className = "v";
  const eraBreak = state.idx > 0 && years[state.idx - 1].era !== y.era;
  if (cur != null && prev && !eraBreak) {
    const d = (cur - prev) / prev;
    dEl.textContent = (d >= 0 ? "+" : "") + Math.round(d * 100) + "%";
    dEl.classList.add(d >= 0 ? "up" : "down");
  } else dEl.textContent = eraBreak ? "new series" : "–";
  const off = document.querySelector(".official");
  const showOff = !state.focus && state.sector === "ALL";
  off.style.visibility = showOff ? "visible" : "hidden";
  $("officialFill").style.width = Math.min(100, (target / data.meta.official.since1987) * 100) + "%";
}

function renderSankey(state) {
  const sl = slice(state);
  const y = sl.y;
  let emptyText;
  if (!sl.hasPairs) {
    if (y.era === "erasmus" && state.sector !== "ALL" && state.sector !== "HE") emptyText = "Before 2014 the open records cover university students only.";
    else emptyText = `Country-to-country flows aren't in the open archive for ${y.label}. They are drawn for 2004/05–2009/10 and 2014–2024.`;
  }
  $("sankeyMeta").textContent = sl.hasPairs ? (state.focus ? `to and from ${cname(state.focus)}, ${y.label}` : `top 7 each side, ${y.label}`) : y.label;
  sankey.render({ flows: sl.flows, focus: state.focus, hasPairs: sl.hasPairs, label: y.label, emptyText });
}

function renderText(state) {
  const sl = slice(state);
  $("yearBig").textContent = sl.y.label;
  $("yearNote").innerHTML = noteFor(state, sl); // built from escaped data values only
  chips.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sector === state.sector)));
  const fc = $("focusChip");
  if (state.focus) { fc.hidden = false; fc.textContent = "Following " + cname(state.focus); fc.setAttribute("aria-label", "Stop following " + cname(state.focus)); }
  else fc.hidden = true;
  $("play").classList.toggle("playing", state.playing);
  $("play").setAttribute("aria-label", state.playing ? "Pause" : "Play");
}

// tables (the accessible twin of every chart)
function buildYearTable() {
  const t = $("yearTable");
  const head = document.createElement("tr");
  ["Year", "All participants", ...SECTORS.map((k) => data.meta.sectorNames[k])].forEach((h, i) => {
    const th = document.createElement("th"); th.textContent = h; if (!i) th.className = "l"; head.appendChild(th);
  });
  const thead = document.createElement("thead"); thead.appendChild(head); t.appendChild(thead);
  const tb = document.createElement("tbody");
  years.forEach((y) => {
    const tr = document.createElement("tr");
    const cells = [y.label, fmt(y.total), ...SECTORS.map((k) => (y.era === "erasmus" ? (k === "HE" ? fmt(y.total) : "–") : fmt(y.sectors[k])))];
    cells.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (!i) td.className = "l"; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}
function renderFlowTable(state) {
  const sl = slice(state);
  const t = $("flowTable");
  t.replaceChildren();
  const head = document.createElement("tr");
  ["From", "To", "Participants"].forEach((h, i) => { const th = document.createElement("th"); th.textContent = h; if (i < 2) th.className = "l"; head.appendChild(th); });
  const thead = document.createElement("thead"); thead.appendChild(head); t.appendChild(thead);
  const tb = document.createElement("tbody");
  let fl = sl.flows;
  if (state.focus) fl = fl.filter((f) => f[0] === state.focus || f[1] === state.focus);
  if (!fl.length) {
    const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 3; td.className = "l";
    td.textContent = `No country-to-country flows in the open data for ${sl.y.label}.`; tr.appendChild(td); tb.appendChild(tr);
  }
  fl.slice(0, 30).forEach((f) => {
    const tr = document.createElement("tr");
    [cname(f[0]), cname(f[1]), fmt(f[2])].forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i < 2) td.className = "l"; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  t.closest("details").querySelector("summary").textContent = `Largest flows, ${sl.y.label}${state.focus ? " — " + cname(state.focus) : ""}${state.sector !== "ALL" ? " — " + data.meta.sectorNames[state.sector] : ""}`;
}
buildYearTable();

// ---------- render on state change ------------------------------------------------
function renderAll(state, prev = {}) {
  const changed = (k) => state[k] !== prev[k];
  if (changed("idx") || changed("sector") || changed("focus")) {
    renderGlobe(state);
    renderSankey(state);
    renderFlowTable(state);
    stream.render({ yearKey: years[state.idx].key, era: years[state.idx].era, sector: state.sector });
    timeline.render(state);
    renderCounter(state);
  }
  renderText(state);
}
store.subscribe(renderAll);
renderAll(store.get());

// ---------- playback ----------------------------------------------------------------
let timer = null;
function stepDuration(i) {
  const y = years[i];
  return y.level === "pairs" ? 2400 : y.level === "total" ? 750 : 1300;
}
function tick() {
  const s = store.get();
  if (s.idx >= lastIdx) { stop(); return; }
  store.set({ idx: s.idx + 1 });
  timer = setTimeout(tick, stepDuration(s.idx + 1));
}
function play() {
  hideTip();
  const s = store.get();
  if (s.idx >= lastIdx) store.set({ idx: 0 });
  store.set({ playing: true });
  timer = setTimeout(tick, stepDuration(store.get().idx));
}
function stop() {
  clearTimeout(timer); timer = null;
  if (store.get().playing) store.set({ playing: false });
}
$("play").addEventListener("click", () => (store.get().playing ? stop() : play()));
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && (e.target === document.body || e.target.id === "timeline")) { e.preventDefault(); store.get().playing ? stop() : play(); }
});
if (!reducedMotion) setTimeout(() => { if (store.get().idx === 0 && !store.get().playing) play(); }, 1600);
