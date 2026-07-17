#!/usr/bin/env node
/**
 * Flappy Bird contribution graph generator.
 * Each week of GitHub contributions = a pipe pair; gap height reflects activity.
 * Outputs dist/flappy-light.svg and dist/flappy-dark.svg.
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

const W = 1000;
const H = 320;
const GROUND_Y = 276;
const SKY_TOP = 20;
const PIPE_W = 52;
const PIPE_SPACING = 108;
const FIRST_PIPE_X = 420;
const BIRD_X = 165;
const GAP_HALF = 48;
const SPEED = 145;
const R = (n) => Math.round(n * 100) / 100;

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
      "User-Agent": "flappy-contrib-graph",
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

function buildScene(weeks) {
  const rnd = mulberry(1337);
  const max = Math.max(1, ...weeks);
  const minGapY = SKY_TOP + GAP_HALF + 22;
  const maxGapY = GROUND_Y - GAP_HALF - 22;

  const pipes = weeks.map((count, i) => {
    const norm = Math.sqrt(count / max);
    let gapY = maxGapY - norm * (maxGapY - minGapY);
    gapY += (rnd() - 0.5) * 28;
    gapY = Math.min(maxGapY, Math.max(minGapY, gapY));
    return { x: FIRST_PIPE_X + i * PIPE_SPACING, gapY: R(gapY), count };
  });

  const worldShift = pipes[pipes.length - 1].x + 280;
  const T = R(worldShift / SPEED);
  return { pipes, worldShift, T };
}

function birdKeyframes(pipes, T) {
  const pts = [{ t: 0, y: 158, rot: -8 }];
  let prevY = 158;
  let prevT = 0;

  for (const p of pipes) {
    const t = (p.x - BIRD_X) / SPEED;
    if (t <= prevT + 0.04) continue;
    const midT = (prevT + t) / 2;
    const hopY = Math.max(SKY_TOP + 18, Math.min(prevY, p.gapY) - 38);
    pts.push({ t: midT, y: hopY, rot: -28 });
    pts.push({ t, y: p.gapY, rot: 18 });
    prevY = p.gapY;
    prevT = t;
  }
  pts.push({ t: T, y: prevY, rot: 4 });

  const keyTimes = pts.map((p) => R(Math.min(1, p.t / T)));
  for (let i = 1; i < keyTimes.length; i++) {
    if (keyTimes[i] <= keyTimes[i - 1]) keyTimes[i] = R(keyTimes[i - 1] + 0.0005);
  }
  keyTimes[keyTimes.length - 1] = 1;

  return {
    keyTimes: keyTimes.join(";"),
    ys: pts.map((p) => `${BIRD_X} ${R(p.y)}`).join(";"),
    rots: pts.map((p) => p.rot).join(";"),
  };
}

const THEMES = {
  light: {
    sky: "#4EC0CA",
    skyBottom: "#71D4DE",
    pipe: "#73BF2E",
    pipeDark: "#558C22",
    pipeLight: "#A8E063",
    pipeRim: "#558C22",
    ground: "#DED895",
    groundStripe: "#C9B458",
    grass: "#8BC34A",
    bird: "#F8D030",
    birdDark: "#C9A000",
    wing: "#F0E8A0",
    beak: "#F07020",
    cloud: "#FFFFFF",
    building: "#6BB6C0",
    buildingDark: "#4FA4B0",
    text: "#FFFFFF",
    textStroke: "#558C22",
    stars: false,
  },
  dark: {
    sky: "#0F1226",
    skyBottom: "#1B1E3E",
    pipe: "#4F46E5",
    pipeDark: "#3730A3",
    pipeLight: "#8B5CF6",
    pipeRim: "#312E81",
    ground: "#161936",
    groundStripe: "#2A2D55",
    grass: "#4F46E5",
    bird: "#F8D030",
    birdDark: "#C9A000",
    wing: "#F0E8A0",
    beak: "#F07020",
    cloud: "#2A2D55",
    building: "#252849",
    buildingDark: "#1A1D38",
    text: "#E5E7EB",
    textStroke: "#3730A3",
    stars: true,
  },
};

function pipeSvg(p, c) {
  const topH = R(p.gapY - GAP_HALF);
  const botY = R(p.gapY + GAP_HALF);
  const lip = 14;
  const lipOver = 5;
  const bodyW = PIPE_W;
  const x = p.x;

  return [
    `<g>`,
    `<rect x="${x}" y="0" width="${bodyW}" height="${topH - lip}" fill="${c.pipe}" stroke="${c.pipeDark}" stroke-width="2"/>`,
    `<rect x="${x + 6}" y="0" width="10" height="${topH - lip}" fill="${c.pipeLight}" opacity="0.55"/>`,
    `<rect x="${x - lipOver}" y="${topH - lip}" width="${bodyW + lipOver * 2}" height="${lip}" rx="2" fill="${c.pipe}" stroke="${c.pipeRim}" stroke-width="2"/>`,
    `<rect x="${x - lipOver + 4}" y="${topH - lip + 3}" width="${bodyW + lipOver * 2 - 8}" height="4" fill="${c.pipeLight}" opacity="0.45"/>`,
    `<rect x="${x - lipOver}" y="${botY}" width="${bodyW + lipOver * 2}" height="${lip}" rx="2" fill="${c.pipe}" stroke="${c.pipeRim}" stroke-width="2"/>`,
    `<rect x="${x - lipOver + 4}" y="${botY + 3}" width="${bodyW + lipOver * 2 - 8}" height="4" fill="${c.pipeLight}" opacity="0.45"/>`,
    `<rect x="${x}" y="${botY + lip}" width="${bodyW}" height="${R(GROUND_Y - botY - lip)}" fill="${c.pipe}" stroke="${c.pipeDark}" stroke-width="2"/>`,
    `<rect x="${x + 6}" y="${botY + lip}" width="10" height="${R(GROUND_Y - botY - lip)}" fill="${c.pipeLight}" opacity="0.55"/>`,
    `</g>`,
  ].join("\n");
}

function skylineSvg(c, worldShift) {
  const rnd = mulberry(9001);
  const buildings = [];
  let x = -40;
  while (x < worldShift + W + 80) {
    const bw = 28 + Math.floor(rnd() * 36);
    const bh = 28 + Math.floor(rnd() * 72);
    buildings.push({ x, w: bw, h: bh, windows: rnd() > 0.35 });
    x += bw + 6 + Math.floor(rnd() * 14);
  }

  const parts = [`<g opacity="0.55">`];
  for (const b of buildings) {
    parts.push(
      `<rect x="${b.x}" y="${GROUND_Y - b.h}" width="${b.w}" height="${b.h}" fill="${c.building}" stroke="${c.buildingDark}" stroke-width="1"/>`
    );
    if (b.windows) {
      for (let wy = GROUND_Y - b.h + 10; wy < GROUND_Y - 12; wy += 14) {
        for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 10) {
          if (rnd() > 0.25) {
            parts.push(
              `<rect x="${wx}" y="${wy}" width="5" height="7" fill="${c.buildingDark}" opacity="0.7"/>`
            );
          }
        }
      }
    }
  }
  parts.push(`</g>`);
  return parts.join("\n");
}

function birdSvg(c) {
  return [
    `<g>`,
    `<rect x="-14" y="-12" width="26" height="24" rx="6" fill="${c.bird}" stroke="${c.birdDark}" stroke-width="2"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="rotate" values="-30 -6 2;22 -6 2;-30 -6 2" dur="0.26s" repeatCount="indefinite"/>`,
    `<ellipse cx="-6" cy="3" rx="8" ry="5" fill="${c.wing}" stroke="${c.birdDark}" stroke-width="1.5"/>`,
    `</g>`,
    `<circle cx="6" cy="-5" r="5" fill="#FFFFFF" stroke="${c.birdDark}" stroke-width="1.5"/>`,
    `<circle cx="7.5" cy="-5" r="2.2" fill="#1F2937"/>`,
    `<path d="M 11 2 L 22 4 L 11 9 Z" fill="${c.beak}" stroke="${c.birdDark}" stroke-width="1"/>`,
    `</g>`,
  ].join("\n");
}

function render(theme, scene, total) {
  const c = THEMES[theme];
  const { pipes, worldShift, T } = scene;
  const bird = birdKeyframes(pipes, T);
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<defs>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${c.sky}"/><stop offset="1" stop-color="${c.skyBottom}"/>`,
    `</linearGradient>`,
    `<clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}" rx="10"/></clipPath>`,
    `</defs>`,
    `<g clip-path="url(#frame)">`,
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>`
  );

  if (c.stars) {
    parts.push(
      `<circle cx="860" cy="48" r="22" fill="#FDE68A" opacity="0.9"/>`,
      `<circle cx="848" cy="48" r="18" fill="${c.sky}" opacity="0.35"/>`
    );
    const rnd = mulberry(42);
    for (let i = 0; i < 45; i++) {
      const x = R(rnd() * W);
      const y = R(rnd() * (GROUND_Y - 70));
      const r = R(0.5 + rnd() * 1.4);
      const dur = R(1.4 + rnd() * 2.8);
      parts.push(
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#E5E7EB" opacity="0.75">` +
          `<animate attributeName="opacity" values="0.1;0.85;0.1" dur="${dur}s" repeatCount="indefinite"/></circle>`
      );
    }
  } else {
    const clouds = [
      [90, 55, 1],
      [360, 38, 0.85],
      [620, 68, 1],
      [880, 44, 0.9],
    ];
    for (const [x, y, s] of clouds) {
      parts.push(
        `<g fill="${c.cloud}" opacity="${s}">` +
          `<ellipse cx="${x}" cy="${y}" rx="44" ry="15"/>` +
          `<ellipse cx="${x + 28}" cy="${y - 9}" rx="28" ry="14"/>` +
          `<ellipse cx="${x - 28}" cy="${y - 7}" rx="24" ry="12"/></g>`
      );
    }
  }

  const skylineShift = R(worldShift * 0.35);
  parts.push(
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-${skylineShift} 0" dur="${T}s" repeatCount="indefinite"/>`,
    skylineSvg(c, skylineShift + W)
  );
  parts.push(`</g>`);

  parts.push(
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-${worldShift} 0" dur="${T}s" repeatCount="indefinite"/>`
  );
  for (const p of pipes) parts.push(pipeSvg(p, c));
  parts.push(`</g>`);

  parts.push(
    `<rect x="0" y="${GROUND_Y}" width="${W}" height="${H - GROUND_Y}" fill="${c.ground}"/>`,
    `<rect x="0" y="${GROUND_Y}" width="${W}" height="7" fill="${c.grass}"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-28 0" dur="${R(28 / SPEED)}s" repeatCount="indefinite"/>`
  );
  for (let x = -28; x < W + 56; x += 28) {
    parts.push(
      `<rect x="${x}" y="${GROUND_Y + 11}" width="14" height="9" fill="${c.groundStripe}" transform="skewX(-32)" transform-origin="${x} ${GROUND_Y + 11}"/>`
    );
  }
  parts.push(`</g>`);

  parts.push(
    `<g>`,
    `<animateTransform attributeName="transform" type="translate" values="${bird.ys}" keyTimes="${bird.keyTimes}" dur="${T}s" repeatCount="indefinite" calcMode="linear"/>`,
    `<g>`,
    `<animateTransform attributeName="transform" type="rotate" values="${bird.rots}" keyTimes="${bird.keyTimes}" dur="${T}s" repeatCount="indefinite" calcMode="linear"/>`,
    birdSvg(c),
    `</g></g>`
  );

  const scoreTimes = pipes.map((p) => R(((p.x - BIRD_X) / SPEED) / T));
  for (let i = 0; i < scoreTimes.length; i++) {
    const begin = Math.min(0.999, Math.max(0.001, scoreTimes[i]));
    const end = i + 1 < scoreTimes.length ? Math.min(0.9995, scoreTimes[i + 1]) : 1;
    if (end <= begin) continue;
    parts.push(
      `<text x="${W / 2}" y="58" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="42" font-weight="900" fill="${c.text}" stroke="${c.textStroke}" stroke-width="2" paint-order="stroke" opacity="0">${i + 1}` +
        `<animate attributeName="opacity" values="0;1;0" keyTimes="0;${begin};${end}" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/></text>`
    );
  }

  parts.push(
    `<text x="${W - 14}" y="${H - 12}" text-anchor="end" font-family="Verdana,Geneva,sans-serif" font-size="11" fill="${c.text}" opacity="0.8">@${LOGIN} · ${total} contributions</text>`,
    `</g></svg>`
  );
  return parts.join("\n");
}

(async () => {
  const { weeks, total } = await fetchWeeks();
  const scene = buildScene(weeks);
  const dist = path.join(process.cwd(), "dist");
  fs.mkdirSync(dist, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const svg = render(theme, scene, total);
    fs.writeFileSync(path.join(dist, `flappy-${theme}.svg`), svg);
    console.log(`dist/flappy-${theme}.svg (${(svg.length / 1024).toFixed(1)} KB)`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
