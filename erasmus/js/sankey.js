// Sankey: top sending -> top receiving countries for the selected year (or origins -> focus -> destinations).
import { COLORS, fmt, showTip, hideTip } from "./util.js";

const TOP = 7;

export function createSankey(el, data, { onSelect }) {
  const H = 232;
  const svg = d3.select(el).append("svg").attr("height", H).attr("role", "img");
  const defs = svg.append("defs");
  const gLinks = svg.append("g").attr("fill", "none");
  const gNodes = svg.append("g");
  const gLabels = svg.append("g");
  const empty = d3.select(el).append("div").attr("class", "empty").style("display", "none");
  el.style.height = H + "px";
  const name = (c) => (c === "OTHER_S" || c === "OTHER_R" || c === "OTHER" ? "Other" : data.countries[c] ? data.countries[c][0] : c);

  function build(flows, focus) {
    const links = new Map();
    const add = (s, t, v) => { const k = s + "|" + t; links.set(k, (links.get(k) || 0) + v); };
    if (!focus) {
      const out = new Map(), inn = new Map();
      for (const [s, r, n] of flows) { out.set(s, (out.get(s) || 0) + n); inn.set(r, (inn.get(r) || 0) + n); }
      const topS = new Set([...out].sort((a, b) => b[1] - a[1]).slice(0, TOP).map((d) => d[0]));
      const topR = new Set([...inn].sort((a, b) => b[1] - a[1]).slice(0, TOP).map((d) => d[0]));
      for (const [s, r, n] of flows) add("s:" + (topS.has(s) ? s : "OTHER_S"), "r:" + (topR.has(r) ? r : "OTHER_R"), n);
    } else {
      const ins = flows.filter((f) => f[1] === focus), outs = flows.filter((f) => f[0] === focus);
      const topO = new Set(ins.slice().sort((a, b) => b[2] - a[2]).slice(0, TOP - 1).map((f) => f[0]));
      const topD = new Set(outs.slice().sort((a, b) => b[2] - a[2]).slice(0, TOP - 1).map((f) => f[1]));
      for (const [s, , n] of ins) add("s:" + (topO.has(s) ? s : "OTHER_S"), "m:" + focus, n);
      for (const [, r, n] of outs) add("m:" + focus, "r:" + (topD.has(r) ? r : "OTHER_R"), n);
    }
    const nodeIds = new Set();
    const L = [...links].map(([k, v]) => { const [s, t] = k.split("|"); nodeIds.add(s); nodeIds.add(t); return { source: s, target: t, value: v }; });
    const N = [...nodeIds].map((id) => ({ id, code: id.slice(2), side: id[0] }));
    return { nodes: N, links: L };
  }

  function render({ flows, focus, hasPairs, label, emptyText }) {
    const W = el.clientWidth || 400;
    svg.attr("width", W).attr("viewBox", `0 0 ${W} ${H}`);
    if (!hasPairs || !flows || !flows.length) {
      gLinks.selectAll("*").remove(); gNodes.selectAll("*").remove(); gLabels.selectAll("*").remove();
      empty.style("display", null).text(emptyText || "No country-to-country flows recorded for this year.");
      svg.attr("aria-label", "No flow data for " + label);
      return;
    }
    const graph = build(flows, focus);
    if (!graph.links.length) {
      gLinks.selectAll("*").remove(); gNodes.selectAll("*").remove(); gLabels.selectAll("*").remove();
      empty.style("display", null).text(`No recorded flows for ${name(focus)} in ${label}.`);
      return;
    }
    empty.style("display", "none");
    const labelW = Math.min(118, W * 0.29);
    const sk = d3.sankey()
      .nodeId((d) => d.id)
      .nodeWidth(7)
      .nodePadding(focus ? 7 : 6)
      .nodeAlign(focus ? d3.sankeyJustify : d3.sankeyJustify)
      .nodeSort((a, b) => (a.code.startsWith("OTHER") - b.code.startsWith("OTHER")) || (b.value - a.value))
      .extent([[labelW, 6], [W - labelW, H - 6]]);
    const { nodes, links } = sk({ nodes: graph.nodes.map((d) => ({ ...d })), links: graph.links.map((d) => ({ ...d })) });
    svg.attr("aria-label", `Flows between the largest sending and receiving countries, ${label}`);

    defs.selectAll("*").remove();
    links.forEach((d, i) => {
      d._gid = `sk-grad-${i}`;
      const g = defs.append("linearGradient").attr("id", d._gid).attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", d.source.x1).attr("x2", d.target.x0).attr("y1", 0).attr("y2", 0);
      const a = d.source.side === "m" ? COLORS.ink : COLORS.accent;
      const b = d.target.side === "m" ? COLORS.ink : COLORS.accent2;
      // gold straight into cyan turns green midway, so pass through cream (as the globe arcs do)
      const stops = a !== COLORS.ink && b !== COLORS.ink ? [[35, a], [50, COLORS.ink], [65, b]] : [[0, a], [100, b]];
      stops.forEach(([o, c]) => g.append("stop").attr("offset", o + "%").attr("stop-color", c));
    });

    const t = svg.transition().duration(650).ease(d3.easeCubicOut);
    const lk = gLinks.selectAll("path").data(links, (d) => d.source.id + "|" + d.target.id);
    lk.exit().transition(t).attr("stroke-opacity", 0).remove();
    lk.enter().append("path")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke-opacity", 0)
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .on("pointermove", function (e, d) {
        d3.select(this).attr("stroke-opacity", 0.8);
        showTip(e.clientX, e.clientY, `${name(d.source.code)} → ${name(d.target.code)}`, [{ label: "Participants", value: fmt(d.value) }], label);
      })
      .on("pointerleave", function () { d3.select(this).attr("stroke-opacity", 0.42); hideTip(); })
      .merge(lk)
      .attr("stroke", (d) => `url(#${d._gid})`)
      .transition(t)
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .attr("stroke-opacity", 0.42);

    const nd = gNodes.selectAll("rect").data(nodes, (d) => d.id);
    nd.exit().transition(t).attr("opacity", 0).remove();
    nd.enter().append("rect")
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0).attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr("rx", 2).attr("opacity", 0)
      .style("cursor", (d) => (d.code.startsWith("OTHER") ? "default" : "pointer"))
      .on("click", (e, d) => { if (!d.code.startsWith("OTHER")) onSelect(d.code === focus ? null : d.code); })
      .on("pointermove", (e, d) => showTip(e.clientX, e.clientY, name(d.code), [{ label: d.side === "s" ? "Sent" : d.side === "r" ? "Received" : "Through", value: fmt(d.value) }], d.code.startsWith("OTHER") ? "Countries outside the top seven" : "Click to follow this country"))
      .on("pointerleave", hideTip)
      .merge(nd)
      .attr("fill", (d) => (d.code.startsWith("OTHER") ? "#5a5852" : d.side === "m" ? COLORS.ink : d.side === "s" ? COLORS.accent : COLORS.accent2))
      .transition(t)
      .attr("x", (d) => d.x0).attr("y", (d) => d.y0).attr("width", (d) => d.x1 - d.x0).attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr("opacity", 1);

    const lb = gLabels.selectAll("text").data(nodes.filter((d) => d.y1 - d.y0 >= 7 || d.side === "m"), (d) => d.id);
    lb.exit().remove();
    const lbE = lb.enter().append("text").attr("class", "node-label").attr("dy", "0.35em")
      .attr("x", (d) => (d.side === "r" ? d.x1 + 6 : d.x0 - 6))
      .attr("y", (d) => (d.side === "m" ? Math.max(10, d.y0 - 6) : (d.y0 + d.y1) / 2));
    lbE.append("tspan").attr("class", "nm");
    lbE.append("tspan").attr("class", "n").attr("dx", 4);
    const lbM = lbE.merge(lb);
    lbM.select(".nm").text((d) => name(d.code));
    lbM.select(".n").text((d) => (d.side === "m" ? "" : fmt(d.value)));
    lbM.attr("text-anchor", (d) => (d.side === "r" ? "start" : "end"))
      .transition(t)
      .attr("x", (d) => (d.side === "r" ? d.x1 + 6 : d.side === "m" ? d.x0 - 6 : d.x0 - 6))
      .attr("y", (d) => (d.side === "m" ? Math.max(12, d.y0 - 2) : (d.y0 + d.y1) / 2));
    lbM.filter((d) => d.side === "m").attr("text-anchor", "middle").attr("x", (d) => (d.x0 + d.x1) / 2).attr("y", (d) => Math.max(10, d.y0 - 6));
  }

  return { render };
}
