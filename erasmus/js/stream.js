// Streamgraph: monthly Erasmus+ KA1 departures by sector, 2014-2024.
import { COLORS, fmt, showTip, hideTip } from "./util.js";

export function createStream(el, data, { onPickYear }) {
  const H = 150, M = { t: 8, r: 6, b: 22, l: 6 };
  const keys = data.meta.sectors; // validated adjacency order
  const rows = data.monthly.map((r) => {
    const o = { date: new Date(+r[0].slice(0, 4), +r[0].slice(5, 7) - 1, 15) };
    keys.forEach((k, i) => (o[k] = r[i + 1]));
    o.total = keys.reduce((s, k) => s + o[k], 0);
    return o;
  }).filter((r) => r.date.getFullYear() >= 2014 && r.date.getFullYear() <= 2024);

  const svg = d3.select(el).append("svg").attr("height", H).attr("role", "img")
    .attr("aria-label", "Streamgraph of monthly Erasmus+ departures by sector, January 2014 to December 2024");
  const gAreas = svg.append("g");
  const gShade = svg.append("g").attr("pointer-events", "none");
  const gAxis = svg.append("g").attr("class", "axis");
  const gNote = svg.append("g").attr("pointer-events", "none");
  const cross = svg.append("line").attr("stroke", COLORS.ink).attr("stroke-opacity", 0.6).attr("stroke-width", 1).style("display", "none");
  const hit = svg.append("rect").attr("fill", "transparent").style("cursor", "pointer");
  const empty = d3.select(el).append("div").attr("class", "empty").style("display", "none").style("pointer-events", "none");
  const legend = d3.select(el).append("div").attr("class", "legend");
  keys.forEach((k) => {
    const s = legend.append("span");
    s.append("i").style("background", COLORS.sector[k]);
    s.append("span").text(data.meta.sectorNames[k]);
  });

  const series = d3.stack().keys(keys).offset(d3.stackOffsetSilhouette).order(d3.stackOrderNone)(rows);
  let W = 0, x, y, area;

  function layout() {
    W = el.clientWidth || 400;
    svg.attr("width", W).attr("viewBox", `0 0 ${W} ${H}`);
    x = d3.scaleTime().domain(d3.extent(rows, (d) => d.date)).range([M.l, W - M.r]);
    y = d3.scaleLinear()
      .domain([d3.min(series, (s) => d3.min(s, (d) => d[0])), d3.max(series, (s) => d3.max(s, (d) => d[1]))])
      .range([H - M.b, M.t]);
    area = d3.area().x((d) => x(d.data.date)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
    gAreas.selectAll("path").data(series, (d) => d.key).join("path")
      .attr("d", area)
      .attr("fill", (d) => COLORS.sector[d.key])
      .attr("stroke", "#0A0A0A").attr("stroke-width", 1)
      .attr("fill-opacity", 0.92);
    gAxis.attr("transform", `translate(0,${H - M.b + 4})`)
      .call(d3.axisBottom(x).ticks(d3.timeYear.every(W < 380 ? 3 : 2)).tickFormat(d3.timeFormat("%Y")).tickSize(0).tickPadding(6))
      .call((g) => g.select(".domain").remove());
    // Covid annotation at the April 2020 trough
    const apr20 = rows.find((r) => r.date.getFullYear() === 2020 && r.date.getMonth() === 3);
    gNote.selectAll("*").remove();
    if (apr20) {
      const cx = x(apr20.date);
      gNote.append("line").attr("x1", cx).attr("x2", cx).attr("y1", M.t + 4).attr("y2", y(0) - 6)
        .attr("stroke", COLORS.ink3).attr("stroke-width", 1);
      gNote.append("text").attr("x", cx + 4).attr("y", M.t + 10).attr("fill", COLORS.ink2).attr("font-size", 10.5).text("Covid-19");
    }
    hit.attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b);
  }

  let state = { key: null, sector: "ALL" };
  function render({ yearKey, era, sector }) {
    if (!W || el.clientWidth !== W) layout();
    state = { key: yearKey, sector };
    gAreas.selectAll("path").transition().duration(400)
      .attr("fill-opacity", (d) => (sector === "ALL" || sector === d.key ? 0.92 : 0.14));
    gShade.selectAll("*").remove();
    if (era === "plus") {
      const yr = +yearKey;
      const a = x(new Date(yr, 0, 1)), b = x(new Date(yr, 11, 31));
      gShade.append("rect").attr("x", M.l).attr("y", 0).attr("width", Math.max(0, a - M.l)).attr("height", H - M.b).attr("fill", "#0A0A0A").attr("opacity", 0.55);
      gShade.append("rect").attr("x", b).attr("y", 0).attr("width", Math.max(0, W - M.r - b)).attr("height", H - M.b).attr("fill", "#0A0A0A").attr("opacity", 0.55);
      gShade.append("line").attr("x1", a).attr("x2", a).attr("y1", 0).attr("y2", H - M.b).attr("stroke", COLORS.accent).attr("stroke-opacity", 0.5);
      gShade.append("line").attr("x1", b).attr("x2", b).attr("y1", 0).attr("y2", H - M.b).attr("stroke", COLORS.accent).attr("stroke-opacity", 0.5);
      empty.style("display", "none");
    } else {
      gShade.append("rect").attr("x", 0).attr("y", 0).attr("width", W).attr("height", H - M.b).attr("fill", "#0A0A0A").attr("opacity", 0.62);
      empty.style("display", null).style("height", H - M.b + "px").text("Erasmus+ opens to every sector in 2014. Press play or pick a year from 2014 to light this up.");
    }
  }

  const fmtMonth = d3.timeFormat("%B %Y");
  hit.on("pointermove", (e) => {
    const [mx] = d3.pointer(e);
    const d0 = x.invert(mx);
    const i = d3.bisector((d) => d.date).center(rows, d0);
    const r = rows[i];
    cross.style("display", null).attr("x1", x(r.date)).attr("x2", x(r.date)).attr("y1", M.t).attr("y2", H - M.b);
    const list = keys.slice().reverse().map((k) => ({ label: data.meta.sectorNames[k], value: fmt(r[k]), color: COLORS.sector[k] }));
    list.push({ label: "All sectors", value: fmt(r.total) });
    showTip(e.clientX, e.clientY, fmtMonth(r.date), list, "Click to jump to this year");
  }).on("pointerleave", () => { cross.style("display", "none"); hideTip(); })
    .on("click", (e) => {
      const [mx] = d3.pointer(e);
      onPickYear(String(x.invert(mx).getFullYear()));
    });

  new ResizeObserver(() => { if (el.clientWidth && el.clientWidth !== W) { layout(); if (state.key) render({ yearKey: state.key, era: +state.key >= 2014 ? "plus" : "erasmus", sector: state.sector }); } }).observe(el);
  return { render };
}
