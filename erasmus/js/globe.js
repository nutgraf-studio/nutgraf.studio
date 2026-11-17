// 3D globe centred on Europe: dotted land that glows with each country's activity,
// great-circle arcs with travelling particles for the selected year's flows.
import * as THREE from "../vendor/three.module.min.js";
import { COLORS, fmt, showTip, hideTip, reducedMotion } from "./util.js";

// ISO 3166 numeric (world-atlas ids) -> codes used by the Erasmus data (EL = Greece, UK = United Kingdom)
const ISO_NUM = {
  "040": "AT", "056": "BE", "100": "BG", "191": "HR", "196": "CY", "203": "CZ", "208": "DK", "233": "EE",
  "246": "FI", "250": "FR", "276": "DE", "300": "EL", "348": "HU", "352": "IS", "372": "IE", "380": "IT",
  "428": "LV", "438": "LI", "440": "LT", "442": "LU", "470": "MT", "528": "NL", "578": "NO", "616": "PL",
  "620": "PT", "642": "RO", "703": "SK", "705": "SI", "724": "ES", "752": "SE", "756": "CH", "792": "TR",
  "826": "UK", "807": "MK", "688": "RS", "499": "ME", "008": "AL", "070": "BA", "804": "UA", "498": "MD",
  "112": "BY", "643": "RU", "268": "GE", "051": "AM", "031": "AZ", "504": "MA", "788": "TN", "012": "DZ",
  "818": "EG", "376": "IL", "275": "PS", "400": "JO", "422": "LB", "840": "US", "124": "CA", "156": "CN",
  "710": "ZA", "398": "KZ", "704": "VN", "392": "JP", "356": "IN", "076": "BR", "360": "ID", "764": "TH",
  "410": "KR", "036": "AU", "484": "MX", "860": "UZ", "404": "KE", "288": "GH", "152": "CL", "032": "AR",
  "458": "MY", "170": "CO", "834": "TZ", "800": "UG", "686": "SN", "364": "IR", "417": "KG", "231": "ET",
  "116": "KH", "158": "TW", "524": "NP", "120": "CM", "384": "CI", "608": "PH", "508": "MZ", "450": "MG",
  "604": "PE", "516": "NA", "064": "BT", "192": "CU", "566": "NG", "554": "NZ", "144": "LK", "218": "EC",
  "496": "MN", "188": "CR", "214": "DO", "304": "GL", "858": "UY", "586": "PK", "050": "BD", "646": "RW",
  "204": "BJ", "784": "AE", "760": "SY", "762": "TJ", "894": "ZM", "068": "BO", "768": "TG", "368": "IQ",
  "740": "SR",
};

const DEG = Math.PI / 180;
function ll2v(lat, lon, r = 1) {
  const la = lat * DEG, lo = lon * DEG;
  return new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
}
function arcHeight(a, b) {
  const om = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  return 0.02 + 0.17 * om;
}
function slerpLift(a, b, h, t, out) {
  const c = Math.max(-0.9999, Math.min(0.9999, a.dot(b)));
  const om = Math.acos(c), so = Math.sin(om);
  const k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
  out.set(a.x * k1 + b.x * k2, a.y * k1 + b.y * k2, a.z * k1 + b.z * k2).normalize()
    .multiplyScalar(1 + h * Math.sin(Math.PI * t));
  return out;
}

const SLERP_GLSL = `
vec3 slerpLift(vec3 a, vec3 b, float h, float t){
  float c = clamp(dot(a,b), -0.9999, 0.9999);
  float om = acos(c);
  float so = sin(om);
  vec3 p = (sin((1.0-t)*om)*a + sin(t*om)*b)/so;
  return normalize(p) * (1.0 + h*sin(3.14159265*t));
}`;

// Departure colour -> cream -> arrival colour. A straight gold/cyan mix turns green midway.
const FLOW_GLSL = `
vec3 flowMix(vec3 a, vec3 b, float t){
  vec3 m = vec3(0.929, 0.914, 0.882);
  float s = smoothstep(0.35, 0.65, t);
  return s < 0.5 ? mix(a, m, s * 2.0) : mix(m, b, s * 2.0 - 1.0);
}`;

