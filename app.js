"use strict";
/* Painel de apuração – Presidente 2026 (1º e 2º turno). Sem build; Plotly via CDN. */

const QS = new URLSearchParams(location.search);
const TESTE = QS.get("fonte") === "teste";
// Em <owner>.github.io/<repo>/ descobre owner/repo sozinho; senão usa o padrão abaixo.
const OWNER_PADRAO = "olcinomartins", REPO_PADRAO = "apuracao-2026";
const OWNER = location.hostname.endsWith("github.io") ? location.hostname.split(".")[0] : OWNER_PADRAO;
const REPO = location.hostname.endsWith("github.io") ? (location.pathname.split("/")[1] || REPO_PADRAO) : REPO_PADRAO;
const BASE = QS.get("dados") || (TESTE ? "./data-test/" : `https://raw.githubusercontent.com/${OWNER}/${REPO}/data/`);
const BASE_T1 = QS.get("dados_t1") || (TESTE ? "./data-test/t1/" : `https://raw.githubusercontent.com/${OWNER}/${REPO}/data/t1/`);
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
  { k: "flavio", n: "22", nome: "Flávio Bolsonaro", curto: "Flávio", partido: "PL", cor: "--flavio" },
  { k: "lula", n: "13", nome: "Lula", curto: "Lula", partido: "PT", cor: "--lula" },
];

