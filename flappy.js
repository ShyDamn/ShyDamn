#!/usr/bin/env node
/**
 * Synapsea-style Flappy Bird contribution graph (matches synapsea-landing 404 game).
 * Each GitHub contribution week = a gate; gap height reflects weekly activity.
 * Outputs dist/flappy-dark.svg and dist/flappy-light.svg.
 *
 * Env: GITHUB_TOKEN (required), GH_LOGIN (defaults to ShyDamn)
 */

const fs = require("fs");
const path = require("path");

const LOGIN = process.env.GH_LOGIN || "ShyDamn";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

// Canvas geometry — 16:10 feel, compact for profile README
const W = 1000;
const H = 320;
const GROUND_RATIO = 0.08;
const BIRD_X_RATIO = 0.22;
const BIRD_R_RATIO = 0.028;
const BIRD_R_MIN = 10;
const BIRD_R_MAX = 16;

// Physics — same tuning as NotFoundGame.tsx
const GRAVITY = 1450;
const FLAP_V = -430;
const MAX_FALL_V = 620;
const GATE_V = 195;
const GROUND_SCROLL = GATE_V;
const PIPE_WIDTH = 46;
const PIPE_CAP_HEIGHT = 16;
const PIPE_CAP_OVERHANG = 4;
const PIPE_SPACING = 102;
const FIRST_PIPE_AHEAD = 210;

const R = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const COLORS = {
  pipeBody: "#172543",
  pipeHi: "rgba(255, 255, 255, 0.08)",
  pipeStroke: "rgba(34, 211, 238, 0.25)",
  pipeCapAccent: "rgba(34, 211, 238, 0.55)",
  groundLine: ["rgba(139, 92, 246, 0)", "rgba(34, 211, 238, 0.8)", "rgba(139, 92, 246, 0)"],
  groundTop: "#0A0F1E",
  groundBottom: "#05060F",
  chevron: "rgba(34, 211, 238, 0.18)",
  birdGrad: ["#67E8F9", "#22D3EE", "#8B5CF6"],
  birdHalo: ["rgba(34, 211, 238, 0.45)", "rgba(34, 211, 238, 0)"],
  birdEye: "#05060F",
  birdEyeHi: "#F8FAFC",
  birdWing: "rgba(5, 6, 15, 0.35)",
  score: "#F8FAFC",
  scoreShadow: "rgba(5, 6, 15, 0.9)",
};

const THEMES = {
  dark: {
    sky: ["#050814", "#0A0F1E", "#0F1A38"],
    glowCyan: "rgba(34, 211, 238, 0.14)",
    glowViolet: "rgba(139, 92, 246, 0.12)",
    frameBorder: "rgba(34, 211, 238, 0.22)",
    frameBg: "#0A0F1E",
    caption: "rgba(248, 250, 252, 0.72)",
  },
  light: {
    sky: ["#E0F2FE", "#BAE6FD", "#7DD3FC"],
    glowCyan: "rgba(34, 211, 238, 0.22)",
    glowViolet: "rgba(139, 92, 246, 0.16)",
    frameBorder: "rgba(79, 70, 229, 0.28)",
    frameBg: "#F0F9FF",
    caption: "rgba(15, 23, 42, 0.65)",
  },
};

