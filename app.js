"use strict";
/* Painel de apuração – 2º turno Presidente 2026. Sem build; Plotly via CDN. */

const QS = new URLSearchParams(location.search);
const TESTE = QS.get("fonte") === "teste";
// Em <owner>.github.io/<repo>/ descobre owner/repo sozinho; senão usa o padrão abaixo.
const OWNER_PADRAO = "olcinomartins", REPO_PADRAO = "apuracao-2026";
const OWNER = location.hostname.endsWith("github.io") ? location.hostname.split(".")[0] : OWNER_PADRAO;
const REPO = location.hostname.endsWith("github.io") ? (location.pathname.split("/")[1] || REPO_PADRAO) : REPO_PADRAO;
const BASE = QS.get("dados") || (TESTE ? "./data-test/" : `https://raw.githubusercontent.com/${OWNER}/${REPO}/data/`);
const REFRESH_MS = 60000;

const REGIOES = {
  N: ["ac", "am", "ap", "pa", "ro", "rr", "to"],
  NE: ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"],
  CO: ["df", "go", "ms", "mt"],
  SE: ["es", "mg", "rj", "sp"],
  S: ["pr", "rs", "sc"],
};
const NOME_REG = { N: "Norte", NE: "Nordeste", CO: "Centro-Oeste", SE: "Sudeste", S: "Sul" };
const NOME_UF = {
  ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará", df: "Distrito Federal",
  es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mg: "Minas Gerais", ms: "Mato Grosso do Sul",
  mt: "Mato Grosso", pa: "Pará", pb: "Paraíba", pe: "Pernambuco", pi: "Piauí", pr: "Paraná",
  rj: "Rio de Janeiro", rn: "Rio Grande do Norte", ro: "Rondônia", rr: "Roraima", rs: "Rio Grande do Sul",
  sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins", zz: "Exterior",
};
const UF_REG = {};
for (const [r, ufs] of Object.entries(REGIOES)) ufs.forEach((u) => (UF_REG[u] = r));
const UFS = Object.keys(NOME_UF).sort((a, b) => NOME_UF[a].localeCompare(NOME_UF[b], "pt-BR"));
const CAND = [
  { k: "flavio", nome: "Flávio Bolsonaro", curto: "Flávio", cor: "--flavio" },
  { k: "lula", nome: "Lula", curto: "Lula", cor: "--lula" },
];