const S = {
  turno: "t2",
  d: { t2: { latest: null, meta: null }, t1: { latest: null, meta: null, cands: null } },
  municipios: {}, base: null, geo: null,
  series: {}, sel: { regiao: null, uf: null, mun: null },
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
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const titulo = (s) => String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
const fmtHora = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso.length <= 19 ? iso + "-03:00" : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
function mix(a, b, t) {
  const h = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [p, q] = [h(a), h(b)];
  return "#" + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

async function getJSON(path, base = BASE) {
  try {
    const r = await fetch(`${base}${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn("falha ao ler", path, e);
    return null;
  }
}

const T1 = () => S.turno === "t1";
const L = () => S.d[S.turno].latest;
const dois = (p) => (p ? p.votos.flavio + p.votos.lula : 0);
// % de um candidato: no 2º turno sobre os dois; no 1º, sobre todos os válidos
const pctC = (p, k) => {
  if (!p) return null;
  const den = T1() ? p.validos : dois(p);
  return den ? (100 * p.votos[k]) / den : null;
};
const shareF = (p) => (dois(p) ? (100 * p.votos.flavio) / dois(p) : null);
const shareL = (p) => (dois(p) ? (100 * p.votos.lula) / dois(p) : null);
const margem = (p) => (dois(p) ? shareF(p) - shareL(p) : null);
const nomeMun = (uf, cd) => titulo((S.municipios[uf] && S.municipios[uf][cd]) || cd);

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
function nivel(sel = S.sel) {
  if (sel.mun) return "mun";
  if (sel.uf) return "uf";
  if (sel.regiao) return "regiao";
  return "br";
}
function ufsDoLocal(sel = S.sel) {
  const n = nivel(sel);
  if (n === "br") return UFS;
  if (n === "regiao") return REGIOES[sel.regiao];
  return [sel.uf];
}
function pontoAtual(sel = S.sel, lat = L()) {
  if (!lat) return null;
  const n = nivel(sel);
  if (n === "br") return lat.br;
  if (n === "regiao") return lat.regiao[sel.regiao];
  if (n === "uf") return lat.uf[sel.uf];
  return (lat.mun[sel.uf] || {})[sel.mun] || null;
}
function nomeLocal(sel = S.sel) {
  const n = nivel(sel);
  if (n === "br") return "Brasil";
  if (n === "regiao") return `Região ${NOME_REG[sel.regiao]}`;
  if (n === "uf") return NOME_UF[sel.uf];
  return `${nomeMun(sel.uf, sel.mun)} (${sel.uf === "zz" ? "Exterior" : sel.uf.toUpperCase()})`;
}
function seriePath(sel = S.sel) {
  const n = nivel(sel);
  if (n === "br") return "series/br.json";
  if (n === "regiao") return `series/regiao/${sel.regiao}.json`;
  return n === "uf" ? `series/uf/${sel.uf}.json` : `series/mun/${sel.uf}.json`;
}
async function carregaSerie(sel = S.sel) {
  const path = seriePath(sel);
  const d = await getJSON(path);
  if (d) S.series[path] = d;
  const s = S.series[path];
  if (!s) return [];
  return nivel(sel) === "mun" ? s[sel.mun] || [] : s;
}

/* ---------- projeção ponderada (bottom-up por município) ---------- */
function projecaoMunicipios(ufs) {
  const lat = S.d.t2.latest;
  if (!lat || !S.base) return null;
  const b = S.base.mun;
  const swingUF = {};
  let swN = 0, swD = 0;
  for (const uf of UFS) {
    let n = 0, d = 0;
    for (const [cd, p] of Object.entries(lat.mun[uf] || {})) {
      const b1 = (b[uf] || {})[cd];
      if (!b1 || p.pct_apurado < 5 || !dois(p) || b1[2] + b1[3] === 0) continue;
      n += (p.votos.flavio / dois(p) - b1[2] / (b1[2] + b1[3])) * dois(p); d += dois(p);
    }
    swingUF[uf] = d ? n / d : null;
    swN += n; swD += d;
  }
  const swingBR = swD ? swN / swD : 0;
  const tot = { flavio: 0, lula: 0, faltam: 0, porUF: {}, porMun: {} };
  for (const uf of ufs) {
    const cur = lat.mun[uf] || {}, base = b[uf] || {};
    const sw = swingUF[uf] ?? swingBR;
    const u = { flavio: 0, lula: 0, faltam: 0 };
    tot.porMun[uf] = {};
    for (const cd of new Set([...Object.keys(cur), ...Object.keys(base)])) {
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
        ratio = dois(p) / comp; sF = p.votos.flavio / dois(p);
      } else if (b1 && b1[1] && b1[2] + b1[3]) {
        ratio = b1[4] / b1[1]; sF = Math.min(1, Math.max(0, b1[2] / (b1[2] + b1[3]) + sw));
      } else {
        ratio = 0.95; sF = p && dois(p) ? p.votos.flavio / dois(p) : 0.5;
      }
      const falta = faltaComp * ratio;
      const m = { faltam: falta, flavio: (p ? p.votos.flavio : 0) + falta * sF, lula: (p ? p.votos.lula : 0) + falta * (1 - sF) };
      tot.porMun[uf][cd] = m;
      u.faltam += m.faltam; u.flavio += m.flavio; u.lula += m.lula;
    }
    tot.porUF[uf] = u;
    tot.faltam += u.faltam; tot.flavio += u.flavio; tot.lula += u.lula;
  }
  return tot;
}
function projecaoLocal(sel = S.sel) {
  if (T1()) return null;
  const pr = projecaoMunicipios(ufsDoLocal(sel));
  if (!pr) return null;
  return nivel(sel) === "mun" ? pr.porMun[sel.uf][sel.mun] || null : pr;
}

/* ---------- projeção linear ---------- */
function projecaoLinear(serie, n) {
  const pts = serie.filter((p) => p.pct_apurado > 0 && dois(p) > 0).slice(-n);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.pct_apurado), ys = pts.map(margem);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxx = 0, sxy = 0;
  xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const x0 = xs[xs.length - 1];
  const margem100 = Math.max(-100, Math.min(100, a + b * 100));
  return { x0, margemX0: a + b * x0, margem100, flavio: 50 + margem100 / 2, lula: 50 - margem100 / 2 };
}

/* ---------- combo com busca ---------- */
function Combo(el, { onChange, placeholder = "Buscar…", limite = 300 }) {
  el.innerHTML = `<button type="button" class="combo-btn" aria-haspopup="listbox" aria-expanded="false">
      <svg><use href="#i-lupa"/></svg><span class="combo-lbl"></span><svg><use href="#i-seta"/></svg></button>
    <div class="combo-pop" hidden><div class="combo-busca"><svg><use href="#i-lupa"/></svg>
      <input type="search" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"></div>
      <ul class="combo-lista" role="listbox"></ul></div>`;
  const btn = el.querySelector(".combo-btn"), pop = el.querySelector(".combo-pop"),
    inp = el.querySelector("input"), ul = el.querySelector("ul"), lbl = el.querySelector(".combo-lbl");
  let opts = [], valor = null, vis = [], ativo = 0;
  const desenha = () => {
    const q = norm(inp.value.trim());
    const todos = q ? opts.filter((o) => o.busca.includes(q)) : opts;
    vis = todos.slice(0, limite);
    ativo = Math.min(ativo, Math.max(0, vis.length - 1));
    ul.innerHTML = vis.map((o, i) => `<li role="option" data-i="${i}" aria-selected="${o.v === valor}" class="${i === ativo ? "ativo" : ""}">
        <span>${esc(o.label)}</span>${o.extra ? `<small>${esc(o.extra)}</small>` : ""}</li>`).join("") +
      (todos.length > vis.length ? `<li class="vazio">+${fmtInt(todos.length - vis.length)} — digite para filtrar</li>` : "") +
      (!todos.length ? `<li class="vazio">Nada encontrado</li>` : "");
  };
  const abre = () => { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); inp.value = ""; ativo = Math.max(0, opts.findIndex((o) => o.v === valor)); desenha(); inp.focus(); const a = ul.querySelector(".ativo"); if (a) a.scrollIntoView({ block: "nearest" }); };
  const fecha = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const escolhe = (o) => { fecha(); if (o) { valor = o.v; lbl.textContent = o.label; onChange(o.v); } btn.focus(); };
  btn.addEventListener("click", () => (pop.hidden ? abre() : fecha()));
  inp.addEventListener("input", () => { ativo = 0; desenha(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { ativo = Math.min(vis.length - 1, ativo + 1); desenha(); ul.querySelector(".ativo")?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    else if (e.key === "ArrowUp") { ativo = Math.max(0, ativo - 1); desenha(); ul.querySelector(".ativo")?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    else if (e.key === "Enter") { escolhe(vis[ativo]); e.preventDefault(); }
    else if (e.key === "Escape") { fecha(); btn.focus(); }
  });
  ul.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) escolhe(vis[+li.dataset.i]); });
  document.addEventListener("click", (e) => { if (!el.contains(e.target)) fecha(); });
  return {
    set(options, v) {
      opts = options.map((o) => ({ ...o, busca: norm(o.label + " " + (o.extra || "")) }));
      valor = v;
      const o = opts.find((x) => x.v === v) || opts[0];
      lbl.textContent = o ? o.label : "";
      if (!pop.hidden) desenha();
    },
  };
}

/* ---------- render ---------- */
function plotLayout(extra = {}) {
  const ink = cssVar("--ink-2"), grid = cssVar("--grid");
  return Object.assign({
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 12, color: ink },
    margin: { l: 48, r: 14, t: 10, b: 40 }, separators: ",.",
    hoverlabel: { bgcolor: cssVar("--surface"), bordercolor: cssVar("--line"), font: { color: cssVar("--ink"), family: "Inter, system-ui, sans-serif" } },
    xaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    yaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    legend: { orientation: "h", y: 1.08, x: 0 },
  }, extra);
}
const PLOT_CFG = { displayModeBar: false, responsive: true, locale: "pt-BR" };

function renderPlacar(p, proj) {
  const el = $("placar");
  if (!p) { el.innerHTML = `<p class="nota">Sem dados ainda para este local.</p>`; $("apurado").innerHTML = ""; $("stats").innerHTML = ""; return; }
  const [F, Lu] = CAND;
  const pf = pctC(p, "flavio"), pl = pctC(p, "lula");
  const outros = T1() && p.validos ? 100 - (pf || 0) - (pl || 0) : 0;
  const dif = p.votos.flavio - p.votos.lula;
  const lider = dif >= 0 ? F : Lu;
  const restantes = proj ? proj.faltam : null;
  const definido = !T1() && restantes != null && dois(p) > 0 && Math.abs(dif) > restantes;
  const lado = (c, pct, dir) => `<div class="placar-c ${dir ? "dir" : ""}" style="--c:var(${c.cor})">
      <div class="placar-nome">${dir ? "" : `<span class="sw"></span>`}${c.nome} <span class="nota-inline">${c.partido}</span>${dir ? `<span class="sw"></span>` : ""}</div>
      <div class="placar-pct">${dois(p) ? fmtPct(pct) : "–"}</div>
      <div class="placar-votos">${fmtInt(p.votos[c.k])} votos</div></div>`;
  el.innerHTML = `<div class="placar"><div class="placar-nomes">${lado(F, pf, false)}${lado(Lu, pl, true)}</div>
    <div class="placar-barra" role="img" aria-label="Flávio ${fmtPct(pf)}, Lula ${fmtPct(pl)}">
      <span style="--c:var(--flavio);width:${dois(p) ? pf : 0}%"></span>
      ${outros > 0 ? `<span style="--c:var(--outros);width:${outros}%"></span>` : ""}
      <span style="--c:var(--lula);width:${dois(p) ? pl : 0}%"></span></div>
    <div class="placar-meio">${dois(p)
      ? `<b>${lider.curto}</b> à frente por <b>${fmtInt(Math.abs(dif))}</b> votos (${fmtPP(Math.abs(shareF(p) - shareL(p))).replace("+", "")})${definido ? `<span class="selo">✓ matematicamente definido</span>` : ""}`
      : "Aguardando os primeiros votos"}${outros > 0 ? ` · outros ${fmtPct(outros)}` : ""}</div></div>`;
  $("apurado").innerHTML = `<div class="apurado"><div class="apurado-cab"><span>Seções apuradas</span><b>${fmtPct(p.pct_apurado)}</b></div>
    <div class="apurado-trilho"><span style="width:${p.pct_apurado}%"></span></div>
    <div class="nota">${fmtInt(p.s[0])} de ${fmtInt(p.s[1])} seções · totalização TSE ${fmtHora(p.tse)}</div></div>`;
  const st = (rot, val, sub) => `<div class="stat"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $("stats").innerHTML = T1()
    ? st("Votos válidos", fmtInt(p.validos), "todos os candidatos") + st("Comparecimento", fmtPct(p.eleitorado ? (100 * p.comparecimento) / p.eleitorado : null), fmtInt(p.comparecimento) + " eleitores")
    : st("Válidos restantes (estim.)", restantes == null ? "–" : fmtInt(restantes), restantes == null ? "carregando base…" : "eleitorado × comparecimento esperado − apurados") +
      st("Diferença", dois(p) ? fmtInt(Math.abs(dif)) : "–", dois(p) ? `${lider.curto} · ${fmtPP(Math.abs(shareF(p) - shareL(p))).replace("+", "")}` : "aguardando");
}

function renderEvolucao(serie) {
  const pts = serie.filter((q) => q.pct_apurado > 0 && dois(q) > 0);
  const n = Math.max(3, Math.min(50, parseInt($("n-pontos").value, 10) || 10));
  const lin = projecaoLinear(serie, n);
  const cF = cssVar("--flavio"), cL = cssVar("--lula");
  const x = pts.map((q) => q.pct_apurado);
  const hov = (c, f) => pts.map((q) => `${fmtHora(q.tse || q.ts)}<br>${c.curto}: ${fmtPct(f(q))}<br>apurado ${fmtPct(q.pct_apurado)}`);
  const modo = pts.length < 30 ? "lines+markers" : "lines";
  const traces = [
    { x, y: pts.map(shareF), name: "Flávio", mode: modo, line: { color: cF, width: 2.5, shape: "spline", smoothing: 0.4 }, marker: { size: 7 }, text: hov(CAND[0], shareF), hoverinfo: "text" },
    { x, y: pts.map(shareL), name: "Lula", mode: modo, line: { color: cL, width: 2.5, shape: "spline", smoothing: 0.4 }, marker: { size: 7 }, text: hov(CAND[1], shareL), hoverinfo: "text" },
  ];
  if (lin && lin.x0 < 100) {
    traces.push(
      { x: [lin.x0, 100], y: [50 + lin.margemX0 / 2, lin.flavio], mode: "lines", line: { color: cF, width: 2, dash: "dash" }, hovertemplate: "Proj. linear Flávio: %{y:.2f}%<extra></extra>", showlegend: false },
      { x: [lin.x0, 100], y: [50 - lin.margemX0 / 2, lin.lula], mode: "lines", line: { color: cL, width: 2, dash: "dash" }, hovertemplate: "Proj. linear Lula: %{y:.2f}%<extra></extra>", showlegend: false },
    );
  }
  const shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 50, y1: 50, line: { color: cssVar("--line"), width: 1 } }], annotations = [];
  let virada = null;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.sign(margem(pts[i - 1])), b = Math.sign(margem(pts[i]));
    if (a && b && a !== b) virada = { x: pts[i].pct_apurado, quem: b > 0 ? "Flávio" : "Lula", ts: pts[i].tse || pts[i].ts };
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
    shapes, annotations, hovermode: "closest",
  }), PLOT_CFG);
  return lin;
}

