"use strict";
/* Painel de apuração – Presidente 2026 (1º e 2º turno). Sem build e sem biblioteca de gráficos:
   mapa e evolução em SVG próprio, para não capturar o toque/rolagem no celular. */

const QS = new URLSearchParams(location.search);
const TESTE = QS.get("fonte") === "teste";
// Em <owner>.github.io/<repo>/ descobre owner/repo sozinho; senão usa o padrão abaixo.
const OWNER_PADRAO = "olcinomartins", REPO_PADRAO = "apuracao-2026";
const OWNER = location.hostname.endsWith("github.io") ? location.hostname.split(".")[0] : OWNER_PADRAO;
const REPO = location.hostname.endsWith("github.io") ? (location.pathname.split("/")[1] || REPO_PADRAO) : REPO_PADRAO;
const BASE = QS.get("dados") || (TESTE ? "./data-test/" : `https://raw.githubusercontent.com/${OWNER}/${REPO}/data/`);
const BASE_T1 = QS.get("dados_t1") || (TESTE ? "./data-test/t1/" : `https://raw.githubusercontent.com/${OWNER}/${REPO}/data/t1/`);
const GEOJSON = "https://cdn.jsdelivr.net/gh/codeforgermany/click_that_hood@48ba05ad4c6969e3b3c25735492169227ae411f1/public/data/brazil-states.geojson";
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
// Mapa em grade: [linha, coluna] aproximando a posição de cada UF
const GRADE = {
  rr: [0, 2], ap: [0, 4],
  am: [1, 1], pa: [1, 3], ma: [1, 4], ce: [1, 5], rn: [1, 6],
  ac: [2, 0], ro: [2, 1], mt: [2, 2], to: [2, 3], pi: [2, 4], pe: [2, 5], pb: [2, 6],
  ms: [3, 2], go: [3, 3], df: [3, 4], ba: [3, 5], al: [3, 6],
  pr: [4, 3], sp: [4, 4], mg: [4, 5], se: [4, 6],
  sc: [5, 3], rj: [5, 5], es: [5, 6],
  rs: [6, 3], zz: [6, 6],
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
  municipios: {}, base: null, geo: null, geoPaths: null,
  series: {}, serieAtual: [],
  sel: { regiao: null, uf: null, mun: null },
  mapa: QS.get("mapa") || (matchMedia("(min-width: 760px)").matches ? "geo" : "grade"),
  ordem: "pct", munSort: { col: "pct", dir: -1 },
};

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nfP = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = { 0: nfP(0), 1: nfP(1), 2: nfP(2) };
const fmtInt = (x) => (x == null || isNaN(x) ? "–" : nf0.format(Math.round(x)));
const fmtPct = (x, d = 2) => (x == null || isNaN(x) ? "–" : NF[d].format(x) + "%");
const fmtPP = (x, d = 2) => (x == null || isNaN(x) ? "–" : NF[d].format(Math.abs(x)) + " p.p.");
const fmtHoraF = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtHora = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso.length <= 19 ? iso + "-03:00" : iso);
  return isNaN(d) ? iso : fmtHoraF.format(d);
};
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const titulo = (s) => String(s).toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
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
  const rotulo = el.dataset.label;
  el.innerHTML = `<button type="button" class="combo-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${rotulo} ${el.id}-lbl">
      <svg aria-hidden="true"><use href="#i-lupa"/></svg><span class="combo-lbl" id="${el.id}-lbl"></span><svg aria-hidden="true"><use href="#i-seta"/></svg></button>
    <div class="combo-pop" hidden><div class="combo-busca"><svg aria-hidden="true"><use href="#i-lupa"/></svg>
      <input type="search" name="${el.id}-busca" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" aria-label="${esc(placeholder)}"></div>
      <ul class="combo-lista" role="listbox" aria-labelledby="${rotulo}"></ul></div>`;
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
      (todos.length > vis.length ? `<li class="vazio">Mais ${fmtInt(todos.length - vis.length)}. Digite para filtrar…</li>` : "") +
      (!todos.length ? `<li class="vazio">Nada encontrado. Tente outro nome.</li>` : "");
  };
  const rolaAtivo = () => ul.querySelector(".ativo")?.scrollIntoView({ block: "nearest" });
  const abre = () => {
    pop.hidden = false; btn.setAttribute("aria-expanded", "true"); inp.value = "";
    ativo = Math.max(0, opts.findIndex((o) => o.v === valor)); desenha(); rolaAtivo();
    if (matchMedia("(pointer: fine)").matches) inp.focus();
  };
  const fecha = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const escolhe = (o) => { fecha(); if (o) { valor = o.v; lbl.textContent = o.label; onChange(o.v); } btn.focus(); };
  btn.addEventListener("click", () => (pop.hidden ? abre() : fecha()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); abre(); inp.focus(); } });
  inp.addEventListener("input", () => { ativo = 0; desenha(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { ativo = Math.min(vis.length - 1, ativo + 1); desenha(); rolaAtivo(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { ativo = Math.max(0, ativo - 1); desenha(); rolaAtivo(); e.preventDefault(); }
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

/* ---------- placar + indicadores ---------- */
function renderPlacar(p, proj) {
  const el = $("placar");
  if (!p) {
    el.innerHTML = `<div class="duelo"><p class="sub">Ainda não há votos apurados para este local.</p></div>`;
    $("kpis").innerHTML = ""; $("kpis2").innerHTML = "";
    return;
  }
  const [F, Lu] = CAND;
  const pf = pctC(p, "flavio"), pl = pctC(p, "lula");
  const outros = T1() && p.validos ? Math.max(0, 100 - (pf || 0) - (pl || 0)) : 0;
  const dif = p.votos.flavio - p.votos.lula;
  const lider = dif >= 0 ? F : Lu;
  const restantes = proj ? proj.faltam : null;
  const definido = !T1() && restantes != null && dois(p) > 0 && Math.abs(dif) > restantes;
  const lado = (c, pct, dir) => `<div class="lado ${dir ? "lado-dir" : ""}" style="--c:var(${c.cor})">
      <div class="lado-nome">${dir ? "" : `<span class="sw"></span>`}<span translate="no">${c.nome}</span>${dir ? `<span class="sw"></span>` : ""}</div>
      <div class="lado-pct">${dois(p) ? fmtPct(pct) : "–"}</div>
      <div class="lado-votos">${fmtInt(p.votos[c.k])} votos</div></div>`;
  el.innerHTML = `<div class="duelo"><div class="duelo-lados">${lado(F, pf, false)}${lado(Lu, pl, true)}</div>
    <div class="duelo-barra" role="img" aria-label="Flávio ${fmtPct(pf)}, Lula ${fmtPct(pl)}">
      <span style="--c:var(--flavio);width:${dois(p) ? pf : 0}%"></span>
      ${outros > 0 ? `<span style="--c:var(--outros);width:${outros}%"></span>` : ""}
      <span style="--c:var(--lula);width:${dois(p) ? pl : 0}%"></span></div>
    <p class="duelo-nota">${dois(p)
      ? `<b>${lider.curto}</b> à frente por <b>${fmtInt(Math.abs(dif))}</b> votos${definido ? `<span class="selo">Matematicamente definido</span>` : ""}`
      : "Aguardando os primeiros votos…"}${outros > 0 ? ` · outros candidatos ${fmtPct(outros, 1)}` : ""}</p></div>`;
  const kpi = (rot, val, sub, trilho) => `<div class="kpi"><div class="rot">${rot}</div><div class="val">${val}</div>
    ${trilho != null ? `<div class="trilho"><span style="width:${Math.min(100, trilho)}%"></span></div>` : ""}${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const apto = p.comparecimento + p.abst;
  $("kpis").innerHTML =
    kpi("Seções apuradas", fmtPct(p.pct_apurado), null, p.pct_apurado) +
    kpi("Diferença", dois(p) ? fmtPP(shareF(p) - shareL(p)) : "–", dois(p) ? `${lider.curto} na frente` : "") +
    (T1()
      ? kpi("Votos válidos", fmtInt(p.validos), "todos os candidatos")
      : kpi("Válidos a apurar", restantes == null ? "–" : fmtInt(restantes), "estimativa")) +
    kpi("Comparecimento", fmtPct(apto ? (100 * p.comparecimento) / apto : null, 1), `${fmtInt(p.comparecimento)} eleitores`);
  const k2 = (rot, v, base) => `<div class="kpi"><div class="rot">${rot}</div><div class="val">${fmtPct(base ? (100 * v) / base : null, 1)} <span class="meta">${fmtInt(v)}</span></div></div>`;
  $("kpis2").innerHTML = p.comparecimento
    ? k2("Abstenção", p.abst, apto) + k2("Brancos", p.brancos, p.comparecimento) + k2("Nulos", p.nulos, p.comparecimento) +
      `<div class="kpi"><div class="rot">Totalização TSE</div><div class="val">${fmtHora(p.tse)}</div></div>`
    : "";
}

/* ---------- mapa (SVG: grade, geográfico, recorte do Nordeste) ---------- */
function corUF(p) {
  const surf = cssVar("--surface");
  if (!p || !dois(p)) return cssVar("--sem");
  const m = margem(p), base = m >= 0 ? cssVar("--flavio") : cssVar("--lula");
  const t = Math.min(1, Math.abs(m) / 30);  // 0 p.p. = tom claro, 30+ p.p. = cor cheia
  return mix(base, surf, 0.7 - 0.7 * t);
}
function inkSobre(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#171717" : "#ffffff";
}
function projetaGeo(geo) {
  // Projeção equiretangular com correção de latitude média (suficiente para o Brasil)
  const k = Math.cos((-15 * Math.PI) / 180);
  const P = ([lon, lat]) => [(lon + 74) * k * 10, (6 - lat) * 10];
  const paths = {}, centro = {};
  for (const f of geo.features) {
    const uf = String(f.properties.sigla).toLowerCase();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = "", maior = null, area = -1;
    for (const poly of polys) {
      for (const ring of poly) {
        d += "M" + ring.map((c) => P(c).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
      }
      const xs = poly[0].map((c) => P(c)[0]), ys = poly[0].map((c) => P(c)[1]);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > area) { area = a; maior = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2]; }
    }
    paths[uf] = d; centro[uf] = maior;
  }
  // Estados pequenos do litoral: rótulo levemente para o mar (só aparecem no recorte do Nordeste)
  const desl = { rn: [3, 0], pb: [5, 0], al: [3, 1], se: [3, 0] };
  for (const [u, [dx, dy]] of Object.entries(desl)) if (centro[u]) centro[u] = [centro[u][0] + dx, centro[u][1] + dy];
  return { paths, centro, k, P };
}
function renderMapa() {
  const el = $("mapa");
  const lat = L();
  if (!lat) { el.innerHTML = ""; return; }
  const sel = new Set(nivel() === "br" ? [] : ufsDoLocal());
  document.querySelectorAll("[data-mapa]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mapa === S.mapa)));
  const dica = (uf) => {
    const p = lat.uf[uf];
    return `${NOME_UF[uf]}: ${p && dois(p) ? `Flávio ${fmtPct(pctC(p, "flavio"))}, Lula ${fmtPct(pctC(p, "lula"))}` : "sem votos"} · ${fmtPct(p ? p.pct_apurado : 0, 1)} apurado`;
  };
  const attrs = (uf) => `class="uf${sel.has(uf) ? " sel" : ""}" data-uf="${uf}" tabindex="0" role="button" aria-label="${esc(dica(uf))}"`;
  if (S.mapa === "grade" || !S.geoPaths) {
    const T = 52, G = 4;
    let h = "";
    for (const [uf, [r, c]] of Object.entries(GRADE)) {
      const p = lat.uf[uf], fill = corUF(p), ink = inkSobre(fill), x = c * (T + G), y = r * (T + G);
      const pct = p && dois(p) ? Math.max(pctC(p, "flavio"), pctC(p, "lula")) : null;
      h += `<g ${attrs(uf)}><title>${esc(dica(uf))}</title><rect x="${x}" y="${y}" width="${T}" height="${T}" rx="6" fill="${fill}"/>
        <text x="${x + T / 2}" y="${y + 22}" text-anchor="middle" font-size="14" font-weight="600" fill="${ink}">${uf === "zz" ? "EXT" : uf.toUpperCase()}</text>
        <text x="${x + T / 2}" y="${y + 39}" text-anchor="middle" font-size="11" fill="${ink}" opacity=".9">${pct == null ? "–" : NF[0].format(pct) + "%"}</text></g>`;
    }
    const W = 7 * (T + G) - G;
    el.innerHTML = `<svg viewBox="-2 -2 ${W + 4} ${W + 4}" role="group" aria-label="Mapa em grade dos estados">${h}</svg>`;
  } else {
    const { paths, centro } = S.geoPaths;
    const ne = S.mapa === "ne";
    const vb = ne ? "238 62 148 190" : "-5 -5 390 410";
    let h = "";
    // Selecionados por último, para o contorno ficar por cima dos vizinhos
    for (const uf of Object.keys(paths).sort((a, b) => sel.has(a) - sel.has(b))) {
      if (ne && !REGIOES.NE.includes(uf)) {
        h += `<path d="${paths[uf]}" fill="${cssVar("--raised")}" stroke="${cssVar("--surface")}" vector-effect="non-scaling-stroke"/>`;
        continue;
      }
      h += `<g ${attrs(uf)}><title>${esc(dica(uf))}</title><path d="${paths[uf]}" fill="${corUF(lat.uf[uf])}"/></g>`;
    }
    const rot = (ne ? REGIOES.NE : ["ac", "am", "rr", "ap", "pa", "ma", "to", "mt", "ms", "go", "pi", "ba", "mg", "sp", "pr", "rs", "ro"])
      .map((uf) => centro[uf] ? `<text class="geo-rot" x="${centro[uf][0]}" y="${centro[uf][1]}" text-anchor="middle" dominant-baseline="middle" ${ne ? 'style="font-size:6px;stroke-width:1.5px"' : ""}>${uf.toUpperCase()}</text>` : "").join("");
    el.innerHTML = `<svg viewBox="${vb}" role="group" aria-label="${ne ? "Mapa do Nordeste" : "Mapa do Brasil por estado"}">${h}${rot}</svg>`;
  }
}

/* ---------- evolução (SVG) ---------- */
function renderEvolucao(serie) {
  const el = $("g-evolucao");
  const pts = serie.filter((q) => q.pct_apurado > 0 && dois(q) > 0);
  const n = Math.max(3, Math.min(50, parseInt($("n-pontos").value, 10) || 10));
  const lin = projecaoLinear(serie, n);
  const W = Math.max(280, el.clientWidth || 600), H = W < 500 ? 200 : 260;
  const m = { l: 36, r: 12, t: 12, b: 28 };
  const ys = pts.flatMap((q) => [shareF(q), shareL(q)]).concat(lin ? [lin.flavio, lin.lula] : []);
  let lo = ys.length ? Math.min(...ys) : 40, hi = ys.length ? Math.max(...ys) : 60;
  const passo = hi - lo > 16 ? 5 : 2;
  lo = Math.max(0, Math.floor((Math.min(lo, 50) - 0.5) / passo) * passo);
  hi = Math.min(100, Math.ceil((Math.max(hi, 50) + 0.5) / passo) * passo);
  const X = (x) => m.l + (x / 100) * (W - m.l - m.r), Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * (H - m.t - m.b);
  const grid = cssVar("--grid"), ink = cssVar("--muted");
  let h = "";
  for (let y = lo; y <= hi + 1e-9; y += passo) h += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="${grid}" ${y === 50 ? 'stroke-width="1.5"' : ""}/><text x="${m.l - 6}" y="${Y(y) + 4}" text-anchor="end">${y}%</text>`;
  for (const x of [0, 25, 50, 75, 100]) h += `<text x="${X(x)}" y="${H - 8}" text-anchor="${x === 0 ? "start" : x === 100 ? "end" : "middle"}">${x}%</text>`;
  const linha = (f, cor) => pts.length ? `<polyline fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" points="${pts.map((q) => `${X(q.pct_apurado).toFixed(1)},${Y(f(q)).toFixed(1)}`).join(" ")}"/>` : "";
  const cF = cssVar("--flavio"), cL = cssVar("--lula");
  if (lin && lin.x0 < 100) {
    h += `<line x1="${X(lin.x0)}" y1="${Y(50 + lin.margemX0 / 2)}" x2="${X(100)}" y2="${Y(lin.flavio)}" stroke="${cF}" stroke-width="2" stroke-dasharray="5 4"/>`;
    h += `<line x1="${X(lin.x0)}" y1="${Y(50 - lin.margemX0 / 2)}" x2="${X(100)}" y2="${Y(lin.lula)}" stroke="${cL}" stroke-width="2" stroke-dasharray="5 4"/>`;
  }
  let virada = null;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.sign(margem(pts[i - 1])), b = Math.sign(margem(pts[i]));
    if (a && b && a !== b) virada = { x: pts[i].pct_apurado, quem: b > 0 ? "Flávio" : "Lula", ts: pts[i].tse || pts[i].ts };
  }
  if (virada) h += `<line x1="${X(virada.x)}" x2="${X(virada.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${ink}" stroke-dasharray="2 3"/><text x="${X(virada.x) + 4}" y="${m.t + 10}">virada</text>`;
  h += linha(shareF, cF) + linha(shareL, cL);
  if (pts.length) {
    const u = pts[pts.length - 1];
    h += `<text x="${Math.min(X(u.pct_apurado) + 6, W - m.r - 40)}" y="${Y(shareF(u)) - 6}" fill="${cF}" style="fill:${cF}">Flávio</text>`;
    h += `<text x="${Math.min(X(u.pct_apurado) + 6, W - m.r - 40)}" y="${Y(shareL(u)) + 14}" style="fill:${cL}">Lula</text>`;
  }
  h += `<g id="cursor" visibility="hidden"><line y1="${m.t}" y2="${H - m.b}" stroke="${ink}"/><circle r="4" fill="${cF}"/><circle r="4" fill="${cL}"/></g>`;
  h += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="alvo"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Evolução da % dos válidos de cada candidato conforme a apuração">${h}</svg><div class="dica" hidden></div>`;
  $("virada").textContent = virada
    ? `Virada: ${virada.quem} passou à frente com ${fmtPct(virada.x, 1)} apurado (${fmtHora(virada.ts)}).`
    : pts.length ? "Sem virada até agora." : "Aguardando os primeiros votos…";
  // Dica no toque/clique e no hover do mouse; nunca impede a rolagem (touch-action: pan-y, sem preventDefault)
  const svg = el.querySelector("svg"), dicaEl = el.querySelector(".dica"), cur = svg.querySelector("#cursor");
  const mostra = (ev) => {
    if (!pts.length) return;
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const alvo = ((x - m.l) / (W - m.l - m.r)) * 100;
    let q = pts[0];
    for (const p of pts) if (Math.abs(p.pct_apurado - alvo) < Math.abs(q.pct_apurado - alvo)) q = p;
    const cx = X(q.pct_apurado);
    cur.setAttribute("visibility", "visible");
    cur.querySelector("line").setAttribute("x1", cx); cur.querySelector("line").setAttribute("x2", cx);
    const [c1, c2] = cur.querySelectorAll("circle");
    c1.setAttribute("cx", cx); c1.setAttribute("cy", Y(shareF(q))); c2.setAttribute("cx", cx); c2.setAttribute("cy", Y(shareL(q)));
    dicaEl.hidden = false;
    dicaEl.innerHTML = `${fmtHora(q.tse || q.ts)} · ${fmtPct(q.pct_apurado, 1)} apurado<br>Flávio ${fmtPct(shareF(q))} · Lula ${fmtPct(shareL(q))}`;
    const px = (cx / W) * r.width;
    dicaEl.style.left = Math.min(Math.max(0, px - dicaEl.offsetWidth / 2), r.width - dicaEl.offsetWidth) + "px";
    dicaEl.style.top = "-6px";
  };
  svg.addEventListener("click", mostra);
  svg.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") mostra(ev); });
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") { dicaEl.hidden = true; cur.setAttribute("visibility", "hidden"); } });
  return lin;
}

/* ---------- blocos ---------- */
function renderCandidatos(p) {
  if (!T1() || !p) return;
  let linhas;
  if (p.cand && S.d.t1.cands) {
    const corDe = (n) => (n === "22" ? "--flavio" : n === "13" ? "--lula" : "--outros");
    linhas = S.d.t1.cands.map((c) => ({ nome: titulo(c.nome), cor: corDe(c.n), v: p.cand[c.n] || 0 }))
      .sort((a, b) => b.v - a.v).map((c) => ({ ...c, pct: p.validos ? (100 * c.v) / p.validos : 0 }));
  } else {
    linhas = CAND.map((c) => ({ nome: c.curto, cor: c.cor, v: p.votos[c.k], pct: pctC(p, c.k) || 0 }));
  }
  const max = Math.max(...linhas.map((l) => l.pct), 1);
  $("cands").innerHTML = linhas.map((c) => `<div class="linha-barra" style="--c:var(${c.cor})"><span class="lb-nome" translate="no" title="${esc(c.nome)}">${esc(c.nome)}</span>
      <span class="lb-trilho"><span style="width:${(100 * c.pct) / max}%"></span></span>
      <span class="lb-val"><b>${fmtPct(c.pct)}</b> ${fmtInt(c.v)}</span></div>`).join("");
  $("cands-hora").textContent = `% dos votos válidos. Totalização do TSE: ${fmtHora(p.tse)}.`;
}

function renderProjecao(lin, proj) {
  const item = (titulo, f, l, nota) => {
    const tot = f + l;
    return `<div class="proj-item"><div class="rot">${titulo}</div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--flavio)"></span>Flávio</span><b>${fmtPct(tot ? (100 * f) / tot : null)}</b></div>
      <div class="proj-linha"><span><span class="sw" style="--c:var(--lula)"></span>Lula</span><b>${fmtPct(tot ? (100 * l) / tot : null)}</b></div>
      <p class="sub">${nota}</p></div>`;
  };
  let h = lin ? item("Linear", lin.flavio, lin.lula, `Margem projetada de ${fmtPP(lin.margem100)} para ${lin.margem100 >= 0 ? "Flávio" : "Lula"}.`)
    : `<div class="proj-item"><div class="rot">Linear</div><p class="sub">Precisa de pelo menos 3 atualizações com votos.</p></div>`;
  if (proj) {
    const m = proj.flavio + proj.lula ? (100 * (proj.flavio - proj.lula)) / (proj.flavio + proj.lula) : 0;
    h += item("Ponderada", proj.flavio, proj.lula, `Margem de ${fmtPP(m)} para ${m >= 0 ? "Flávio" : "Lula"}, com ${fmtInt(proj.faltam)} válidos ainda a apurar.`);
  } else h += `<div class="proj-item"><div class="rot">Ponderada</div><p class="sub">Carregando a base do 1º turno…</p></div>`;
  $("projecao").innerHTML = h;
}

function linhaLider(p) {
  if (!dois(p)) return "–";
  const c = p.votos.flavio >= p.votos.lula ? CAND[0] : CAND[1];
  return `<span class="lider"><span class="sw" style="--c:var(${c.cor})"></span>${c.curto}</span>`;
}
function renderListaUF() {
  const lat = L();
  const pr = !T1() && S.base ? projecaoMunicipios(UFS) : null;
  let rows = UFS.map((uf) => ({ uf, p: lat.uf[uf], falta: pr && pr.porUF[uf] ? pr.porUF[uf].faltam : null })).filter((r) => r.p);
  const ord = {
    pct: (a, b) => b.p.pct_apurado - a.p.pct_apurado,
    nome: (a, b) => NOME_UF[a.uf].localeCompare(NOME_UF[b.uf], "pt-BR"),
    margem: (a, b) => (margem(b.p) ?? 0) - (margem(a.p) ?? 0),
    restante: (a, b) => (b.falta ?? 0) - (a.falta ?? 0),
  }[S.ordem];
  rows.sort(ord);
  $("lista-uf").innerHTML = rows.map((r) => {
    const cor = !dois(r.p) ? "--sem" : r.p.votos.flavio >= r.p.votos.lula ? "--flavio" : "--lula";
    const extra = S.ordem === "restante" && r.falta != null ? `${fmtInt(r.falta)} a apurar` : dois(r.p) ? `${linhaLider(r.p).replace(/<[^>]+>/g, "")} +${NF[1].format(Math.abs(margem(r.p)))}` : "sem votos";
    return `<button type="button" class="linha-barra" data-uf="${r.uf}" style="--c:var(${cor})">
      <span class="lb-nome"><span class="sw"></span>${NOME_UF[r.uf]}</span>
      <span class="lb-trilho"><span style="width:${r.p.pct_apurado}%"></span></span>
      <span class="lb-val"><b>${fmtPct(r.p.pct_apurado, 1)}</b> ${esc(extra)}</span></button>`;
  }).join("");
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
  if (!S.base && !S.d.t1.latest) { t.innerHTML = "<tr><td>Carregando o 1º turno…</td></tr>"; return; }
  const sels = [{ ...S.sel }];
  const n = nivel();
  if (n === "br") Object.keys(REGIOES).forEach((r) => sels.push({ regiao: r }));
  if (n === "br" || n === "regiao") ufsDoLocal().forEach((u) => sels.push({ regiao: UF_REG[u] || null, uf: u }));
  t.innerHTML = `<thead><tr><th>Local</th><th>Flávio no 1º turno</th><th>Flávio agora</th><th>Variação</th></tr></thead><tbody>` +
    sels.map((sel) => {
      const f1 = shareF(base1tDe(sel)), f2 = shareF(pontoAtual(sel));
      const v = f1 != null && f2 != null ? f2 - f1 : null;
      return `<tr><td>${esc(nomeLocal(sel))}</td><td>${fmtPct(f1)}</td><td>${fmtPct(f2)}</td><td>${v == null ? "–" : (v >= 0 ? "+" : "−") + fmtPP(v)}</td></tr>`;
    }).join("") + "</tbody>";
}

function renderMunTabela() {
  const uf = S.sel.uf;
  const t = $("t-mun");
  $("filtro-mun").parentElement.hidden = !uf;
  if (!uf) { $("titulo-mun").textContent = "Municípios"; $("meta-mun").textContent = "escolha um estado"; t.innerHTML = "<tr><td>Escolha um estado no filtro ou toque nele no mapa.</td></tr>"; return; }
  $("titulo-mun").textContent = `Municípios de ${NOME_UF[uf]}`;
  const filtro = norm($("filtro-mun").value.trim());
  let rows = Object.entries(L().mun[uf] || {}).map(([cd, p]) => ({ cd, p, nome: nomeMun(uf, cd) }));
  $("meta-mun").textContent = `${fmtInt(rows.length)} municípios`;
  if (filtro) rows = rows.filter((r) => norm(r.nome).includes(filtro));
  const { col, dir } = S.munSort;
  const val = { pct: (r) => r.p.pct_apurado, f: (r) => pctC(r.p, "flavio") ?? -1, l: (r) => pctC(r.p, "lula") ?? -1, lider: (r) => margem(r.p) ?? 0 }[col];
  rows.sort((a, b) => (col === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : val(a) - val(b)) * dir);
  const th = (c, txt) => `<th aria-sort="${col === c ? (dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-col="${c}">${txt}${col === c ? (dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  t.innerHTML = `<thead><tr>${th("nome", "Município")}${th("pct", "Apurado")}${th("f", "Flávio")}${th("l", "Lula")}${th("lider", "Líder")}</tr></thead><tbody>` +
    (rows.length ? rows.map((r) => `<tr class="clica" data-mun="${r.cd}"><td>${esc(r.nome)}</td><td>${fmtPct(r.p.pct_apurado, 1)}</td><td>${fmtPct(pctC(r.p, "flavio"), 1)}</td><td>${fmtPct(pctC(r.p, "lula"), 1)}</td><td>${linhaLider(r.p)}</td></tr>`).join("")
      : `<tr><td colspan="5">Nenhum município com esse nome.</td></tr>`) + "</tbody>";
}

function renderMeta() {
  const m = S.d[S.turno].meta || {};
  const st = $("status");
  const txt = { aguardando: "Aguardando o início", apurando: "Apurando", finalizado: "Totalização final", encerrado: "Coleta encerrada" }[m.status] || (T1() ? "Carregando…" : "Sem dados ainda");
  st.textContent = `${txt}${m.pct_apurado_br ? " · " + fmtPct(m.pct_apurado_br) : ""}`;
  st.className = `status ${m.status || ""}`;
  $("rod-atual").textContent = fmtHora(m.ultima_coleta);
  $("rod-tse").textContent = fmtHora(m.ultima_totalizacao_tse);
  $("turno-tag").textContent = T1() ? "1º turno, 4 de outubro" : "2º turno, 25 de outubro";
  document.body.classList.toggle("t1", T1());
  document.querySelectorAll("[data-turno]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.turno === S.turno)));
}

let renderSeq = 0;
async function renderTudo() {
  renderMeta();
  syncCombos();
  $("titulo-local").textContent = nomeLocal();
  if (!L()) {
    $("placar").innerHTML = `<div class="duelo"><p class="sub">${T1() ? "Carregando o 1º turno…" : "O 2º turno ainda não tem votos publicados. A apuração começa às 17h; enquanto isso, veja o 1º turno."}</p></div>`;
    $("kpis").innerHTML = ""; $("kpis2").innerHTML = "";
    return;
  }
  const seq = ++renderSeq;
  const p = pontoAtual();
  const proj = projecaoLocal();
  renderPlacar(p, proj);
  renderMapa();
  renderCandidatos(p);
  renderListaUF();
  renderMunTabela();
  if (T1()) return;
  render1T();
  const serie = await carregaSerie();
  if (seq !== renderSeq || T1()) return;
  S.serieAtual = serie;
  renderProjecao(renderEvolucao(serie), proj);
}

/* ---------- seletor ---------- */
const CB = {};
function syncCombos() {
  const { regiao, uf, mun } = S.sel;
  CB.regiao.set([{ v: "", label: "Brasil (todas)" }, ...Object.keys(REGIOES).map((r) => ({ v: r, label: NOME_REG[r] }))], regiao || "");
  const ufs = regiao ? REGIOES[regiao] : UFS;
  CB.uf.set([{ v: "", label: regiao ? `Todos do ${NOME_REG[regiao]}` : "Todos os estados" },
    ...ufs.map((u) => ({ v: u, label: NOME_UF[u], extra: u === "zz" ? "" : u.toUpperCase() }))], uf || "");
  const munOpts = [];
  for (const u of uf ? [uf] : ufs) {
    for (const [cd, nm] of Object.entries(S.municipios[u] || {})) munOpts.push({ v: `${u}-${cd}`, label: titulo(nm), extra: u === "zz" ? "Exterior" : u.toUpperCase() });
  }
  munOpts.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  CB.mun.set([{ v: "", label: uf ? `Todos de ${NOME_UF[uf]}` : "Todos os municípios" }, ...munOpts], mun ? `${uf}-${mun}` : "");
  const h = [T1() ? "t1" : "", nivel() === "regiao" ? `regiao-${regiao}` : nivel() === "uf" ? `uf-${uf}` : nivel() === "mun" ? `mun-${uf}-${mun}` : ""].filter(Boolean).join("/");
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}
function lerHash() {
  for (const parte of location.hash.replace("#", "").split("/")) {
    const [n, a, b] = parte.split("-");
    if (n === "t1") S.turno = "t1";
    else if (n === "regiao" && REGIOES[a]) S.sel = { regiao: a, uf: null, mun: null };
    else if (n === "uf" && NOME_UF[a]) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: null };
    else if (n === "mun" && NOME_UF[a] && b) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: b };
  }
}
function selecionar(mud, rolar) {
  Object.assign(S.sel, mud);
  renderTudo();
  if (rolar) $("titulo-local").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
const selUF = (uf, rolar) => selecionar({ regiao: UF_REG[uf] || null, uf, mun: null }, rolar);

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
    const abrir = $("filtros").hidden;
    $("filtros").hidden = !abrir;
    e.currentTarget.setAttribute("aria-expanded", String(abrir));
  });
  document.querySelectorAll("[data-turno]").forEach((b) => b.addEventListener("click", () => trocaTurno(b.dataset.turno)));
  document.querySelectorAll("[data-mapa]").forEach((b) => b.addEventListener("click", () => { S.mapa = b.dataset.mapa; renderMapa(); }));
  // Toque/clique numa UF do mapa (delegado; o SVG é redesenhado a cada atualização)
  const mapa = $("mapa");
  mapa.addEventListener("click", (e) => { const g = e.target.closest("[data-uf]"); if (g) selUF(g.dataset.uf, true); });
  mapa.addEventListener("keydown", (e) => { const g = e.target.closest("[data-uf]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selUF(g.dataset.uf, true); } });
  document.addEventListener("click", (e) => document.querySelectorAll("details.ctrl[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
  $("n-pontos").addEventListener("change", () => renderProjecao(renderEvolucao(S.serieAtual), projecaoLocal()));
  $("ordem").addEventListener("change", (e) => { S.ordem = e.target.value; renderListaUF(); });
  $("lista-uf").addEventListener("click", (e) => { const b = e.target.closest("[data-uf]"); if (b) selUF(b.dataset.uf, true); });
  $("filtro-mun").addEventListener("input", renderMunTabela);
  $("t-mun").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-col]");
    if (b) {
      const c = b.dataset.col;
      S.munSort = { col: c, dir: S.munSort.col === c ? -S.munSort.dir : c === "nome" ? 1 : -1 };
      return renderMunTabela();
    }
    const tr = e.target.closest("tr[data-mun]");
    if (tr) selecionar({ mun: tr.dataset.mun }, true);
  });
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!T1() && S.serieAtual) renderEvolucao(S.serieAtual); }, 200); });
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
  if (t === "t1") { renderTudo(); await carregaT1(); }
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
  S.turno = "t2";
  const [mun] = await Promise.all([getJSON("municipios.json"), (async () => {
    const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
    Object.assign(S.d.t2, { latest, meta });
  })()]);
  if (mun) S.municipios = mun;
  // Abre no 2º turno se já houver votos; senão mostra o 1º turno
  const br2 = S.d.t2.latest && S.d.t2.latest.br;
  S.turno = hashT1 || !br2 || !(br2.pct_apurado > 0) ? "t1" : "t2";
  if (S.turno === "t1") await carregaT1();
  renderTudo();
  Promise.all([getJSON("base_1t/br.json"), getJSON("base_1t/uf.json"), getJSON("base_1t/mun.json")]).then(([br, uf, m]) => {
    if (br && uf && m) { S.base = { br, uf, mun: m }; if (!T1()) renderTudo(); }
  });
  fetch(GEOJSON).then((r) => r.json()).then((g) => { S.geoPaths = projetaGeo(g); renderMapa(); }).catch(() => { S.mapa = "grade"; });
  setInterval(atualizar, REFRESH_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();
