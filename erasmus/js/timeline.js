// Timeline scrubber: one bar per year, eras labelled, 2025-2027 shown as the road to the 40th anniversary.
import { COLORS, fmt, showTip, hideTip, yearTotal } from "./util.js";

export function createTimeline(el, data, { onChange }) {
  const years = data.years;
  const future = ["2025", "2026", "2027"];
  const n = years.length + future.length;
  const svg = d3.select(el).append("svg");
  const gBars = svg.append("g");
  const gFuture = svg.append("g");
  const gTicks = svg.append("g");
  const gEra = svg.append("g");
  const cursor = svg.append("g").attr("pointer-events", "none");
  cursor.append("rect").attr("class", "cur").attr("fill", COLORS.accent).attr("opacity", 0.12).attr("rx", 3);
  const curLabel = cursor.append("text").attr("class", "tick sel").attr("text-anchor", "middle");
  let W = 0, H = 0, x, idx = 0, sector = "ALL";

  function layout() {
    const r = el.getBoundingClientRect();
    W = r.width; H = r.height;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    x = d3.scaleBand().domain(d3.range(n)).range([0, W]).paddingInner(0.28).paddingOuter(0.05);
    draw();
  }

  function draw() {
    if (!x) return;
    const top = 18, base = H - 18;
    const max = d3.max(years, (y) => yearTotal(y, sector)) || 1;
    const hY = d3.scaleLinear().domain([0, max]).range([0, base - top - 4]);
    gBars.selectAll("rect").data(years).join("rect")
      .attr("x", (d, i) => x(i)).attr("width", x.bandwidth())
      .attr("rx", Math.min(2, x.bandwidth() / 2))
      .transition().duration(400)
      .attr("y", (d) => base - Math.max(1.5, hY(yearTotal(d, sector))))
      .attr("height", (d) => Math.max(1.5, hY(yearTotal(d, sector))))
      .attr("fill", (d, i) => (i === idx ? COLORS.accent : d.era === "plus" ? "#B9B5AC" : "#6f6c66"))
      .attr("fill-opacity", (d, i) => (i === idx ? 1 : i < idx ? 0.85 : 0.45));

    // future 2025-2027: dotted outlines, 2027 = 40 years
    gFuture.selectAll("*").remove();
    future.forEach((f, j) => {
      const i = years.length + j;
      const bx = x(i), bw = x.bandwidth();
      const hh = j === 2 ? base - top - 22 : 8 + j * 6;
      gFuture.append("rect").attr("x", bx).attr("y", base - hh).attr("width", bw).attr("height", hh).attr("rx", 2)
        .attr("fill", j === 2 ? d3.color(COLORS.accent).copy({ opacity: 0.08 }) : "none").attr("stroke", j === 2 ? COLORS.accent : "#6f6c66").attr("stroke-dasharray", "2 3").attr("stroke-width", 1);
    });
    const i27 = years.length + 2;
    gFuture.append("text").attr("class", "forty").attr("x", x(i27) + x.bandwidth() / 2).attr("y", top + 4).attr("text-anchor", "middle").text("40");
    if (W > 520) gFuture.append("text").attr("class", "tick").attr("x", x(i27) + x.bandwidth() / 2).attr("y", H - 3).attr("text-anchor", "middle").attr("fill", COLORS.accent).text("2027");
    // ticks
    const tickIdx = [];
    years.forEach((y, i) => { const k = +y.key; if (k === 1987 || k === 2000 || k === 2014 || (k % 5 === 0 && k !== 2015 && k !== 2025 && W > 700)) tickIdx.push(i); });
    gTicks.selectAll("text").data(tickIdx).join("text").attr("class", "tick")
      .attr("x", (i) => x(i) + x.bandwidth() / 2).attr("y", H - 3).attr("text-anchor", "middle")
      .text((i) => years[i].key)
      .attr("opacity", (i) => (Math.abs(i - idx) <= (W > 700 ? 1 : 2) ? 0 : 1));

    // eras
    const i14 = years.findIndex((y) => y.era === "plus");
    gEra.selectAll("*").remove();
    gEra.append("text").attr("class", "era-label").attr("x", x(0)).attr("y", 10).text(W > 620 ? "Erasmus · higher-education students" : "Erasmus");
    gEra.append("text").attr("class", "era-label").attr("x", x(i14) + 4).attr("y", 10).text(W > 620 ? "Erasmus+ · all sectors" : "Erasmus+");
    gEra.append("line").attr("x1", x(i14) - x.step() * 0.14).attr("x2", x(i14) - x.step() * 0.14).attr("y1", 2).attr("y2", base)
      .attr("stroke", COLORS.ink3).attr("stroke-opacity", 0.6);

    // cursor
    cursor.select(".cur").attr("x", x(idx) - x.step() * 0.14).attr("width", x.step()).attr("y", top - 4).attr("height", base - top + 8);
    curLabel.attr("x", x(idx) + x.bandwidth() / 2).attr("y", H - 3).text(years[idx].label);
    el.setAttribute("aria-valuenow", years[idx].key);
    el.setAttribute("aria-valuetext", `${years[idx].label}: ${fmt(yearTotal(years[idx], sector))} participants`);
  }

  function idxAt(clientX) {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0, bd = Infinity;
    for (let i = 0; i < years.length; i++) {
      const d = Math.abs(x(i) + x.bandwidth() / 2 - px);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  let scrubbing = false;
  el.addEventListener("pointerdown", (e) => { scrubbing = true; el.setPointerCapture(e.pointerId); onChange(idxAt(e.clientX), true); });
  el.addEventListener("pointermove", (e) => {
    const i = idxAt(e.clientX);
    if (scrubbing) { if (i !== idx) onChange(i, true); return; }
    const y = years[i];
    showTip(e.clientX, e.clientY - 30, y.label, [{ label: sector === "ALL" ? "Participants" : data.meta.sectorNames[sector], value: fmt(yearTotal(y, sector)) }],
      y.era === "plus" ? "Erasmus+ KA1, all participants" : "Erasmus higher-education students");
  });
  el.addEventListener("pointerup", () => { scrubbing = false; });
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("keydown", (e) => {
    let i = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") i = Math.min(years.length - 1, idx + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") i = Math.max(0, idx - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = years.length - 1;
    else return;
    e.preventDefault();
    onChange(i, true);
  });

  new ResizeObserver(layout).observe(el);
  return {
    render(state) { idx = state.idx; sector = state.sector; draw(); },
  };
}