function renderFoto(p) {
  if (!p) { $("foto").innerHTML = ""; $("foto-hora").textContent = ""; return; }
  let linhas;
  if (T1() && p.cand && S.d.t1.cands) {
    const corDe = (n) => (n === "22" ? "--flavio" : n === "13" ? "--lula" : "--outros");
    linhas = S.d.t1.cands.map((c) => ({ nome: titulo(c.nome), cor: corDe(c.n), v: p.cand[c.n] || 0 }))
      .sort((a, b) => b.v - a.v).map((c) => ({ ...c, pct: p.validos ? (100 * c.v) / p.validos : 0 }));
  } else {
    linhas = CAND.map((c) => ({ nome: c.curto, cor: c.cor, v: p.votos[c.k], pct: pctC(p, c.k) || 0 }));
  }
  $("foto").innerHTML = linhas.map((c) => `<div class="barra-linha" style="--c:var(${c.cor})"><span class="barra-nome" title="${esc(c.nome)}">${esc(c.nome)}</span>
      <div class="barra-trilho" role="img" aria-label="${esc(c.nome)} ${fmtPct(c.pct)}">
      <div class="barra-fill" style="width:${c.pct.toFixed(2)}%"></div>
      <span class="barra-txt">${fmtPct(c.pct)} · ${fmtInt(c.v)}</span></div></div>`).join("");
  $("foto-hora").textContent = `${T1() ? "% dos votos válidos. " : ""}Última totalização do TSE para este local: ${fmtHora(p.tse)}`;
}