async function fetchWeeks() {
  const query = `query($login:String!){
    user(login:$login){
      contributionsCollection{
        contributionCalendar{
          totalContributions
          weeks{ contributionDays{ contributionCount } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "synapsea-flappy-contrib",
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) =>
    w.contributionDays.reduce((s, d) => s + d.contributionCount, 0)
  );
  return { weeks, total: cal.totalContributions };
}

function mulberry(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGates(weeks, playY) {
  const rnd = mulberry(1337);
  const max = Math.max(1, ...weeks);
  const easy = Math.min(120, playY * 0.42);
  const hard = Math.min(88, Math.max(72, playY * 0.26));
  const margin = Math.max(28, playY * 0.08);

  return weeks.map((count, i) => {
    const norm = Math.sqrt(count / max);
    const difficulty = norm * 0.85;
    const gapH = Math.max(72, lerp(easy, hard, difficulty));
    const span = Math.max(36, playY - gapH - margin * 2);
    let gapY = margin + (1 - norm) * span;
    gapY += (rnd() - 0.5) * span * 0.12;
    gapY = clamp(gapY, margin, playY - gapH - margin);
    return {
      x0: W * BIRD_X_RATIO + FIRST_PIPE_AHEAD + i * PIPE_SPACING,
      w: PIPE_WIDTH,
      gapY: R(gapY),
      gapH: R(gapH),
      seed: rnd(),
    };
  });
}

function simulate(gates, playY) {
  const birdX = W * BIRD_X_RATIO;
  const birdR = clamp(H * BIRD_R_RATIO, BIRD_R_MIN, BIRD_R_MAX);
  const worldShift = gates[gates.length - 1].x0 + 280;
  const duration = worldShift / GATE_V;

  let t = 0;
  const dt = 1 / 60;
  let py = playY * 0.4;
  let vy = FLAP_V * 0.6;
  let rot = 0;
  let groundOffset = 0;
  let bgOffset = 0;
  const raw = [{ t: 0, y: py, rot: 0, groundOffset: 0, bgOffset: 0 }];

  while (t < duration) {
    for (const g of gates) {
      const px = g.x0 - GATE_V * t;
      const gapCenter = g.gapY + g.gapH / 2;
      const ahead = px - birdX;
      if (ahead > 0 && ahead < 115 && py > gapCenter - 18) vy = FLAP_V;
    }

    vy = Math.min(vy + GRAVITY * dt, MAX_FALL_V);
    py += vy * dt;

    if (py - birdR < 0) {
      py = birdR;
      vy = Math.max(vy, 40);
    }
    if (py + birdR >= playY - 2) {
      py = playY - birdR - 2;
      vy = FLAP_V * 0.85;
    }

    const targetRot = clamp(vy / 400, -0.45, 1.4);
    rot += (targetRot - rot) * Math.min(1, dt * 10);

    t += dt;
    groundOffset = (groundOffset + GROUND_SCROLL * dt) % 32;
    bgOffset = (bgOffset + GROUND_SCROLL * 0.35 * dt) % 60;

    raw.push({ t, y: py, rot, groundOffset, bgOffset });
  }

  const maxKeys = 48;
  const step = Math.max(1, Math.floor(raw.length / maxKeys));
  const samples = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);

  const keyTimes = samples.map((s) => R(s.t / duration));
  for (let i = 1; i < keyTimes.length; i++) {
    if (keyTimes[i] <= keyTimes[i - 1]) keyTimes[i] = R(keyTimes[i - 1] + 0.001);
  }
  keyTimes[keyTimes.length - 1] = 1;

  return {
    birdX,
    birdR,
    worldShift: R(worldShift),
    duration: R(duration),
    samples,
    keyTimes: keyTimes.join(";"),
    birdYs: samples.map((s) => `${birdX} ${R(s.y)}`).join(";"),
    birdRots: samples.map((s) => R(s.rot * (180 / Math.PI))).join(";"),
    groundOffsets: samples.map((s) => R(-s.groundOffset)).join(";"),
    bgOffsets: samples.map((s) => R(-s.bgOffset)).join(";"),
  };
}

function starsSvg(playY, offsetValues, keyTimes, duration, themeKey) {
  const alphaScale = themeKey === "dark" ? 1 : 0.35;
  const parts = [];
  for (let i = 0; i < 40; i++) {
    const seed = i * 37.17;
    const baseX = (seed * 13) % W;
    const y = R(((seed * 7) % playY) * 0.95);
    const x = R(baseX);
    const size = R(1 + ((i * 11) % 3) * 0.4);
    const alpha = R((0.25 + ((i * 19) % 100) / 260) * alphaScale);
    parts.push(
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="rgba(248,250,252,${alpha})"/>`
    );
  }
  const translateValues = offsetValues
    .split(";")
    .map((ox) => `${ox} 0`)
    .join(";");
  return `<g><animateTransform attributeName="transform" type="translate" values="${translateValues}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite" calcMode="linear"/>${parts.join("")}</g>`;
}

