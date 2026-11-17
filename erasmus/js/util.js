// Shared helpers: formatting, colours, tooltip, tiny store.

export const COLORS = {
  ink: "#EDE9E1", ink2: "#B9B5AC", ink3: "#85827B",
  accent: "#FFCC00", accent2: "#00E5FF", // EU-flag gold (departures, highlights), neon cyan (arrivals, glow)
  sector: { HE: "#336DEB", VET: "#DC7411", YOU: "#C32851", SCH: "#AF71E1", ADU: "#089678" },
};

const nf = new Intl.NumberFormat("en-GB");
export const fmt = (n) => (n == null || isNaN(n) ? "–" : nf.format(Math.round(n)));
export function fmtShort(n) {
  if (n == null) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e4) return Math.round(n / 1e3) + "k";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- store -------------------------------------------------------------
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      subs.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// --- tooltip (text only: labels come from data, so never innerHTML) ------
const tipEl = () => document.getElementById("tooltip");
export function showTip(x, y, title, rows = [], note) {
  const el = tipEl();
  el.replaceChildren();
  if (title) {
    const t = document.createElement("div");
    t.className = "tt-title";
    t.textContent = title;
    el.appendChild(t);
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "tt-row";
    const lab = document.createElement("span");
    lab.className = "lab";
    if (r.color) {
      const i = document.createElement("i");
      i.style.background = r.color;
      lab.appendChild(i);
    }
    lab.appendChild(document.createTextNode(r.label));
    const v = document.createElement("strong");
    v.textContent = r.value;
    row.append(lab, v);
    el.appendChild(row);
  }
  if (note) {
    const n = document.createElement("div");
    n.style.marginTop = "4px";
    n.style.color = "#85827B";
    n.textContent = note;
    el.appendChild(n);
  }
  el.hidden = false;
  const pad = 14;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top + h > window.innerHeight - 8) top = y - h - pad;
  el.style.left = Math.max(8, left) + "px";
  el.style.top = Math.max(8, top) + "px";
}
export function hideTip() { tipEl().hidden = true; }

// --- data helpers ----------------------------------------------------------
export function yearTotal(year, sector) {
  if (sector === "ALL") return year.total;
  return (year.sectors && year.sectors[sector]) || 0;
}

export function countryName(data, code) {
  const c = data.countries[code];
  return c ? c[0] : code;
}

export function tween(from, to, ms, onUpdate, onDone) {
  if (reducedMotion || ms <= 0) { onUpdate(to); onDone && onDone(); return () => {}; }
  const t0 = performance.now();
  let raf;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    onUpdate(from + (to - from) * ease(t));
    if (t < 1) raf = requestAnimationFrame(step); else onDone && onDone();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