function renderProjecao(lin, proj) {
  const card = (titulo, f, l, nota) => {
    const tot = f + l;
    return `<div class="stat"><div class="rot">${titulo}</div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--flavio)"></span> Flávio</span><b>${fmtPct(tot ? (100 * f) / tot : null)}</b></div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--lula)"></span> Lula</span><b>${fmtPct(tot ? (100 * l) / tot : null)}</b></div>
      <div class="sub">${nota}</div></div>`;
  };
  let h = lin
    ? card("Linear (tendência da margem)", lin.flavio, lin.lula, `margem projetada ${fmtPP(lin.margem100)} (Flávio − Lula)`)
    : `<div class="stat"><div class="rot">Linear</div><div class="sub">Precisa de pelo menos 3 pontos com votos.</div></div>`;
  if (proj) {
    const m = proj.flavio + proj.lula ? (100 * (proj.flavio - proj.lula)) / (proj.flavio + proj.lula) : 0;
    h += card("Ponderada (município a município)", proj.flavio, proj.lula, `margem ${fmtPP(m)} · ~${fmtInt(proj.faltam)} válidos ainda por apurar`);
  } else h += `<div class="stat"><div class="rot">Ponderada</div><div class="sub">Carregando base do 1º turno…</div></div>`;
  $("projecao").innerHTML = h;
}