function pipeBody(x, y, w, h) {
  if (h <= 0) return "";
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLORS.pipeBody}"/>`,
    `<rect x="${x + 3}" y="${y}" width="3" height="${h}" fill="${COLORS.pipeHi}"/>`,
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="${COLORS.pipeStroke}" stroke-width="1"/>`,
  ].join("");
}

function pipeCap(x, y, w, h, uid) {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLORS.pipeBody}"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="3" fill="url(#cap-${uid})"/>`,
    `<rect x="${x + 4}" y="${y + 3}" width="3" height="${Math.max(0, h - 5)}" fill="${COLORS.pipeHi}"/>`,
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="${COLORS.pipeCapAccent}" stroke-width="1"/>`,
  ].join("");
}

function gateSvg(g, playY, uid) {
  const capW = g.w + PIPE_CAP_OVERHANG * 2;
  const capX = g.x0 - PIPE_CAP_OVERHANG;
  const parts = [];

  if (g.gapY > 0) {
    const bodyBottom = g.gapY - PIPE_CAP_HEIGHT;
    if (bodyBottom > 0) parts.push(pipeBody(g.x0, 0, g.w, bodyBottom));
    parts.push(pipeCap(capX, Math.max(0, g.gapY - PIPE_CAP_HEIGHT), capW, PIPE_CAP_HEIGHT, uid));
  }

  const bottomTop = g.gapY + g.gapH;
  const bottomH = playY - bottomTop;
  if (bottomH > 0) {
    parts.push(pipeCap(capX, bottomTop, capW, PIPE_CAP_HEIGHT, uid));
    const bodyStart = bottomTop + PIPE_CAP_HEIGHT;
    if (playY - bodyStart > 0) parts.push(pipeBody(g.x0, bodyStart, g.w, playY - bodyStart));
  }

  return parts.join("");
}

function groundSvg(playY, groundOffsetValues, keyTimes, duration) {
  const chevrons = [];
  for (let x = -32; x < W + 64; x += 32) {
    chevrons.push(
      `<path d="M ${x} ${H - 8} L ${x + 16} ${H - 20} L ${x + 32} ${H - 8}" fill="none" stroke="${COLORS.chevron}" stroke-width="2"/>`
    );
  }

  return [
    `<defs>`,
    `<linearGradient id="ground-line" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="${COLORS.groundLine[0]}"/>`,
    `<stop offset="0.5" stop-color="${COLORS.groundLine[1]}"/>`,
    `<stop offset="1" stop-color="${COLORS.groundLine[2]}"/>`,
    `</linearGradient>`,
    `<linearGradient id="ground-fill" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${COLORS.groundTop}"/>`,
    `<stop offset="1" stop-color="${COLORS.groundBottom}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="0" y="${playY}" width="${W}" height="2" fill="url(#ground-line)"/>`,
    `<rect x="0" y="${playY + 2}" width="${W}" height="${H - playY - 2}" fill="url(#ground-fill)"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" values="${groundOffsetValues.split(";").map((v) => `${v} 0`).join(";")}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite" calcMode="linear"/>`,
    chevrons.join(""),
    `</g>`,
  ].join("");
}

function birdSvg(birdR, uid) {
  const r = birdR;
  return [
    `<circle cx="0" cy="0" r="${R(r * 3)}" fill="url(#halo-${uid})"/>`,
    `<circle cx="0" cy="0" r="${r}" fill="url(#bird-${uid})" filter="url(#glow-${uid})"/>`,
    `<circle cx="0" cy="0" r="${R(r + 2)}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5">`,
    `<animate attributeName="r" values="${R(r + 1)};${R(r + 3)};${R(r + 1)}" dur="2s" repeatCount="indefinite"/>`,
    `</circle>`,
    `<ellipse cx="${R(-r * 0.25)}" cy="${R(r * 0.1)}" rx="${R(r * 0.5)}" ry="${R(r * 0.3)}" fill="${COLORS.birdWing}">`,
    `<animate attributeName="ry" values="${R(r * 0.3)};${R(r * 0.18)};${R(r * 0.3)}" dur="0.55s" repeatCount="indefinite"/>`,
    `</ellipse>`,
    `<circle cx="${R(r * 0.35)}" cy="${R(-r * 0.25)}" r="${R(r * 0.2)}" fill="${COLORS.birdEye}"/>`,
    `<circle cx="${R(r * 0.42)}" cy="${R(-r * 0.32)}" r="${R(r * 0.07)}" fill="${COLORS.birdEyeHi}"/>`,
  ].join("");
}

function scoreSvg(gates, sim, birdX) {
  const parts = [];
  for (let i = 0; i < gates.length; i++) {
    const passT = (gates[i].x0 - birdX) / GATE_V;
    const begin = clamp(passT / sim.duration, 0.001, 0.999);
    const end =
      i + 1 < gates.length
        ? clamp((gates[i + 1].x0 - birdX) / GATE_V / sim.duration, begin + 0.001, 0.9995)
        : 1;
    parts.push(
      `<text x="${W / 2}" y="34" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="28" font-weight="700" fill="${COLORS.score}" opacity="0">${i + 1}` +
        `<animate attributeName="opacity" values="0;1;0" keyTimes="0;${R(begin)};${R(end)}" calcMode="discrete" dur="${sim.duration}s" repeatCount="indefinite"/></text>`
    );
  }
  return parts.join("");
}