// These shader materials write colour straight to the canvas, so keep the hex as-is
// (no sRGB->linear conversion); otherwise the gold renders orange.
const rawColor = (hex) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);

export async function createGlobe({ canvas, labelsEl, data, onSelect, onHover, zoom = 1.2 }) {
  const wrap = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  const PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  // Lens zoom on the resting view. Point sprites are sized in pixels, so they scale with it
  // (PS) and the globe looks the same, only closer; the offset is divided by it so Europe stays put.
  const ZOOM = zoom;
  const PS = PR * ZOOM;
  renderer.setClearColor(0x000000, 0);

  // Land style. 2 (shaded land) is the default since 17 Nov 2026; ?land=0|1|3 shows the alternatives
  // (0 = original even sprinkle, 1 = fine stipple, 3 = halftone sand).
  //  k: dot density over Europe relative to the rest of the globe (fades out 25-45 degrees from its centre)
  //  sizeExp: how much dots shrink where they are denser (0 = same size, 0.5 = shrink with spacing)
  //  baseA: opacity of land dots that carry no data glow; coast / borders: line opacity; fill: solid land tint
  //  jitter: random nudge (share of the local dot spacing) that breaks the lattice's moiré
  const LAND_STYLES = {
    0: { k: 1, sizeExp: 0, baseA: 0.2, coast: 0.2, borders: 0.1, fill: 0 },
    1: { k: 4, sizeExp: 0.42, baseA: 0.26, coast: 0.24, borders: 0.04, fill: 0 },
    2: { k: 4, sizeExp: 0.42, baseA: 0.22, coast: 0.34, borders: 0, fill: 0.11 },
    3: { k: 9, sizeExp: 0.32, baseA: 0.46, coast: 0, borders: 0, fill: 0, jitter: 0.35 },
  };
  const landKey = new URLSearchParams(location.search).get("land");
  const LAND = LAND_STYLES[landKey] || LAND_STYLES[2];

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 2.55);

  const world = new THREE.Group();   // offset in screen space
  const globe = new THREE.Group();   // rotated so Europe faces the camera
  world.add(globe);
  scene.add(world);

  // ---- countries / codes ------------------------------------------------
  const codes = Object.keys(data.countries).filter((c) => data.countries[c][1] != null);
  const codeIndex = new Map(codes.map((c, i) => [c, i]));
  const N_UNI = 160;
  const pos = new Map(codes.map((c) => [c, ll2v(data.countries[c][1], data.countries[c][2])]));

  // ---- core sphere + atmosphere ----------------------------------------
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.996, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: { uRim: { value: rawColor(COLORS.accent2) }, uMask: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
        uFill: { value: 0 }, uLand: { value: rawColor("#EDE9E1") } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uRim; uniform sampler2D uMask; uniform float uFill; uniform vec3 uLand; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
          vec3 base = vec3(0.043, 0.047, 0.045);
          if (uFill > 0.0) {
            vec3 q = normalize(vP);
            vec2 uv = vec2(atan(q.x, q.z) / 6.2831853 + 0.5, 0.5 + asin(q.y) / 3.1415927);
            base = mix(base, uLand, texture2D(uMask, uv).r * uFill);
          }
          gl_FragColor = vec4(base + uRim * f * 0.35, 1.0); }`,
    })
  );
  globe.add(core);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 64, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uC: { value: rawColor(COLORS.accent2) } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uC; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(max(0.0, 0.62 - dot(vN, vV)*-1.0), 4.0); gl_FragColor = vec4(uC, 1.0) * f * 0.9; }`,
    })
  );
  world.add(atmo);

  // ---- land dots (country-coded via an offscreen equirectangular raster) --
  const topo = await fetch("vendor/countries-50m.json").then((r) => r.json());
  const countriesGeo = topojson.feature(topo, topo.objects.countries);
  const W = LAND.k > 1 ? 4096 : 2048, H = W / 2;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const proj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  const path = d3.geoPath(proj, ctx);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  countriesGeo.features.forEach((f) => {
    let code = ISO_NUM[f.id];
    if (!code && f.properties && f.properties.name === "Kosovo") code = "XK";
    const idx = code != null && codeIndex.has(code) ? codeIndex.get(code) + 1 : 0;
    ctx.fillStyle = `rgb(${idx},255,0)`;
    ctx.beginPath(); path(f); ctx.fill();
  });
  const px = ctx.getImageData(0, 0, W, H).data;
  if (LAND.fill > 0) {
    const mc = document.createElement("canvas");
    mc.width = 2048; mc.height = 1024;
    const mx = mc.getContext("2d");
    const mpath = d3.geoPath(d3.geoEquirectangular().scale(2048 / (2 * Math.PI)).translate([1024, 512]), mx);
    mx.fillStyle = "#000"; mx.fillRect(0, 0, 2048, 1024);
    mx.fillStyle = "#fff";
    countriesGeo.features.forEach((f) => { mx.beginPath(); mpath(f); mx.fill(); });
    const tex = new THREE.CanvasTexture(mc);
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    core.material.uniforms.uMask.value = tex;
    core.material.uniforms.uFill.value = LAND.fill;
  }

  const NBASE = window.innerWidth < 700 ? 110000 : 170000;
  const NPTS = NBASE * LAND.k;
  const dotPos = [], dotIdx = [], dotSize = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const centre = ll2v(50, 15);
  const hash = (i) => { const h = Math.sin(i * 12.9898) * 43758.5453; return h - Math.floor(h); };
  for (let i = 0; i < NPTS; i++) {
    const y = 1 - (i / (NPTS - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    let x = Math.cos(th) * r, z = Math.sin(th) * r;
    let dens = 1;
    if (LAND.k > 1) {
      const ang = Math.acos(Math.max(-1, Math.min(1, x * centre.x + y * centre.y + z * centre.z))) / DEG;
      const w = ang <= 25 ? 1 : ang >= 45 ? 0 : 1 - (ang - 25) / 20;
      const keep = 1 / LAND.k + (1 - 1 / LAND.k) * w;
      if (hash(i) > keep) continue;
      dens = keep * LAND.k;
    }
    let yy = y;
    if (LAND.jitter) {
      const amt = LAND.jitter * Math.sqrt(4 * Math.PI / NBASE) / Math.sqrt(dens);
      x += (hash(i + 0.31) - 0.5) * 2 * amt; yy += (hash(i + 0.57) - 0.5) * 2 * amt; z += (hash(i + 0.83) - 0.5) * 2 * amt;
      const n = Math.hypot(x, yy, z); x /= n; yy /= n; z /= n;
    }
    const lat = Math.asin(yy) / DEG;
    const lon = Math.atan2(x, z) / DEG;
    if (lat < -60) continue; // skip Antarctica
    const u = Math.floor(((lon + 180) / 360) * W) % W;
    const v = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    const o = (v * W + u) * 4;
    if (px[o + 1] < 200) continue; // ocean or soft edge
    dotPos.push(x * 1.001, yy * 1.001, z * 1.001);
    dotIdx.push(px[o] > 0 ? px[o] - 1 : -1);
    dotSize.push(Math.pow(dens, -LAND.sizeExp));
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPos, 3));
  dotGeo.setAttribute("cidx", new THREE.Float32BufferAttribute(dotIdx, 1));
  dotGeo.setAttribute("dsz", new THREE.Float32BufferAttribute(dotSize, 1));
  const intensity = new Float32Array(N_UNI), intensityTarget = new Float32Array(N_UNI);
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uInt: { value: intensity }, uFocus: { value: -1 }, uSize: { value: 1.55 }, uPR: { value: PS },
      uBase: { value: new THREE.Color("#EDE9E1") }, uHot: { value: rawColor(COLORS.accent) },
      uFocusCol: { value: new THREE.Color("#ffffff") }, uBaseA: { value: LAND.baseA },
    },
    vertexShader: `attribute float cidx; attribute float dsz; uniform float uInt[${N_UNI}]; uniform float uFocus; uniform float uSize; uniform float uPR;
      varying float vI; varying float vFace; varying float vF;
      void main(){
        float inten = 0.0;
        if (cidx > -0.5) { inten = uInt[int(cidx + 0.5)]; }
        vI = inten;
        vF = (cidx > -0.5 && abs(cidx - uFocus) < 0.5) ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = normalize(normalMatrix * position).z;
        gl_PointSize = uSize * uPR * dsz * (1.0 + inten * 0.8 + vF * 0.6) * (2.6 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uBase; uniform vec3 uHot; uniform vec3 uFocusCol; uniform float uBaseA;
      varying float vI; varying float vFace; varying float vF;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.15, d);
        vec3 col = mix(uBase, uHot, clamp(vI * 1.15, 0.0, 1.0));
        col = mix(col, uFocusCol, vF * 0.55);
        float alpha = (uBaseA + (1.0 - uBaseA) * clamp(vI, 0.0, 1.0)) * a * smoothstep(-0.02, 0.3, vFace);
        alpha = max(alpha, vF * a * 0.9 * smoothstep(-0.02, 0.3, vFace));
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  globe.add(new THREE.Points(dotGeo, dotMat));

  // ---- borders & coasts ---------------------------------------------------
  function meshToSegments(mesh, r) {
    const out = [];
    for (const line of mesh.coordinates) {
      for (let i = 1; i < line.length; i++) {
        const a = ll2v(line[i - 1][1], line[i - 1][0], r), b = ll2v(line[i][1], line[i][0], r);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    return g;
  }
  const borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const coasts = topojson.mesh(topo, topo.objects.countries, (a, b) => a === b);
  if (LAND.borders > 0) globe.add(new THREE.LineSegments(meshToSegments(borders, 1.0015),
    new THREE.LineBasicMaterial({ color: 0xEDE9E1, transparent: true, opacity: LAND.borders, depthWrite: false })));
  if (LAND.coast > 0) globe.add(new THREE.LineSegments(meshToSegments(coasts, 1.0015),
    new THREE.LineBasicMaterial({ color: 0xEDE9E1, transparent: true, opacity: LAND.coast, depthWrite: false })));

  // ---- arcs + particles (rebuilt per year), with cross-fade ----------------
  const accentC = rawColor(COLORS.accent), accent2C = rawColor(COLORS.accent2);
  let layers = []; // {arcs, parts, born, dying}

  function arcMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uOpacity: { value: 0 }, uProgress: { value: reducedMotion ? 2 : 0 }, uA: { value: accentC }, uB: { value: accent2C } },
      vertexShader: `attribute float t; attribute float w; attribute float delay; varying float vT; varying float vW; varying float vD;
        void main(){ vT = t; vW = w; vD = delay; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `${FLOW_GLSL}
        uniform float uOpacity; uniform float uProgress; uniform vec3 uA; uniform vec3 uB;
        varying float vT; varying float vW; varying float vD;
        void main(){
          float p = clamp((uProgress - vD) / 0.55, 0.0, 1.0);
          if (vT > p) discard;
          vec3 col = flowMix(uA, uB, vT);
          float a = uOpacity * (0.07 + 0.75 * vW) * pow(sin(3.14159 * clamp(vT,0.02,0.98)), 0.35);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
  }
  function partMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPR: { value: PS }, uA: { value: accentC }, uB: { value: accent2C } },
      vertexShader: `${SLERP_GLSL}
        attribute vec3 pa; attribute vec3 pb; attribute float h; attribute float phase; attribute float speed; attribute float w;
        uniform float uTime; uniform float uPR; varying float vT; varying float vW; varying float vFace;
        void main(){
          float t = fract(phase + uTime * speed);
          vec3 p = slerpLift(pa, pb, h, t);
          vT = t; vW = w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFace = normalize(normalMatrix * p).z + h * 2.0;
          gl_PointSize = uPR * (2.2 + 4.2 * w) * (2.6 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `${FLOW_GLSL}
        uniform float uOpacity; uniform vec3 uA; uniform vec3 uB; varying float vT; varying float vW; varying float vFace;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          vec3 col = mix(flowMix(uA, uB, vT), vec3(1.0), core * 0.45);
          float a = uOpacity * (0.45 + 0.55 * vW) * core * pow(sin(3.14159 * vT), 0.6) * smoothstep(-0.15, 0.2, vFace);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
  }

  function buildLayer(flows) {
    const list = flows.filter((f) => pos.has(f[0]) && pos.has(f[1])).slice(0, 320);
    if (!list.length) return null;
    const maxN = list[0][2];
    const lmax = Math.log(1 + maxN);
    const SEG = 56;
    const P = [], T = [], Wt = [], D = [];
    const pa = [], pb = [], ph = [], phase = [], speed = [], pw = [];
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    let budget = 2200;
    list.forEach((f, rank) => {
      const a = pos.get(f[0]), b = pos.get(f[1]);
      const h = arcHeight(a, b);
      const w = Math.log(1 + f[2]) / lmax;
      const delay = Math.min(0.45, (rank / list.length) * 0.45);
      for (let s = 0; s < SEG; s++) {
        const t0 = s / SEG, t1 = (s + 1) / SEG;
        slerpLift(a, b, h, t0, tmp); slerpLift(a, b, h, t1, tmp2);
        P.push(tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z);
        T.push(t0, t1); Wt.push(w, w); D.push(delay, delay);
      }
      const k = rank < 160 ? Math.max(1, Math.round(1 + w * w * 6)) : (rank % 2 === 0 ? 1 : 0);
      for (let j = 0; j < k && budget > 0; j++, budget--) {
        pa.push(a.x, a.y, a.z); pb.push(b.x, b.y, b.z); ph.push(h);
        phase.push(Math.random()); speed.push(0.07 + Math.random() * 0.06 + 0.04 * (1 - w)); pw.push(w);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("t", new THREE.Float32BufferAttribute(T, 1));
    g.setAttribute("w", new THREE.Float32BufferAttribute(Wt, 1));
    g.setAttribute("delay", new THREE.Float32BufferAttribute(D, 1));
    const arcs = new THREE.LineSegments(g, arcMaterial());
    const pg = new THREE.BufferGeometry();
    const n = ph.length;
    pg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute("pa", new THREE.Float32BufferAttribute(pa, 3));
    pg.setAttribute("pb", new THREE.Float32BufferAttribute(pb, 3));
    pg.setAttribute("h", new THREE.Float32BufferAttribute(ph, 1));
    pg.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1));
    pg.setAttribute("speed", new THREE.Float32BufferAttribute(speed, 1));
    pg.setAttribute("w", new THREE.Float32BufferAttribute(pw, 1));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    const parts = new THREE.Points(pg, partMaterial());
    globe.add(arcs); globe.add(parts);
    return { arcs, parts, born: performance.now(), dying: false };
  }

  // ---- country nodes (glow discs) ------------------------------------------
  const nodeGeo = new THREE.BufferGeometry();
  const nodePos = new Float32Array(codes.length * 3), nodeSize = new Float32Array(codes.length), nodeSizeT = new Float32Array(codes.length);
  const nodeFocus = new Float32Array(codes.length);
  codes.forEach((c, i) => { const v = pos.get(c).clone().multiplyScalar(1.004); nodePos.set([v.x, v.y, v.z], i * 3); });
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute("size", new THREE.BufferAttribute(nodeSize, 1));
  nodeGeo.setAttribute("focus", new THREE.BufferAttribute(nodeFocus, 1));
  const nodeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: PS }, uA: { value: accentC }, uF: { value: new THREE.Color("#ffffff") } },
    vertexShader: `attribute float size; attribute float focus; uniform float uPR; varying float vFace; varying float vF;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vFace = normalize(normalMatrix*position).z; vF = focus;
        gl_PointSize = uPR * size * (2.6 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uA; uniform vec3 uF; varying float vFace; varying float vF;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
        float glow = pow(smoothstep(0.5, 0.0, d), 2.2);
        float ring = smoothstep(0.06, 0.0, abs(d - 0.36)) * vF;
        vec3 col = mix(uA, uF, 0.25 + vF*0.5);
        float a = (glow * 0.85 + ring) * smoothstep(-0.02, 0.25, vFace);
        gl_FragColor = vec4(col * a, a); }`,
  });
  globe.add(new THREE.Points(nodeGeo, nodeMat));

  // ---- labels ----------------------------------------------------------------
  const labelEls = [];
  let labelCodes = [];
  function setLabels(list) {
    labelCodes = list;
    while (labelEls.length < list.length) {
      const el = document.createElement("div");
      el.className = "glabel";
      labelsEl.appendChild(el);
      labelEls.push(el);
    }
    labelEls.forEach((el, i) => {
      if (i < list.length) {
        el.replaceChildren(document.createTextNode(data.countries[list[i].code][0]));
        const b = document.createElement("b");
        b.textContent = list[i].value;
        el.appendChild(b);
        el.style.display = "";
        el._w = el.offsetWidth;
      } else el.style.display = "none";
    });
  }

  // ---- orientation & interaction ------------------------------------------
  const view = { lon: 11, lat: 47, dLon: 0, dLat: 0, vLon: 0, vLat: 0, idleSince: performance.now() };
  // After a drag, wait a beat, then glide back to Europe (the short way round).
  const HOME_DELAY = 1500;                       // ms after the last drag movement
  const HOME_MIN = 800, HOME_MAX = 2000;         // glide duration, scaled by distance
  const wrap180 = (x) => ((x + 180) % 360 + 360) % 360 - 180;
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  let lastDrag = 0, homing = null;
  let dragging = false, moved = 0, last = null;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; last = [e.clientX, e.clientY];
    homing = null; // grab the globe wherever the glide has got to
    canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = [e.clientX, e.clientY];
      view.vLon = -dx * 0.14; view.vLat = dy * 0.11;
      view.dLon += view.vLon; view.dLat = Math.max(-35, Math.min(30, view.dLat + view.vLat));
      view.idleSince = lastDrag = performance.now();
      hideTip();
      return;
    }
    hover(e);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false; canvas.classList.remove("dragging");
    lastDrag = performance.now();
    if (moved < 6) {
      const hit = pick(e.clientX, e.clientY);
      onSelect && onSelect(hit);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", () => { dragging = false; lastDrag = performance.now(); canvas.classList.remove("dragging"); });
  canvas.addEventListener("pointerleave", () => { if (!dragging) { hideTip(); onHover && onHover(null); } });

  const proj2 = new THREE.Vector3();
  function screenOf(code, rect) {
    const v = pos.get(code).clone().multiplyScalar(1.004);
    globe.localToWorld(v);
    const n = v.clone().sub(world.position).normalize();
    const toCam = camera.position.clone().sub(v).normalize();
    const facing = n.dot(toCam);
    proj2.copy(v).project(camera);
    const r = rect || canvas.getBoundingClientRect();
    const lx = (proj2.x + 1) / 2 * r.width, ly = (1 - proj2.y) / 2 * r.height;
    return { x: r.left + lx, y: r.top + ly, facing, lx, ly };
  }
  let current = { nodes: {}, flows: [], label: "" };
  function pick(x, y) {
    let best = null, bd = 24;
    const rect = canvas.getBoundingClientRect();
    for (const c of codes) {
      const nd = current.nodes[c];
      if (!nd) continue;
      const s = screenOf(c, rect);
      if (s.facing < 0.05) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function hover(e) {
    const c = pick(e.clientX, e.clientY);
    onHover && onHover(c);
    if (!c) { hideTip(); return; }
    const nd = current.nodes[c] || [0, 0, 0];
    const rows = [{ label: "Departures", value: fmt(nd[0]), color: COLORS.accent }];
    if (nd[1] != null) rows.push({ label: "Arrivals", value: fmt(nd[1]), color: COLORS.accent2 });
    if (nd[2]) rows.push({ label: "Within the country", value: fmt(nd[2]) });
    const top = current.flows.filter((f) => f[0] === c).slice(0, 3);
    let note = top.length ? "Top destinations: " + top.map((f) => `${data.countries[f[1]] ? data.countries[f[1]][0] : f[1]} ${fmt(f[2])}`).join(" · ") : null;
    if (!current.hasPairs) note = nd[1] == null ? "Students sent abroad; destinations not published for this year" : "Country totals only for this year";
    showTip(e.clientX, e.clientY, `${data.countries[c][0]} · ${current.label}`, rows, note);
  }

  // ---- public update ---------------------------------------------------------
  function update({ flows, nodes, label, hasPairs, focus, founders }) {
    current = { nodes: nodes || {}, flows: flows || [], label, hasPairs };
    // node + dot intensities
    // when following a country, light its partners by their exchange with it
    let glow = current.nodes;
    if (focus && current.hasPairs) {
      glow = {};
      for (const [s, r, n] of current.flows) {
        if (s === focus) (glow[r] = glow[r] || [0, 0, 0])[1] += n;
        else if (r === focus) (glow[s] = glow[s] || [0, 0, 0])[0] += n;
      }
      if (current.nodes[focus]) glow[focus] = current.nodes[focus];
    }
    let max = 0;
    for (const c in glow) { if (c === focus && glow !== current.nodes) continue; const v = glow[c]; max = Math.max(max, v[0] + v[1] + v[2]); }
    intensityTarget.fill(0);
    nodeSizeT.fill(0);
    nodeFocus.fill(0);
    const lmax = Math.log(1 + max);
    for (const c in glow) {
      if (!codeIndex.has(c)) continue;
      const v = glow[c], tot = Math.min(max, v[0] + v[1] + v[2]);
      const i = codeIndex.get(c);
      intensityTarget[i] = max ? Math.pow(Math.log(1 + tot) / lmax, 2.2) : 0;
      nodeSizeT[i] = max ? 4 + 34 * Math.sqrt(tot / max) : 0;
    }
    if (founders) founders.forEach((c) => { if (codeIndex.has(c)) { intensityTarget[codeIndex.get(c)] = 0.55; nodeSizeT[codeIndex.get(c)] = 9; } });
    dotMat.uniforms.uFocus.value = focus && codeIndex.has(focus) ? codeIndex.get(focus) : -1;
    if (focus && codeIndex.has(focus)) nodeFocus[codeIndex.get(focus)] = 1;
    nodeGeo.attributes.focus.needsUpdate = true;

    // arcs
    layers.forEach((l) => { if (!l.dying) { l.dying = true; l.deathAt = performance.now(); } });
    let fl = current.flows;
    if (focus) fl = fl.filter((f) => f[0] === focus || f[1] === focus);
    const layer = fl.length ? buildLayer(fl) : null;
    if (layer) layers.push(layer);

    // labels: busiest countries
    const ranked = Object.entries(current.nodes).filter(([c]) => pos.has(c))
      .map(([c, v]) => ({ code: c, tot: v[0] + v[1] }))
      .sort((a, b) => b.tot - a.tot).slice(0, focus ? 0 : 7)
      .map((d) => ({ code: d.code, value: d.tot >= 1000 ? Math.round(d.tot / 1000) + "k" : String(d.tot) }));
    if (focus && current.nodes[focus]) {
      const v = current.nodes[focus];
      ranked.push({ code: focus, value: Math.round((v[0] + v[1]) / 1000) + "k" });
    }
    setLabels(ranked);
  }

  // ---- render loop -------------------------------------------------------------
  let w = 0, h = 0, visible = true, raf = 0;
  function resize() {
    const r = wrap.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const narrow = w < 700;
    camera.position.z = narrow ? 3.3 : 2.62;
    camera.zoom = ZOOM;
    world.position.set((narrow ? 0 : 0.2) / ZOOM, (narrow ? -0.06 : -0.03) / ZOOM, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();
  new IntersectionObserver((ents) => { visible = ents[0].isIntersecting; if (visible && !raf) loop(); }).observe(wrap);

  const t0 = performance.now();
  function loop() {
    raf = 0;
    if (!visible) return;
    const now = performance.now();
    const t = (now - t0) / 1000;
    // inertia + idle sway
    if (!dragging) {
      view.vLon *= 0.86; view.vLat *= 0.84;
      view.dLon += view.vLon; view.dLat = Math.max(-35, Math.min(30, view.dLat + view.vLat));
    }
    const idle = Math.min(1, Math.max(0, (now - view.idleSince - 2500) / 4000));
    const sway = reducedMotion ? 0 : Math.sin(t * 0.09) * 10 * idle;
    // recenter on Europe once the drag (and its inertia) has settled
    if (!dragging && !homing && !reducedMotion && now - lastDrag > HOME_DELAY
        && Math.abs(view.vLon) + Math.abs(view.vLat) < 0.05) {
      view.dLon = wrap180(view.dLon); // same view, but home is now the short way round
      const dist = Math.hypot(view.dLon, view.dLat);
      if (dist > 0.3) {
        view.vLon = view.vLat = 0;
        homing = { lon: view.dLon, lat: view.dLat, start: now, dur: Math.min(HOME_MAX, HOME_MIN + dist * 7) };
        hideTip(); // the hovered country is about to slide away
      } else if (dist > 0) { view.dLon = view.dLat = 0; }
    }
    if (homing) {
      const k = Math.min(1, (now - homing.start) / homing.dur), f = 1 - easeInOut(k);
      view.dLon = homing.lon * f; view.dLat = homing.lat * f;
      if (k >= 1) homing = null;
    }
    globe.rotation.set((view.lat + view.dLat) * DEG, -(view.lon + view.dLon + sway) * DEG, 0, "XYZ");

    for (let i = 0; i < N_UNI; i++) intensity[i] += (intensityTarget[i] - intensity[i]) * 0.06;
    for (let i = 0; i < codes.length; i++) nodeSize[i] += (nodeSizeT[i] - nodeSize[i]) * 0.08;
    nodeGeo.attributes.size.needsUpdate = true;

    layers = layers.filter((l) => {
      const am = l.arcs.material.uniforms, pm = l.parts.material.uniforms;
      pm.uTime.value = reducedMotion ? 0 : t;
      if (l.dying) {
        const k = 1 - Math.min(1, (now - l.deathAt) / 500);
        am.uOpacity.value = Math.min(am.uOpacity.value, k);
        pm.uOpacity.value = Math.min(pm.uOpacity.value, k);
        if (k <= 0) {
          globe.remove(l.arcs); globe.remove(l.parts);
          l.arcs.geometry.dispose(); l.parts.geometry.dispose(); l.arcs.material.dispose(); l.parts.material.dispose();
          return false;
        }
      } else {
        const age = (now - l.born) / 1000;
        am.uOpacity.value = Math.min(1, age / 0.4);
        am.uProgress.value = reducedMotion ? 2 : Math.min(2, age / 1.1);
        pm.uOpacity.value = Math.min(1, Math.max(0, (age - 0.6) / 0.6));
      }
      return true;
    });

    renderer.render(scene, camera);

    // labels follow their countries; greedy placement in rank order hides collisions
    const rect = canvas.getBoundingClientRect();
    const placed = [];
    labelCodes.forEach((d, i) => {
      const s = screenOf(d.code, rect);
      const el = labelEls[i];
      el.style.left = s.lx + "px"; el.style.top = s.ly + "px";
      const bw = el._w || 80, bx = s.lx - bw / 2, by = s.ly - 22;
      const hit = placed.some((p) => bx < p.x + p.w + 4 && bx + bw + 4 > p.x && by < p.y + 16 && by + 16 > p.y);
      const ok = s.facing > 0.25 && !hit && s.lx > 0 && s.lx < rect.width;
      if (ok) placed.push({ x: bx, y: by, w: bw });
      el.style.opacity = ok ? 0.85 : 0;
    });
    raf = requestAnimationFrame(loop);
  }
  loop();

  return { update, nudge() { view.idleSince = performance.now() - 2500; } };
}