const linhasUF = () => UFS.map((uf) => ({ uf, p: L().uf[uf] })).filter((r) => r.p);
function ordena(rows, nome) {
  if (S.ordem === "nome") return rows.sort((a, b) => nome(b).localeCompare(nome(a), "pt-BR"));
  if (S.ordem === "margem") return rows.sort((a, b) => (margem(a.p) ?? 0) - (margem(b.p) ?? 0));
  return rows.sort((a, b) => a.p.pct_apurado - b.p.pct_apurado);
}
const corLider = (p) => (!dois(p) ? cssVar("--neutro") : p.votos.flavio >= p.votos.lula ? cssVar("--flavio") : cssVar("--lula"));
function barrasPct(div, rows, nome) {
  Plotly.react(div, [{
    type: "bar", orientation: "h", y: rows.map(nome), x: rows.map((r) => r.p.pct_apurado),
    marker: { color: rows.map((r) => corLider(r.p)) }, text: rows.map((r) => fmtPct(r.p.pct_apurado, 1)),
    textposition: "outside", cliponaxis: false, hoverinfo: "text",
    hovertext: rows.map((r) => `<b>${nome(r)}</b><br>apurado ${fmtPct(r.p.pct_apurado)}<br>Flávio ${fmtPct(pctC(r.p, "flavio"))} · Lula ${fmtPct(pctC(r.p, "lula"))}`),
  }], plotLayout({
    margin: { l: 110, r: 50, t: 6, b: 30 }, bargap: 0.3,
    xaxis: { range: [0, 100], ticksuffix: "%", gridcolor: cssVar("--grid"), zeroline: false },
    yaxis: { automargin: true }, showlegend: false,
  }), PLOT_CFG);
}
function renderPctPainel() {
  const lat = L();
  const nomeR = (x) => (x.r === "ZZ" ? "Exterior" : NOME_REG[x.r]);
  const regs = Object.keys(REGIOES).map((r) => ({ r, p: lat.regiao[r] })).concat([{ r: "ZZ", p: lat.uf.zz }]).filter((x) => x.p);
  barrasPct("g-pct-regiao", ordena(regs, nomeR), nomeR);
  barrasPct("g-pct-uf", ordena(linhasUF(), (x) => NOME_UF[x.uf]), (x) => NOME_UF[x.uf]);
}

function renderMapa() {
  if (!S.geo || !L()) return;
  const rows = linhasUF().filter((r) => r.uf !== "zz");
  const lim = Math.max(20, ...rows.map((r) => Math.abs(margem(r.p) || 0)));
  const z = rows.map((r) => (dois(r.p) ? Math.max(-lim, Math.min(lim, margem(r.p))) : 0));
  const surf = cssVar("--surface"), cF = cssVar("--flavio"), cL = cssVar("--lula"), neu = cssVar("--neutro");
  const selUF = new Set(nivel() === "br" ? [] : ufsDoLocal());
  Plotly.react("g-mapa", [{
    type: "choropleth", geojson: S.geo, featureidkey: "properties.sigla",
    locations: rows.map((r) => r.uf.toUpperCase()), z, zmin: -lim, zmax: lim,
    // vermelho (Lula) ← cinza (sem votos) → azul (Flávio); mesmo margem pequena já ganha cor
    colorscale: [[0, cL], [0.4995, mix(cL, surf, 0.72)], [0.4996, neu], [0.5004, neu], [0.5005, mix(cF, surf, 0.72)], [1, cF]],
    marker: { line: { color: rows.map((r) => (selUF.has(r.uf) ? cssVar("--ink") : surf)), width: rows.map((r) => (selUF.has(r.uf) ? 2.2 : 0.8)) } },
    text: rows.map((r) => `<b>${NOME_UF[r.uf]}</b><br>apurado ${fmtPct(r.p.pct_apurado)}<br>Flávio ${fmtPct(pctC(r.p, "flavio"))} · Lula ${fmtPct(pctC(r.p, "lula"))}`),
    hoverinfo: "text", showscale: false,
  }], plotLayout({ margin: { l: 0, r: 0, t: 0, b: 0 }, geo: { fitbounds: "locations", visible: false, bgcolor: "rgba(0,0,0,0)" }, dragmode: false }), PLOT_CFG);
  const gd = $("g-mapa");
  if (!gd._clique) {
    gd._clique = true;
    gd.on("plotly_click", (ev) => {
      const uf = ev.points && ev.points[0] && String(ev.points[0].location).toLowerCase();
      if (uf && NOME_UF[uf]) selecionar({ regiao: UF_REG[uf] || null, uf, mun: null });
    });
  }
}