function render(themeKey, gates, sim, total) {
  const theme = THEMES[themeKey];
  const uid = themeKey;
  const groundH = Math.max(26, Math.round(H * GROUND_RATIO));
  const playY = H - groundH;
  const { duration, keyTimes, worldShift } = sim;

  const bgOffsetValues = sim.samples.map((s) => R(-s.bgOffset)).join(";");
  const groundOffsetValues = sim.samples.map((s) => R(-s.groundOffset)).join(";");

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<defs>`,
    `<linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${theme.sky[0]}"/>`,
    `<stop offset="0.55" stop-color="${theme.sky[1]}"/>`,
    `<stop offset="1" stop-color="${theme.sky[2]}"/>`,
    `</linearGradient>`,
    `<radialGradient id="glow-c-${uid}" cx="25%" cy="25%" r="70%">`,
    `<stop offset="0" stop-color="${theme.glowCyan}"/><stop offset="1" stop-color="rgba(34,211,238,0)"/>`,
    `</radialGradient>`,
    `<radialGradient id="glow-v-${uid}" cx="80%" cy="70%" r="65%">`,
    `<stop offset="0" stop-color="${theme.glowViolet}"/><stop offset="1" stop-color="rgba(139,92,246,0)"/>`,
    `</radialGradient>`,
    `<linearGradient id="cap-${uid}" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="rgba(139,92,246,0.5)"/>`,
    `<stop offset="0.5" stop-color="rgba(34,211,238,0.7)"/>`,
    `<stop offset="1" stop-color="rgba(139,92,246,0.5)"/>`,
    `</linearGradient>`,
    `<linearGradient id="bird-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="${COLORS.birdGrad[0]}"/>`,
    `<stop offset="50%" stop-color="${COLORS.birdGrad[1]}"/>`,
    `<stop offset="100%" stop-color="${COLORS.birdGrad[2]}"/>`,
    `</linearGradient>`,
    `<radialGradient id="halo-${uid}" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0%" stop-color="${COLORS.birdHalo[0]}"/>`,
    `<stop offset="100%" stop-color="${COLORS.birdHalo[1]}"/>`,
    `</radialGradient>`,
    `<filter id="glow-${uid}" x="-80%" y="-80%" width="260%" height="260%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="rgba(34,211,238,0.4)"/>`,
    `</filter>`,
    `<clipPath id="frame-${uid}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18"/></clipPath>`,
    `</defs>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="${theme.frameBg}" stroke="${theme.frameBorder}" stroke-width="1"/>`,
    `<g clip-path="url(#frame-${uid})">`,
    `<rect width="${W}" height="${H}" fill="url(#sky-${uid})"/>`,
    starsSvg(playY, bgOffsetValues, keyTimes, duration, themeKey),
    `<rect width="${W}" height="${playY}" fill="url(#glow-c-${uid})"/>`,
    `<rect width="${W}" height="${playY}" fill="url(#glow-v-${uid})"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-${worldShift} 0" dur="${duration}s" repeatCount="indefinite"/>`,
    gates.map((g) => gateSvg(g, playY, uid)).join(""),
    `</g>`,
    groundSvg(playY, groundOffsetValues, keyTimes, duration),
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" values="${sim.birdYs}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite" calcMode="linear"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="rotate" values="${sim.birdRots}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite" calcMode="linear"/>`,
    birdSvg(sim.birdR, uid),
    `</g></g>`,
    scoreSvg(gates, sim, sim.birdX),
    `<text x="${W - 16}" y="${H - 10}" text-anchor="end" font-family="ui-monospace,monospace" font-size="10" letter-spacing="0.08em" fill="${theme.caption}">@${LOGIN} · ${total} contributions</text>`,
    `</g></svg>`,
  ];

  return parts.join("\n");
}

(async () => {
  const { weeks, total } = await fetchWeeks();
  const groundH = Math.max(26, Math.round(H * GROUND_RATIO));
  const playY = H - groundH;
  const gates = buildGates(weeks, playY);
  const sim = simulate(gates, playY);

  const dist = path.join(process.cwd(), "dist");
  fs.mkdirSync(dist, { recursive: true });

  for (const theme of ["dark", "light"]) {
    const svg = render(theme, gates, sim, total);
    fs.writeFileSync(path.join(dist, `flappy-${theme}.svg`), svg);
    console.log(`dist/flappy-${theme}.svg (${(svg.length / 1024).toFixed(1)} KB, ${sim.duration}s loop)`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