const S = {
  latest: null, meta: null, municipios: {}, base: null,
  series: {}, sel: { nivel: "br", regiao: "SE", uf: "sp", mun: null },
  ordem: "pct", munSort: { col: "pct", dir: -1 },
};

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtInt = (x) => (x == null || isNaN(x) ? "–" : nf0.format(Math.round(x)));
const fmtPct = (x, d = 2) => (x == null || isNaN(x) ? "–" : x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%");
const fmtPP = (x, d = 2) => (x == null || isNaN(x) ? "–" : (x > 0 ? "+" : "") + x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + " p.p.");
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtHora = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso.length <= 19 ? iso + "-03:00" : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

async function getJSON(path) {
  try {
    const r = await fetch(`${BASE}${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn("falha ao ler", path, e);
    return null;
  }
}

const dois = (p) => (p ? p.votos.flavio + p.votos.lula : 0);
const shareF = (p) => (dois(p) ? (100 * p.votos.flavio) / dois(p) : null);
const shareL = (p) => (dois(p) ? (100 * p.votos.lula) / dois(p) : null);
const nomeMun = (uf, cd) => (S.municipios[uf] && S.municipios[uf][cd]) || cd;

function somaPontos(pts) {
  pts = pts.filter(Boolean);
  if (!pts.length) return null;
  const st = pts.reduce((a, p) => a + p.s[0], 0), tot = pts.reduce((a, p) => a + p.s[1], 0);
  const out = { pct_apurado: tot ? (100 * st) / tot : 0, s: [st, tot], votos: { flavio: 0, lula: 0 } };
  for (const k of ["validos", "brancos", "nulos", "abst", "eleitorado", "comparecimento"]) out[k] = 0;
  for (const p of pts) {
    out.votos.flavio += p.votos.flavio; out.votos.lula += p.votos.lula;
    for (const k of ["validos", "brancos", "nulos", "abst", "eleitorado", "comparecimento"]) out[k] += p[k];
  }
  return out;
}

/* ---------- local selecionado ---------- */
function ufsDoLocal(sel = S.sel) {
  if (sel.nivel === "br") return UFS;
  if (sel.nivel === "regiao") return REGIOES[sel.regiao];
  return [sel.uf];
}
function pontoAtual(sel = S.sel) {
  const L = S.latest;
  if (!L) return null;
  if (sel.nivel === "br") return L.br;
  if (sel.nivel === "regiao") return L.regiao[sel.regiao];
  if (sel.nivel === "uf") return L.uf[sel.uf];
  return (L.mun[sel.uf] || {})[sel.mun] || null;
}
function nomeLocal(sel = S.sel) {
  if (sel.nivel === "br") return "Brasil";
  if (sel.nivel === "regiao") return `Região ${NOME_REG[sel.regiao]}`;
  if (sel.nivel === "uf") return NOME_UF[sel.uf];
  return `${nomeMun(sel.uf, sel.mun)} (${sel.uf.toUpperCase()})`;
}
function seriePath(sel = S.sel) {
  if (sel.nivel === "br") return "series/br.json";
  if (sel.nivel === "regiao") return `series/regiao/${sel.regiao}.json`;
  return sel.nivel === "uf" ? `series/uf/${sel.uf}.json` : `series/mun/${sel.uf}.json`;
}
async function carregaSerie(sel = S.sel) {
  const path = seriePath(sel);
  const d = await getJSON(path);
  if (d) S.series[path] = d;
  const s = S.series[path];
  if (!s) return [];
  return sel.nivel === "mun" ? s[sel.mun] || [] : s;
}

/* ---------- projeção ponderada (bottom-up por município) ---------- */
function projecaoMunicipios(ufs) {
  // Retorna {flavio, lula, faltam, porUF:{uf:{faltam, flavio, lula}}, porMun:{uf:{cd:{...}}}}
  if (!S.latest || !S.base) return null;
  const b = S.base.mun;
  const swingUF = {};
  let swN = 0, swD = 0;
  for (const uf of UFS) {
    let n = 0, d = 0;
    const cur = S.latest.mun[uf] || {};
    for (const [cd, p] of Object.entries(cur)) {
      const b1 = (b[uf] || {})[cd];
      if (!b1 || p.pct_apurado < 5 || !dois(p) || b1[2] + b1[3] === 0) continue;
      const diff = p.votos.flavio / dois(p) - b1[2] / (b1[2] + b1[3]);
      n += diff * dois(p); d += dois(p);
    }
    swingUF[uf] = d ? n / d : null;
    swN += n; swD += d;
  }
  const swingBR = swD ? swN / swD : 0;
  const tot = { flavio: 0, lula: 0, faltam: 0, porUF: {}, porMun: {} };
  for (const uf of ufs) {
    const cur = S.latest.mun[uf] || {}, base = b[uf] || {};
    const sw = swingUF[uf] ?? swingBR;
    const u = { flavio: 0, lula: 0, faltam: 0 };
    tot.porMun[uf] = {};
    const cds = new Set([...Object.keys(cur), ...Object.keys(base)]);
    for (const cd of cds) {
      const p = cur[cd], b1 = base[cd];
      const pct = p ? p.pct_apurado : 0;
      const te = (p && p.eleitorado) || (b1 ? b1[0] : 0);
      let turnout;
      if (p && pct > 30 && p.eleitorado) turnout = p.comparecimento / (p.eleitorado * pct / 100);
      else if (b1 && b1[0]) turnout = b1[1] / b1[0];
      else turnout = 0.78;
      turnout = Math.min(1, Math.max(0, turnout));
      const comp = p ? p.comparecimento : 0;
      const faltaComp = pct >= 100 ? 0 : Math.max(0, te * turnout - comp);
      let ratio, sF;
      if (p && pct >= 5 && comp && dois(p)) {
        ratio = dois(p) / comp;
        sF = p.votos.flavio / dois(p);
      } else if (b1 && b1[1] && b1[2] + b1[3]) {
        ratio = b1[4] / b1[1];
        sF = Math.min(1, Math.max(0, b1[2] / (b1[2] + b1[3]) + sw));
      } else {
        ratio = 0.95;
        sF = p && dois(p) ? p.votos.flavio / dois(p) : 0.5;
      }
      const falta = faltaComp * ratio;
      const m = {
        faltam: falta,
        flavio: (p ? p.votos.flavio : 0) + falta * sF,
        lula: (p ? p.votos.lula : 0) + falta * (1 - sF),
      };
      tot.porMun[uf][cd] = m;
      u.faltam += m.faltam; u.flavio += m.flavio; u.lula += m.lula;
    }
    tot.porUF[uf] = u;
    tot.faltam += u.faltam; tot.flavio += u.flavio; tot.lula += u.lula;
  }
  return tot;
}
function projecaoLocal(sel = S.sel) {
  const pr = projecaoMunicipios(ufsDoLocal(sel));
  if (!pr) return null;
  if (sel.nivel === "mun") return pr.porMun[sel.uf][sel.mun] || null;
  return pr;
}

/* ---------- projeção linear ---------- */
function projecaoLinear(serie, n) {
  const pts = serie.filter((p) => p.pct_apurado > 0 && dois(p) > 0).slice(-n);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.pct_apurado), ys = pts.map((p) => shareF(p) - shareL(p));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxx = 0, sxy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const x0 = xs[xs.length - 1];
  const margem100 = Math.max(-100, Math.min(100, a + b * 100));
  const margemX0 = a + b * x0;
  return { x0, margemX0, margem100, flavio: 50 + margem100 / 2, lula: 50 - margem100 / 2 };
}

/* ---------- render ---------- */
function plotLayout(extra = {}) {
  const ink = cssVar("--ink-2"), grid = cssVar("--grid");
  return Object.assign({
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 12, color: ink },
    margin: { l: 48, r: 14, t: 10, b: 40 },
    separators: ",.",
    hoverlabel: { bgcolor: cssVar("--surface"), bordercolor: cssVar("--line"), font: { color: cssVar("--ink") } },
    xaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    yaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    legend: { orientation: "h", y: 1.08, x: 0 },
  }, extra);
}
const PLOT_CFG = { displayModeBar: false, responsive: true, locale: "pt-BR" };

function renderCards(p, proj) {
  const el = $("cards");
  if (!p) { el.innerHTML = `<div class="card destaque"><div class="rot">Sem dados ainda para este local.</div></div>`; return; }
  const sf = shareF(p), sl = shareL(p);
  const dif = p.votos.flavio - p.votos.lula;
  const restantes = proj ? proj.faltam : null;
  const definido = restantes != null && Math.abs(dif) > restantes && dois(p) > 0;
  const lider = dif > 0 ? CAND[0] : CAND[1];
  let h = `<div class="card destaque"><div class="rot">% de seções apuradas</div>
    <div class="val">${fmtPct(p.pct_apurado)}</div>
    <div class="sub">${fmtInt(p.s[0])} de ${fmtInt(p.s[1])} seções</div></div>`;
  for (const c of CAND) {
    const pct = c.k === "flavio" ? sf : sl;
    h += `<div class="card cand" style="--c:var(${c.cor})"><div class="rot"><span class="sw"></span>${c.nome}</div>
      <div class="val">${fmtPct(pct)}</div><div class="sub">${fmtInt(p.votos[c.k])} votos</div></div>`;
  }
  h += `<div class="card"><div class="rot">Diferença</div>
    <div class="val">${dois(p) ? fmtInt(Math.abs(dif)) : "–"}</div>
    <div class="sub">${dois(p) ? `${lider.curto} à frente · ${fmtPP(Math.abs(sf - sl))}` : "aguardando votos"}</div>
    ${definido ? `<span class="selo">✓ matematicamente definido</span>` : ""}</div>`;
  h += `<div class="card"><div class="rot">Votos válidos restantes (estim.)</div>
    <div class="val">${restantes == null ? "–" : fmtInt(restantes)}</div>
    <div class="sub">${restantes == null ? "carregando base do 1º turno…" : "eleitorado × comparecimento esperado − apurados"}</div></div>`;
  el.innerHTML = h;
}

function renderEvolucao(serie, p) {
  const pts = serie.filter((q) => q.pct_apurado > 0 && dois(q) > 0);
  const n = Math.max(3, Math.min(50, parseInt($("n-pontos").value, 10) || 10));
  const lin = projecaoLinear(serie, n);
  const cF = cssVar("--flavio"), cL = cssVar("--lula");
  const x = pts.map((q) => q.pct_apurado);
  const hov = (c) => pts.map((q) => `${fmtHora(q.tse || q.ts)}<br>${c.curto}: ${fmtPct(c.k === "flavio" ? shareF(q) : shareL(q))}<br>apurado ${fmtPct(q.pct_apurado)}`);
  const traces = [
    { x, y: pts.map(shareF), name: "Flávio", mode: pts.length < 30 ? "lines+markers" : "lines", line: { color: cF, width: 2 }, marker: { size: 8 }, text: hov(CAND[0]), hoverinfo: "text" },
    { x, y: pts.map(shareL), name: "Lula", mode: pts.length < 30 ? "lines+markers" : "lines", line: { color: cL, width: 2 }, marker: { size: 8 }, text: hov(CAND[1]), hoverinfo: "text" },
  ];
  if (lin && lin.x0 < 100) {
    traces.push(
      { x: [lin.x0, 100], y: [50 + lin.margemX0 / 2, lin.flavio], name: "Flávio (proj. linear)", mode: "lines", line: { color: cF, width: 2, dash: "dash" }, hovertemplate: "Proj. linear Flávio: %{y:.2f}%<extra></extra>", showlegend: false },
      { x: [lin.x0, 100], y: [50 - lin.margemX0 / 2, lin.lula], name: "Lula (proj. linear)", mode: "lines", line: { color: cL, width: 2, dash: "dash" }, hovertemplate: "Proj. linear Lula: %{y:.2f}%<extra></extra>", showlegend: false },
    );
  }
  // virada: troca de sinal da margem
  const shapes = [], annotations = [];
  let virada = null;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.sign(pts[i - 1].votos.flavio - pts[i - 1].votos.lula), b = Math.sign(pts[i].votos.flavio - pts[i].votos.lula);
    if (a && b && a !== b) virada = { i, x: pts[i].pct_apurado, quem: b > 0 ? "Flávio" : "Lula", ts: pts[i].tse || pts[i].ts };
  }
  if (virada) {
    shapes.push({ type: "line", x0: virada.x, x1: virada.x, yref: "paper", y0: 0, y1: 1, line: { color: cssVar("--muted"), width: 1, dash: "dot" } });
    annotations.push({ x: virada.x, yref: "paper", y: 1, text: `virada (${virada.quem})`, showarrow: false, yanchor: "bottom", font: { size: 11, color: cssVar("--ink-2") } });
  }
  $("virada").textContent = virada
    ? `Virada: ${virada.quem} passou à frente com ${fmtPct(virada.x)} apurado (${fmtHora(virada.ts)}).`
    : pts.length ? "Sem virada até agora." : "Aguardando os primeiros votos.";
  const ys = pts.flatMap((q) => [shareF(q), shareL(q)]).concat(lin ? [lin.flavio, lin.lula] : []);
  const lo = ys.length ? Math.max(0, Math.floor(Math.min(...ys) - 2)) : 30, hi = ys.length ? Math.min(100, Math.ceil(Math.max(...ys) + 2)) : 70;
  Plotly.react("g-evolucao", traces, plotLayout({
    xaxis: { title: "% apurado", range: [0, 100], ticksuffix: "%", gridcolor: cssVar("--grid"), zeroline: false },
    yaxis: { title: "% dos válidos", range: [lo, hi], ticksuffix: "%", gridcolor: cssVar("--grid"), zeroline: false },
    shapes: shapes.concat([{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 50, y1: 50, line: { color: cssVar("--line"), width: 1 } }]),
    annotations, hovermode: "closest",
  }), PLOT_CFG);
  return lin;
}

function renderFoto(p) {
  if (!p) { $("foto").innerHTML = ""; $("foto-hora").textContent = ""; return; }
  $("foto").innerHTML = CAND.map((c) => {
    const pct = (c.k === "flavio" ? shareF(p) : shareL(p)) || 0;
    return `<div class="barra-linha" style="--c:var(${c.cor})"><span class="barra-nome">${c.curto}</span>
      <div class="barra-trilho" role="img" aria-label="${c.nome} ${fmtPct(pct)}">
      <div class="barra-fill" style="width:${pct.toFixed(2)}%"></div>
      <span class="barra-txt">${fmtPct(pct)} · ${fmtInt(p.votos[c.k])}</span></div></div>`;
  }).join("");
  $("foto-hora").textContent = `Última totalização do TSE para este local: ${fmtHora(p.tse)}`;
}

function renderProjecao(p, lin, proj) {
  const card = (titulo, f, l, nota) => {
    const tot = f + l;
    const pf = tot ? (100 * f) / tot : null, pl = tot ? (100 * l) / tot : null;
    return `<div class="card"><div class="rot">${titulo}</div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--flavio)"></span> Flávio</span><b>${fmtPct(pf)}</b></div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--lula)"></span> Lula</span><b>${fmtPct(pl)}</b></div>
      <div class="sub">${nota}</div></div>`;
  };
  let h = "";
  h += lin
    ? card("Linear (tendência da margem)", lin.flavio, lin.lula, `margem projetada ${fmtPP(lin.margem100)} (Flávio − Lula)`)
    : `<div class="card"><div class="rot">Linear</div><div class="sub">Precisa de pelo menos 3 pontos com votos.</div></div>`;
  if (proj) {
    const m = proj.flavio + proj.lula ? (100 * (proj.flavio - proj.lula)) / (proj.flavio + proj.lula) : 0;
    h += card("Ponderada (município a município)", proj.flavio, proj.lula,
      `margem ${fmtPP(m)} · ~${fmtInt(proj.faltam)} válidos ainda por apurar · Flávio ${fmtInt(proj.flavio)} × Lula ${fmtInt(proj.lula)}`);
  } else {
    h += `<div class="card"><div class="rot">Ponderada</div><div class="sub">Carregando base do 1º turno…</div></div>`;
  }
  $("projecao").innerHTML = h;
}

function linhasUF() {
  const L = S.latest;
  return UFS.map((uf) => ({ uf, p: L.uf[uf] })).filter((r) => r.p);
}
function ordena(rows, nome) {
  if (S.ordem === "nome") return rows.sort((a, b) => nome(b).localeCompare(nome(a), "pt-BR"));
  if (S.ordem === "margem") return rows.sort((a, b) => ((shareF(a.p) ?? 50) - (shareL(a.p) ?? 50)) - ((shareF(b.p) ?? 50) - (shareL(b.p) ?? 50)));
  return rows.sort((a, b) => a.p.pct_apurado - b.p.pct_apurado);
}
function corLider(p) {
  if (!dois(p)) return cssVar("--neutro");
  return p.votos.flavio >= p.votos.lula ? cssVar("--flavio") : cssVar("--lula");
}
function barrasPct(div, rows, nome) {
  const hov = rows.map((r) => `<b>${nome(r)}</b><br>apurado ${fmtPct(r.p.pct_apurado)}<br>Flávio ${fmtPct(shareF(r.p))} · Lula ${fmtPct(shareL(r.p))}`);
  Plotly.react(div, [{
    type: "bar", orientation: "h", y: rows.map(nome), x: rows.map((r) => r.p.pct_apurado),
    marker: { color: rows.map((r) => corLider(r.p)) }, text: rows.map((r) => fmtPct(r.p.pct_apurado, 1)),
    textposition: "outside", cliponaxis: false, hovertext: hov, hoverinfo: "text",
  }], plotLayout({
    margin: { l: 110, r: 50, t: 6, b: 30 }, bargap: 0.25,
    xaxis: { range: [0, 100], ticksuffix: "%", gridcolor: cssVar("--grid"), zeroline: false },
    yaxis: { automargin: true }, showlegend: false,
  }), PLOT_CFG);
}
function renderPctPainel() {
  const L = S.latest;
  const regs = Object.keys(REGIOES).map((r) => ({ r, p: L.regiao[r] })).filter((x) => x.p);
  regs.push({ r: "ZZ", p: L.uf.zz });
  barrasPct("g-pct-regiao", ordena(regs.filter((x) => x.p), (x) => (x.r === "ZZ" ? "Exterior" : NOME_REG[x.r])), (x) => (x.r === "ZZ" ? "Exterior" : NOME_REG[x.r]));
  barrasPct("g-pct-uf", ordena(linhasUF(), (x) => NOME_UF[x.uf]), (x) => NOME_UF[x.uf]);
}

function renderMapa() {
  if (!S.geo) return;
  const rows = linhasUF().filter((r) => r.uf !== "zz");
  const z = rows.map((r) => (dois(r.p) ? shareF(r.p) - shareL(r.p) : 0));
  const lim = Math.max(10, ...z.map(Math.abs));
  Plotly.react("g-mapa", [{
    type: "choropleth", geojson: S.geo, featureidkey: "properties.sigla",
    locations: rows.map((r) => r.uf.toUpperCase()), z, zmin: -lim, zmax: lim,
    colorscale: [[0, cssVar("--lula")], [0.5, cssVar("--surface")], [1, cssVar("--flavio")]],
    marker: { line: { color: cssVar("--line"), width: 0.8 } },
    text: rows.map((r) => `<b>${NOME_UF[r.uf]}</b><br>apurado ${fmtPct(r.p.pct_apurado)}<br>Flávio ${fmtPct(shareF(r.p))} · Lula ${fmtPct(shareL(r.p))}`),
    hoverinfo: "text",
    colorbar: { title: { text: "margem (p.p.)" }, thickness: 10, len: 0.6, tickvals: [-lim, 0, lim], ticktext: [`Lula +${lim.toFixed(0)}`, "0", `Flávio +${lim.toFixed(0)}`] },
  }], plotLayout({
    margin: { l: 0, r: 0, t: 0, b: 0 },
    geo: { fitbounds: "locations", visible: false, bgcolor: "rgba(0,0,0,0)" },
  }), PLOT_CFG);
}

function linhaLider(p) {
  if (!dois(p)) return "–";
  const c = p.votos.flavio >= p.votos.lula ? CAND[0] : CAND[1];
  return `<span class="lider"><span class="sw" style="--c:var(${c.cor})"></span>${c.curto}</span>`;
}

function renderRestantes(projBR) {
  const t = $("t-restantes");
  if (!projBR) { t.innerHTML = "<tr><td>Carregando base do 1º turno…</td></tr>"; return; }
  const rows = linhasUF().map((r) => ({ ...r, falta: projBR.porUF[r.uf] ? projBR.porUF[r.uf].faltam : 0 }))
    .sort((a, b) => b.falta - a.falta);
  t.innerHTML = `<thead><tr><th>UF</th><th>Válidos restantes (estim.)</th><th>% apurado</th><th>Líder</th><th>Margem</th></tr></thead><tbody>` +
    rows.map((r) => `<tr class="clica" data-uf="${r.uf}"><td>${NOME_UF[r.uf]}</td><td>${fmtInt(r.falta)}</td><td>${fmtPct(r.p.pct_apurado)}</td>
      <td>${linhaLider(r.p)}</td><td>${dois(r.p) ? fmtPP(Math.abs(shareF(r.p) - shareL(r.p))) : "–"}</td></tr>`).join("") + "</tbody>";
}

function base1tDe(sel) {
  if (!S.base) return null;
  const arr = (a) => (a ? { votos: { flavio: a[2], lula: a[3] } } : null);
  if (sel.nivel === "br") return S.base.br;
  if (sel.nivel === "regiao") return somaPontos(REGIOES[sel.regiao].map((u) => S.base.uf[u]));
  if (sel.nivel === "uf") return S.base.uf[sel.uf];
  return arr((S.base.mun[sel.uf] || {})[sel.mun]);
}
function render1T() {
  const t = $("t-1t");
  if (!S.base) { t.innerHTML = "<tr><td>Carregando base do 1º turno…</td></tr>"; return; }
  const sels = [S.sel];
  if (S.sel.nivel === "br") Object.keys(REGIOES).forEach((r) => sels.push({ nivel: "regiao", regiao: r }));
  if (S.sel.nivel === "br" || S.sel.nivel === "regiao") ufsDoLocal().forEach((u) => sels.push({ nivel: "uf", uf: u }));
  const lin = sels.map((sel) => {
    const b = base1tDe(sel), p = pontoAtual(sel);
    const f1 = shareF(b), f2 = shareF(p);
    return `<tr><td>${esc(nomeLocal(sel))}</td><td>${fmtPct(f1)}</td><td>${fmtPct(f2)}</td><td>${f1 != null && f2 != null ? fmtPP(f2 - f1) : "–"}</td></tr>`;
  });
  t.innerHTML = `<thead><tr><th>Local</th><th>Flávio 1º turno</th><th>Flávio agora</th><th>Variação</th></tr></thead><tbody>${lin.join("")}</tbody>`;
}

function renderBNA(p) {
  if (!p || !p.comparecimento) { $("bna").innerHTML = `<div class="card"><div class="sub">Aguardando votos.</div></div>`; return; }
  const apto = p.comparecimento + p.abst;
  const c = (rot, v, base, sub) => `<div class="card"><div class="rot">${rot}</div><div class="val">${fmtPct(base ? (100 * v) / base : null)}</div><div class="sub">${fmtInt(v)} ${sub}</div></div>`;
  $("bna").innerHTML = c("Brancos", p.brancos, p.comparecimento, "· % do comparecimento") +
    c("Nulos", p.nulos, p.comparecimento, "· % do comparecimento") +
    c("Abstenção", p.abst, apto, "· % do eleitorado apurado") +
    c("Comparecimento", p.comparecimento, apto, "eleitores");
}

function renderMunTabela() {
  const uf = S.sel.nivel === "uf" || S.sel.nivel === "mun" ? S.sel.uf : null;
  const t = $("t-mun");
  $("filtro-mun").hidden = !uf;
  if (!uf) { $("titulo-mun").textContent = "Municípios"; t.innerHTML = "<tr><td>Escolha uma UF para ver os municípios.</td></tr>"; return; }
  $("titulo-mun").textContent = `Municípios – ${NOME_UF[uf]}`;
  const filtro = $("filtro-mun").value.trim().toLocaleLowerCase("pt-BR");
  const cur = S.latest.mun[uf] || {};
  let rows = Object.entries(cur).map(([cd, p]) => ({ cd, p, nome: nomeMun(uf, cd) }));
  if (filtro) rows = rows.filter((r) => r.nome.toLocaleLowerCase("pt-BR").includes(filtro));
  const { col, dir } = S.munSort;
  const val = { nome: (r) => r.nome, pct: (r) => r.p.pct_apurado, f: (r) => shareF(r.p) ?? -1, l: (r) => shareL(r.p) ?? -1, lider: (r) => (shareF(r.p) ?? 50) - (shareL(r.p) ?? 50) }[col];
  rows.sort((a, b) => (col === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : val(a) - val(b)) * dir);
  const th = (c, txt) => `<th data-col="${c}">${txt}${col === c ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  t.innerHTML = `<thead><tr>${th("nome", "Município")}${th("pct", "% apurado")}${th("f", "Flávio")}${th("l", "Lula")}${th("lider", "Líder")}</tr></thead><tbody>` +
    rows.map((r) => `<tr class="clica" data-mun="${r.cd}"><td>${esc(r.nome)}</td><td>${fmtPct(r.p.pct_apurado)}</td><td>${fmtPct(shareF(r.p))}</td><td>${fmtPct(shareL(r.p))}</td><td>${linhaLider(r.p)}</td></tr>`).join("") +
    "</tbody>";
}

function renderMeta() {
  const m = S.meta || {};
  const st = $("status");
  const txt = { aguardando: "aguardando início", apurando: "apurando", finalizado: "totalização final", encerrado: "coleta encerrada" }[m.status] || "–";
  st.textContent = `${txt}${m.pct_apurado_br != null ? " · " + fmtPct(m.pct_apurado_br) : ""}`;
  st.className = `status ${m.status || ""}`;
  $("rod-atual").textContent = fmtHora(m.ultima_coleta);
  $("rod-tse").textContent = fmtHora(m.ultima_totalizacao_tse);
}

async function renderTudo() {
  if (!S.latest) return;
  renderMeta();
  $("titulo-local").textContent = nomeLocal();
  const p = pontoAtual();
  const proj = projecaoLocal();
  renderCards(p, proj);
  renderFoto(p);
  renderBNA(p);
  renderPctPainel();
  renderMapa();
  renderRestantes(S.base ? projecaoMunicipios(UFS) : null);
  render1T();
  renderMunTabela();
  const serie = await carregaSerie();
  const lin = renderEvolucao(serie, p);
  renderProjecao(p, lin, proj);
}

/* ---------- seletor ---------- */
function syncSeletor() {
  const n = S.sel.nivel;
  $("sel-nivel").value = n;
  $("lbl-regiao").hidden = n !== "regiao";
  $("lbl-uf").hidden = !(n === "uf" || n === "mun");
  $("lbl-mun").hidden = n !== "mun";
  $("sel-regiao").value = S.sel.regiao;
  $("sel-uf").value = S.sel.uf;
  if (n === "mun") {
    const opts = Object.entries(S.municipios[S.sel.uf] || {}).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    $("lista-mun").innerHTML = opts.map(([, nm]) => `<option value="${esc(nm)}">`).join("");
    $("busca-mun").value = S.sel.mun ? nomeMun(S.sel.uf, S.sel.mun) : "";
  }
  const h = n === "br" ? "" : n === "regiao" ? `regiao-${S.sel.regiao}` : n === "uf" ? `uf-${S.sel.uf}` : S.sel.mun ? `mun-${S.sel.uf}-${S.sel.mun}` : `uf-${S.sel.uf}`;
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}
function lerHash() {
  const [n, a, b] = location.hash.replace("#", "").split("-");
  if (n === "regiao" && REGIOES[a]) Object.assign(S.sel, { nivel: "regiao", regiao: a });
  else if (n === "uf" && NOME_UF[a]) Object.assign(S.sel, { nivel: "uf", uf: a });
  else if (n === "mun" && NOME_UF[a] && b) Object.assign(S.sel, { nivel: "mun", uf: a, mun: b });
}
function selecionar(mud) {
  Object.assign(S.sel, mud);
  syncSeletor();
  renderTudo();
}
function montaSeletor() {
  $("sel-regiao").innerHTML = Object.keys(REGIOES).map((r) => `<option value="${r}">${NOME_REG[r]}</option>`).join("");
  $("sel-uf").innerHTML = UFS.map((u) => `<option value="${u}">${NOME_UF[u]}${u === "zz" ? "" : " (" + u.toUpperCase() + ")"}</option>`).join("");
  $("sel-nivel").addEventListener("change", (e) => {
    const n = e.target.value;
    selecionar({ nivel: n });
  });
  $("sel-regiao").addEventListener("change", (e) => selecionar({ regiao: e.target.value }));
  $("sel-uf").addEventListener("change", (e) => selecionar({ uf: e.target.value, mun: null }));
  $("busca-mun").addEventListener("change", (e) => {
    const alvo = e.target.value.trim().toLocaleLowerCase("pt-BR");
    const hit = Object.entries(S.municipios[S.sel.uf] || {}).find(([, nm]) => nm.toLocaleLowerCase("pt-BR") === alvo);
    if (hit) selecionar({ mun: hit[0] });
  });
  $("n-pontos").addEventListener("change", renderTudo);
  $("ordem").addEventListener("change", (e) => { S.ordem = e.target.value; renderPctPainel(); });
  $("filtro-mun").addEventListener("input", renderMunTabela);
  $("t-mun").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (th) {
      const c = th.dataset.col;
      S.munSort = { col: c, dir: S.munSort.col === c ? -S.munSort.dir : c === "nome" ? 1 : -1 };
      renderMunTabela();
      return;
    }
    const tr = e.target.closest("tr[data-mun]");
    if (tr) { selecionar({ nivel: "mun", mun: tr.dataset.mun }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("t-restantes").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-uf]");
    if (tr) { selecionar({ nivel: "uf", uf: tr.dataset.uf, mun: null }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
}

/* ---------- tema ---------- */
function montaTema() {
  let salvo = null;
  try { salvo = localStorage.getItem("tema"); } catch (e) { /* sem storage */ }
  if (salvo) document.documentElement.dataset.theme = salvo;
  $("tema").addEventListener("click", () => {
    const escuroAgora = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    const novo = escuroAgora ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("tema", novo); } catch (e) { /* sem storage */ }
    renderTudo();
  });
}

/* ---------- carga ---------- */
async function atualizar() {
  const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
  if (latest) S.latest = latest;
  if (meta) S.meta = meta;
  if (!S.latest) {
    $("status").textContent = "sem dados ainda";
    $("cards").innerHTML = `<div class="card destaque"><div class="rot">Ainda não há dados publicados pelo coletor. Tente novamente em instantes.</div></div>`;
    return;
  }
  await renderTudo();
}

async function iniciar() {
  if (TESTE) $("aviso-teste").hidden = false;
  montaTema();
  montaSeletor();
  lerHash();
  const mun = await getJSON("municipios.json");
  if (mun) S.municipios = mun;
  syncSeletor();
  await atualizar();
  // Extras carregados depois da primeira pintura
  Promise.all([getJSON("base_1t/br.json"), getJSON("base_1t/uf.json"), getJSON("base_1t/mun.json")]).then(([br, uf, m]) => {
    if (br && uf && m) { S.base = { br, uf, mun: m }; renderTudo(); }
  });
  fetch("https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@48ba05ad4c6969e3b3c25735492169227ae411f1/public/data/brazil-states.geojson")
    .then((r) => r.json()).then((g) => { S.geo = g; renderMapa(); }).catch(() => {});
  setInterval(atualizar, REFRESH_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();