function linhaLider(p) {
  if (!dois(p)) return "–";
  const c = p.votos.flavio >= p.votos.lula ? CAND[0] : CAND[1];
  return `<span class="lider"><span class="sw" style="--c:var(${c.cor})"></span>${c.curto}</span>`;
}
function renderRestantes(projBR) {
  const t = $("t-restantes");
  if (!projBR) { t.innerHTML = "<tr><td>Carregando base do 1º turno…</td></tr>"; return; }
  const rows = linhasUF().map((r) => ({ ...r, falta: projBR.porUF[r.uf] ? projBR.porUF[r.uf].faltam : 0 })).sort((a, b) => b.falta - a.falta);
  t.innerHTML = `<thead><tr><th>Estado</th><th>Válidos restantes</th><th>Apurado</th><th>Líder</th><th>Margem</th></tr></thead><tbody>` +
    rows.map((r) => `<tr class="clica" data-uf="${r.uf}"><td>${NOME_UF[r.uf]}</td><td>${fmtInt(r.falta)}</td><td>${fmtPct(r.p.pct_apurado)}</td>
      <td>${linhaLider(r.p)}</td><td>${dois(r.p) ? fmtPP(Math.abs(margem(r.p))).replace("+", "") : "–"}</td></tr>`).join("") + "</tbody>";
}
function base1tDe(sel) {
  const lat1 = S.d.t1.latest;
  if (lat1) return pontoAtual(sel, lat1);
  if (!S.base) return null;
  const n = nivel(sel);
  if (n === "br") return S.base.br;
  if (n === "regiao") return somaPontos(REGIOES[sel.regiao].map((u) => S.base.uf[u]));
  if (n === "uf") return S.base.uf[sel.uf];
  const a = (S.base.mun[sel.uf] || {})[sel.mun];
  return a ? { votos: { flavio: a[2], lula: a[3] } } : null;
}
function render1T() {
  const t = $("t-1t");
  if (!S.base && !S.d.t1.latest) { t.innerHTML = "<tr><td>Carregando 1º turno…</td></tr>"; return; }
  const sels = [{ ...S.sel }];
  const n = nivel();
  if (n === "br") Object.keys(REGIOES).forEach((r) => sels.push({ regiao: r }));
  if (n === "br" || n === "regiao") ufsDoLocal().forEach((u) => sels.push({ regiao: UF_REG[u] || null, uf: u }));
  t.innerHTML = `<thead><tr><th>Local</th><th>Flávio 1º t.</th><th>Flávio agora</th><th>Variação</th></tr></thead><tbody>` +
    sels.map((sel) => {
      const f1 = shareF(base1tDe(sel)), f2 = shareF(pontoAtual(sel));
      return `<tr><td>${esc(nomeLocal(sel))}</td><td>${fmtPct(f1)}</td><td>${fmtPct(f2)}</td><td>${f1 != null && f2 != null ? fmtPP(f2 - f1) : "–"}</td></tr>`;
    }).join("") + "</tbody>";
}
function renderBNA(p) {
  if (!p || !p.comparecimento) { $("bna").innerHTML = `<div class="stat"><div class="sub">Aguardando votos.</div></div>`; return; }
  const apto = p.comparecimento + p.abst;
  const c = (rot, v, base, sub) => `<div class="stat"><div class="rot">${rot}</div><div class="val">${fmtPct(base ? (100 * v) / base : null)}</div><div class="sub">${fmtInt(v)} ${sub}</div></div>`;
  $("bna").innerHTML = c("Brancos", p.brancos, p.comparecimento, "· do comparecimento") + c("Nulos", p.nulos, p.comparecimento, "· do comparecimento") +
    c("Abstenção", p.abst, apto, "· do eleitorado apurado") + c("Comparecimento", p.comparecimento, apto, "eleitores");
}
function renderMunTabela() {
  const uf = S.sel.uf;
  const t = $("t-mun");
  if (!uf) { $("titulo-mun").textContent = "Municípios"; t.innerHTML = "<tr><td>Escolha um estado (no filtro ou no mapa) para ver os municípios.</td></tr>"; return; }
  $("titulo-mun").textContent = `Municípios – ${NOME_UF[uf]}`;
  const filtro = norm($("filtro-mun").value.trim());
  let rows = Object.entries(L().mun[uf] || {}).map(([cd, p]) => ({ cd, p, nome: nomeMun(uf, cd) }));
  if (filtro) rows = rows.filter((r) => norm(r.nome).includes(filtro));
  const { col, dir } = S.munSort;
  const val = { pct: (r) => r.p.pct_apurado, f: (r) => pctC(r.p, "flavio") ?? -1, l: (r) => pctC(r.p, "lula") ?? -1, lider: (r) => margem(r.p) ?? 0 }[col];
  rows.sort((a, b) => (col === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : val(a) - val(b)) * dir);
  const th = (c, txt) => `<th data-col="${c}">${txt}${col === c ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  t.innerHTML = `<thead><tr>${th("nome", "Município")}${th("pct", "Apurado")}${th("f", "Flávio")}${th("l", "Lula")}${th("lider", "Líder")}</tr></thead><tbody>` +
    rows.map((r) => `<tr class="clica" data-mun="${r.cd}"><td>${esc(r.nome)}</td><td>${fmtPct(r.p.pct_apurado)}</td><td>${fmtPct(pctC(r.p, "flavio"))}</td><td>${fmtPct(pctC(r.p, "lula"))}</td><td>${linhaLider(r.p)}</td></tr>`).join("") + "</tbody>";
}
function renderMeta() {
  const m = S.d[S.turno].meta || {};
  const st = $("status");
  const txt = { aguardando: "aguardando início", apurando: "apurando", finalizado: "totalização final", encerrado: "coleta encerrada" }[m.status] || "sem dados ainda";
  st.textContent = `${txt}${m.pct_apurado_br != null ? " · " + fmtPct(m.pct_apurado_br) : ""}`;
  st.className = `status ${m.status || ""}`;
  $("rod-atual").textContent = fmtHora(m.ultima_coleta);
  $("rod-tse").textContent = fmtHora(m.ultima_totalizacao_tse);
  $("turno-tag").textContent = T1() ? "1º turno · 04/10" : "2º turno · 25/10";
  document.body.classList.toggle("t1", T1());
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.turno === S.turno)));
}

let renderSeq = 0;
async function renderTudo() {
  renderMeta();
  syncCombos();
  $("titulo-local").textContent = nomeLocal();
  if (!L()) {
    $("placar").innerHTML = `<p class="nota">${T1() ? "Carregando 1º turno…" : "Ainda não há dados do 2º turno publicados pelo coletor. A apuração começa às 17h. Veja o 1º turno no botão acima."}</p>`;
    $("apurado").innerHTML = ""; $("stats").innerHTML = "";
    return;
  }
  const seq = ++renderSeq;
  const p = pontoAtual();
  const proj = projecaoLocal();
  renderPlacar(p, proj);
  renderMapa();
  renderFoto(p);
  renderBNA(p);
  renderPctPainel();
  renderMunTabela();
  if (T1()) return;
  renderRestantes(S.base ? projecaoMunicipios(UFS) : null);
  render1T();
  const serie = await carregaSerie();
  if (seq !== renderSeq || T1()) return;
  renderProjecao(renderEvolucao(serie), proj);
}

/* ---------- seletor ---------- */
let CB = {};
function syncCombos() {
  const { regiao, uf, mun } = S.sel;
  CB.regiao.set([{ v: "", label: "Brasil (todas)" }, ...Object.keys(REGIOES).map((r) => ({ v: r, label: NOME_REG[r] }))], regiao || "");
  const ufs = regiao ? REGIOES[regiao] : UFS;
  CB.uf.set([{ v: "", label: regiao ? `Todos – ${NOME_REG[regiao]}` : "Todos os estados" },
    ...ufs.map((u) => ({ v: u, label: NOME_UF[u], extra: u === "zz" ? "" : u.toUpperCase() }))], uf || "");
  const munOpts = [{ v: "", label: uf ? `Todos – ${NOME_UF[uf]}` : "Todos os municípios" }];
  for (const u of uf ? [uf] : ufs) {
    for (const [cd, nm] of Object.entries(S.municipios[u] || {})) munOpts.push({ v: `${u}-${cd}`, label: titulo(nm), extra: u === "zz" ? "Exterior" : u.toUpperCase() });
  }
  munOpts.sort((a, b) => (a.v === "" ? -1 : b.v === "" ? 1 : a.label.localeCompare(b.label, "pt-BR")));
  CB.mun.set(munOpts, mun ? `${uf}-${mun}` : "");
  $("chip-local").textContent = nomeLocal();
  const h = [S.turno === "t1" ? "t1" : "", nivel() === "regiao" ? `regiao-${regiao}` : nivel() === "uf" ? `uf-${uf}` : nivel() === "mun" ? `mun-${uf}-${mun}` : ""].filter(Boolean).join("/");
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}
function lerHash() {
  const partes = location.hash.replace("#", "").split("/");
  for (const parte of partes) {
    const [n, a, b] = parte.split("-");
    if (n === "t1") S.turno = "t1";
    else if (n === "regiao" && REGIOES[a]) S.sel = { regiao: a, uf: null, mun: null };
    else if (n === "uf" && NOME_UF[a]) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: null };
    else if (n === "mun" && NOME_UF[a] && b) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: b };
  }
}
function selecionar(mud) {
  Object.assign(S.sel, mud);
  renderTudo();
}
function montaSeletor() {
  CB.regiao = Combo($("cb-regiao"), { placeholder: "Buscar região…", onChange: (v) => selecionar({ regiao: v || null, uf: null, mun: null }) });
  CB.uf = Combo($("cb-uf"), { placeholder: "Buscar estado…", onChange: (v) => selecionar({ uf: v || null, mun: null, regiao: v ? UF_REG[v] || null : S.sel.regiao }) });
  CB.mun = Combo($("cb-mun"), {
    placeholder: "Buscar município…", limite: 400,
    onChange: (v) => {
      if (!v) return selecionar({ mun: null });
      const [u, cd] = v.split("-");
      selecionar({ regiao: UF_REG[u] || null, uf: u, mun: cd });
    },
  });
  $("btn-filtro").addEventListener("click", (e) => {
    const f = $("filtros"), abrir = f.hidden;
    f.hidden = !abrir;
    e.currentTarget.setAttribute("aria-expanded", String(abrir));
  });
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => trocaTurno(b.dataset.turno)));
  // fecha os popovers de filtro dos gráficos ao clicar fora
  document.addEventListener("click", (e) => document.querySelectorAll("details.ctrl[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
  $("n-pontos").addEventListener("change", renderTudo);
  $("ordem").addEventListener("change", (e) => { S.ordem = e.target.value; renderPctPainel(); });
  $("filtro-mun").addEventListener("input", renderMunTabela);
  $("t-mun").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (th) {
      const c = th.dataset.col;
      S.munSort = { col: c, dir: S.munSort.col === c ? -S.munSort.dir : c === "nome" ? 1 : -1 };
      return renderMunTabela();
    }
    const tr = e.target.closest("tr[data-mun]");
    if (tr) { selecionar({ mun: tr.dataset.mun }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("t-restantes").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-uf]");
    if (tr) { selecionar({ regiao: UF_REG[tr.dataset.uf] || null, uf: tr.dataset.uf, mun: null }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
}

/* ---------- tema ---------- */
function montaTema() {
  let salvo = null;
  try { salvo = localStorage.getItem("tema"); } catch (e) { /* sem storage */ }
  if (salvo) document.documentElement.dataset.theme = salvo;
  $("tema").addEventListener("click", () => {
    const novo = getComputedStyle(document.documentElement).colorScheme.includes("dark") ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("tema", novo); } catch (e) { /* sem storage */ }
    renderTudo();
  });
}

/* ---------- carga ---------- */
async function carregaT1() {
  if (S.d.t1.latest) return;
  const [latest, meta, cands] = await Promise.all([getJSON("latest.json", BASE_T1), getJSON("meta.json", BASE_T1), getJSON("candidatos.json", BASE_T1)]);
  Object.assign(S.d.t1, { latest, meta, cands });
}
async function trocaTurno(t) {
  S.turno = t;
  if (t === "t1") await carregaT1();
  renderTudo();
}
async function atualizar() {
  const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
  if (latest) S.d.t2.latest = latest;
  if (meta) S.d.t2.meta = meta;
  if (!T1()) await renderTudo();
}

async function iniciar() {
  if (TESTE) $("aviso-teste").hidden = false;
  montaTema();
  montaSeletor();
  lerHash();
  const hashT1 = S.turno === "t1";
  const [mun] = await Promise.all([getJSON("municipios.json"), atualizar()]);
  if (mun) S.municipios = mun;
  // Abre no 2º turno se já houver votos; senão mostra o 1º turno
  const br2 = S.d.t2.latest && S.d.t2.latest.br;
  if (hashT1 || !br2 || !(br2.pct_apurado > 0)) S.turno = "t1";
  if (S.turno === "t1") await carregaT1();
  renderTudo();
  Promise.all([getJSON("base_1t/br.json"), getJSON("base_1t/uf.json"), getJSON("base_1t/mun.json")]).then(([br, uf, m]) => {
    if (br && uf && m) { S.base = { br, uf, mun: m }; renderTudo(); }
  });
  fetch("https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@48ba05ad4c6969e3b3c25735492169227ae411f1/public/data/brazil-states.geojson")
    .then((r) => r.json()).then((g) => { S.geo = g; renderMapa(); }).catch(() => {});
  setInterval(atualizar, REFRESH_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();
