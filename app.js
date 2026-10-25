"use strict";
/* Painel de apuração – Presidente 2026. Sem build e sem biblioteca de gráficos.
   Duas visões (Geral / Por região), cada uma um carrossel de 3 telas: Apuração, Projeção, Histórico. */

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
// Versão publicada; muda a cada deploy junto com versao.txt e os ?v= do index.html
const VERSAO = "20261025182131";

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
  { k: "flavio", nome: "Flávio Bolsonaro", curto: "Flávio", partido: "PL", cor: "--flavio" },
  { k: "lula", nome: "Lula", curto: "Lula", partido: "PT", cor: "--lula" },
];
// Estados pequenos do litoral: rótulo fora do mapa, com linha guia
const CHAMADAS = ["rn", "pb", "pe", "al", "se", "es", "rj"];

const S = {
  turno: "t2", modo: "geral",
  d: { t2: { latest: null, meta: null }, t1: { latest: null, meta: null, cands: null } },
  municipios: {}, base: null, geo: null, series: {},
  sel: { regiao: null, uf: null, mun: null },
};

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtInt = (x) => (x == null || isNaN(x) ? "–" : nf0.format(Math.round(x)));
// Compacto para tabelas no celular: 9.632.309 → "9,63 mi"; 563.412 → "563 mil"
const fmtCurto = (x) => {
  if (x == null || isNaN(x)) return "–";
  const a = Math.abs(x);
  if (a >= 1e6) return NF[a >= 1e7 ? 1 : 2].format(x / 1e6) + " mi";
  if (a >= 1e4) return nf0.format(x / 1e3) + " mil";
  return nf0.format(x);
};
const num = (x) => `<span title="${fmtInt(x)}">${fmtCurto(x)}</span>`;
const fmtPct = (x, d = 2) => (x == null || isNaN(x) ? "–" : NF[d].format(x) + "%");
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
const corLider = (p) => (!dois(p) ? "--sem" : p.votos.flavio >= p.votos.lula ? "--flavio" : "--lula");

/* ---------- local selecionado ---------- */
function nivel(sel = S.sel) {
  if (sel.mun) return "mun";
  if (sel.uf) return "uf";
  if (sel.regiao) return "regiao";
  return "br";
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
function seriePath(sel) {
  const n = nivel(sel);
  if (n === "br") return "series/br.json";
  if (n === "regiao") return `series/regiao/${sel.regiao}.json`;
  return n === "uf" ? `series/uf/${sel.uf}.json` : `series/mun/${sel.uf}.json`;
}
const lidoEm = {};
async function carregaSerie(sel) {
  const path = seriePath(sel);
  if (!S.series[path] || (lidoEm[path] || 0) < Date.now() - 50000) {
    const d = await getJSON(path);
    if (d) { S.series[path] = d; lidoEm[path] = Date.now(); }
  }
  const s = S.series[path];
  if (!s) return [];
  return nivel(sel) === "mun" ? s[sel.mun] || [] : s;
}

/* ---------- unidades (os "pedaços" do local) e base do 1º turno ---------- */
function base1t(sel) {
  if (!S.base) return null;
  const n = nivel(sel);
  const dePonto = (p) => (p ? { te: p.eleitorado, c: p.comparecimento, f: p.votos.flavio, l: p.votos.lula, vv: p.validos } : null);
  if (n === "uf") return dePonto(S.base.uf[sel.uf]);
  if (n === "regiao") {
    const ps = REGIOES[sel.regiao].map((u) => S.base.uf[u]).filter(Boolean);
    return ps.reduce((a, p) => ({ te: a.te + p.eleitorado, c: a.c + p.comparecimento, f: a.f + p.votos.flavio, l: a.l + p.votos.lula, vv: a.vv + p.validos }), { te: 0, c: 0, f: 0, l: 0, vv: 0 });
  }
  if (n === "br") return dePonto(S.base.br);
  const a = (S.base.mun[sel.uf] || {})[sel.mun];
  return a ? { te: a[0], c: a[1], f: a[2], l: a[3], vv: a[4] } : null;
}
// Geral: projeção somada sobre estados (Brasil/região) ou municípios (estado).
// Por região: as linhas mostradas são regiões (Brasil), estados (região) ou municípios (estado).
function unidades(sel, paraRegiao) {
  const n = nivel(sel);
  if (n === "br" && paraRegiao) return [...Object.keys(REGIOES).map((r) => ({ regiao: r, uf: null, mun: null })), { regiao: null, uf: "zz", mun: null }];
  if (n === "br") return UFS.map((u) => ({ regiao: UF_REG[u] || null, uf: u, mun: null }));
  if (n === "regiao") return REGIOES[sel.regiao].map((u) => ({ regiao: sel.regiao, uf: u, mun: null }));
  if (n === "uf") {
    const cds = new Set([...Object.keys((L() && L().mun[sel.uf]) || {}), ...Object.keys((S.base && S.base.mun[sel.uf]) || {})]);
    return [...cds].map((cd) => ({ regiao: sel.regiao, uf: sel.uf, mun: cd }));
  }
  return [{ ...sel }];
}

/* ---------- projeção ponderada pelo eleitorado ----------
   Em cada unidade, o percentual atual de cada candidato vale até o fim e é aplicado ao total de votos que
   ela deve ter: eleitorado × comparecimento (o observado até agora; sem dados, o do 1º turno) × fração
   de votos válidos. Unidade sem nenhum voto apurado usa a divisão Flávio/Lula do 1º turno. */
function projetaUnidade(sel) {
  const p = pontoAtual(sel), b = base1t(sel);
  const pct = p ? p.pct_apurado : 0;
  const te = (p && p.eleitorado) || (b ? b.te : 0);
  let comp;
  if (p && pct > 0 && p.eleitorado && p.comparecimento) comp = Math.min(1, p.comparecimento / (p.eleitorado * pct / 100));
  else if (b && b.te) comp = b.c / b.te;
  else comp = 0.79;
  let valid;
  if (p && p.comparecimento && dois(p)) valid = dois(p) / p.comparecimento;
  else if (b && b.c) valid = b.vv / b.c;
  else valid = 0.95;
  const apur = dois(p);
  const esperado = Math.max(apur, te * comp * valid);
  let share, fonte;
  if (apur) { share = p.votos.flavio / apur; fonte = "atual"; }
  else if (b && b.f + b.l) { share = b.f / (b.f + b.l); fonte = "1º turno"; }
  else { share = 0.5; fonte = "sem dados"; }
  return { sel, p, pct, esperado, apur, falta: esperado - apur, flavio: esperado * share, lula: esperado * (1 - share), share, fonte };
}
function projecao(sel, paraRegiao) {
  const us = unidades(sel, paraRegiao);
  const linhas = us.map((u) => {
    // Regiões somam as projeções dos seus estados (mesmo método, na granularidade estadual)
    if (paraRegiao && nivel(sel) === "br" && u.regiao && !u.uf) {
      const filhos = REGIOES[u.regiao].map((uf) => projetaUnidade({ regiao: u.regiao, uf, mun: null }));
      const t = filhos.reduce((a, x) => ({ esperado: a.esperado + x.esperado, apur: a.apur + x.apur, flavio: a.flavio + x.flavio, lula: a.lula + x.lula }), { esperado: 0, apur: 0, flavio: 0, lula: 0 });
      const p = pontoAtual(u);
      return { sel: u, p, pct: p ? p.pct_apurado : 0, ...t, falta: t.esperado - t.apur, share: t.flavio / (t.esperado || 1), fonte: "estados" };
    }
    return projetaUnidade(u);
  });
  const tot = linhas.reduce((a, x) => ({ esperado: a.esperado + x.esperado, apur: a.apur + x.apur, flavio: a.flavio + x.flavio, lula: a.lula + x.lula }), { esperado: 0, apur: 0, flavio: 0, lula: 0 });
  tot.falta = tot.esperado - tot.apur;
  return { linhas, tot };
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

/* ---------- blocos reutilizáveis ---------- */
function blocoCandidatos(p, proj) {
  // proj: {flavio, lula} → mostra a estimativa em vez da apuração
  const linhas = CAND.map((c) => {
    let pct, votos;
    if (proj) { pct = (100 * proj[c.k]) / (proj.flavio + proj.lula || 1); votos = proj[c.k]; }
    else { pct = pctC(p, c.k); votos = p ? p.votos[c.k] : 0; }
    return { ...c, pct, votos };
  }).sort((a, b) => (b.pct || 0) - (a.pct || 0));
  const max = Math.max(60, ...linhas.map((l) => l.pct || 0));
  let h = linhas.map((c) => `<div class="cand" style="--c:var(${c.cor})">
      <div class="cand-nome" translate="no"><span class="sw"></span>${c.nome} <small>${c.partido}</small></div>
      <div class="cand-linha"><div class="cand-trilho"><span style="width:${((c.pct || 0) / max) * 100}%"></span></div>
      <div class="cand-pct">${c.pct == null ? "–" : fmtPct(c.pct)}</div></div>
      <div class="cand-votos">${fmtInt(c.votos)} votos${proj ? " estimados" : ""}</div></div>`).join("");
  if (!proj && T1() && p && p.validos) {
    const out = Math.max(0, 100 - (pctC(p, "flavio") || 0) - (pctC(p, "lula") || 0));
    h += `<div class="cand" style="--c:var(--outros)"><div class="cand-nome"><span class="sw"></span>Outros candidatos</div>
      <div class="cand-linha"><div class="cand-trilho"><span style="width:${(out / max) * 100}%"></span></div><div class="cand-pct">${fmtPct(out)}</div></div>
      <div class="cand-votos">${fmtInt(p.validos - dois(p))} votos</div></div>`;
  }
  // No celular: os dois lado a lado e uma barra dividida (o CSS escolhe qual mostrar)
  const [a, b] = linhas;
  const tot = (a.pct || 0) + (b.pct || 0);
  const duelo = `<div class="duelo-m" aria-hidden="true"><div class="duelo-lados">
      <div style="--c:var(${a.cor})"><small>${a.curto}</small><b>${a.pct == null ? "–" : fmtPct(a.pct)}</b></div>
      <div style="--c:var(${b.cor})"><small>${b.curto}</small><b>${b.pct == null ? "–" : fmtPct(b.pct)}</b></div></div>
    <div class="duelo-barra">${tot ? `<span style="--c:var(${a.cor});width:${a.pct}%"></span><span style="--c:var(${b.cor});width:${b.pct}%"></span>` : ""}</div></div>`;
  return `<div class="cands">${h}</div>${duelo}`;
}
function achado(p, pr, serie) {
  if (!p || !dois(p)) return T1() ? "" : "A apuração começa às 17h. Até lá, veja o 1º turno no filtro.";
  const F = p.votos.flavio >= p.votos.lula;
  const lider = F ? "Flávio" : "Lula", outro = F ? "Lula" : "Flávio";
  const dif = Math.abs(p.votos.flavio - p.votos.lula);
  if (T1()) return `${lider} terminou na frente, ${fmtInt(dif)} votos à frente de ${outro}.`;
  if (p.pct_apurado >= 100) return `${lider} venceu aqui por ${fmtInt(dif)} votos.`;
  if (pr && dif > pr.tot.falta) return `<span class="selo">Matematicamente definido</span> A vantagem de ${lider} (${fmtInt(dif)} votos) supera os cerca de ${fmtInt(pr.tot.falta)} que faltam.`;
  let virada = null;
  const pts = (serie || []).filter((q) => dois(q));
  for (let i = 1; i < pts.length; i++) if (Math.sign(margem(pts[i - 1])) * Math.sign(margem(pts[i])) < 0) virada = pts[i];
  if (virada) return `${lider} virou com ${fmtPct(virada.pct_apurado, 1)} apurado e lidera por ${fmtInt(dif)} votos.`;
  return `${lider} lidera por ${fmtInt(dif)} votos${pr ? `; faltam cerca de ${fmtInt(pr.tot.falta)} votos válidos` : ""}.`;
}
function indicadores(p) {
  if (!p) return "";
  const bn = p.comparecimento ? (100 * (p.brancos + p.nulos)) / p.comparecimento : null;
  const dif = Math.abs(p.votos.flavio - p.votos.lula);
  return `<div class="indic"><div><small>Urnas apuradas</small><b>${fmtPct(p.pct_apurado)}</b></div>
    <div><small>Diferença</small><b>${dois(p) ? fmtInt(dif) : "–"}</b></div>
    <div><small>Brancos e nulos</small><b>${fmtPct(bn)}</b></div></div>`;
}

/* ---------- mapa do Brasil (SVG) ---------- */
function centroide(ring, P) {
  let a = 0, cx = 0, cy = 0;
  const pts = ring.map(P);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
  }
  return a ? [cx / (3 * a), cy / (3 * a), Math.abs(a / 2)] : [pts[0][0], pts[0][1], 0];
}
function projetaGeo(geo) {
  const k = Math.cos((-15 * Math.PI) / 180);
  const P = ([lon, lat]) => [(lon + 74) * k * 10, (6 - lat) * 10];
  const paths = {}, centro = {};
  for (const f of geo.features) {
    const uf = String(f.properties.sigla).toLowerCase();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = "", melhor = null;
    for (const poly of polys) {
      for (const ring of poly) d += "M" + ring.map((c) => P(c).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
      const c = centroide(poly[0], P);
      if (!melhor || c[2] > melhor[2]) melhor = c;
    }
    paths[uf] = d; centro[uf] = [melhor[0], melhor[1]];
  }
  // Ajustes finos de rótulo (formas irregulares)
  const desl = { go: [-6, 10], pa: [4, 6], ma: [2, 6], pi: [0, 4], ba: [4, 0], mg: [-4, 6], am: [0, 4], sc: [4, 0], to: [0, 4] };
  for (const [u, [dx, dy]] of Object.entries(desl)) if (centro[u]) centro[u] = [centro[u][0] + dx, centro[u][1] + dy];
  return { paths, centro };
}
function blocoMapa(lat) {
  if (!S.geo) return `<div class="mapa" style="aspect-ratio:1"></div>`;
  const { paths, centro } = S.geo;
  const sel = new Set(nivel() === "br" ? [] : nivel() === "regiao" ? REGIOES[S.sel.regiao] : [S.sel.uf]);
  const ordem = Object.keys(paths).sort((a, b) => sel.has(a) - sel.has(b));
  let h = "", rot = "";
  for (const uf of ordem) {
    const p = lat.uf[uf];
    const cor = cssVar(corLider(p));
    const dica = `${NOME_UF[uf]}: ${fmtPct(p ? p.pct_apurado : 0, 1)} apurado${p && dois(p) ? ` · Flávio ${fmtPct(pctC(p, "flavio"), 1)}, Lula ${fmtPct(pctC(p, "lula"), 1)}` : ""}`;
    h += `<g class="uf${sel.has(uf) ? " sel" : ""}" data-uf="${uf}" tabindex="0" role="button" aria-label="${esc(dica)}"><title>${esc(dica)}</title><path d="${paths[uf]}" fill="${cor}"/></g>`;
  }
  const ink = (uf) => (dois(lat.uf[uf]) ? "#ffffff" : cssVar("--text"));
  const pctTxt = (uf) => fmtPct(lat.uf[uf] ? lat.uf[uf].pct_apurado : 0, 0);
  for (const uf of Object.keys(centro)) {
    if (CHAMADAS.includes(uf)) continue;
    const [x, y] = centro[uf];
    const pequeno = uf === "df";
    rot += `<text x="${x}" y="${y - (pequeno ? -2 : 3)}" text-anchor="middle" class="r-uf" fill="${ink(uf)}" ${pequeno ? 'style="font-size:6.5px"' : ""}>${uf.toUpperCase()}</text>`;
    if (!pequeno) rot += `<text x="${x}" y="${y + 8}" text-anchor="middle" class="r-pct" fill="${ink(uf)}">${pctTxt(uf)}</text>`;
  }
  // Chamadas fora do mapa, empilhadas sem sobrepor (mín. 18 unidades entre rótulos)
  const lista = CHAMADAS.filter((u) => centro[u]).map((u) => ({ u, x: centro[u][0], y: centro[u][1], ly: centro[u][1] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < lista.length; i++) lista[i].ly = Math.max(lista[i].ly, lista[i - 1].ly + 18);
  for (const c of lista) {
    rot += `<line class="guia" x1="${c.x}" y1="${c.y}" x2="398" y2="${c.ly}"/><circle cx="${c.x}" cy="${c.y}" r="1.4" fill="${cssVar("--faint")}"/>`;
    rot += `<text x="402" y="${c.ly + 3.5}" class="r-uf fora">${c.u.toUpperCase()} <tspan class="r-pct">${pctTxt(c.u)}</tspan></text>`;
  }
  rot += `<text x="340" y="392" class="r-uf fora">Exterior <tspan class="r-pct">${lat.uf.zz ? pctTxt("zz") : "–"}</tspan></text>`;
  return `<div class="mapa"><svg viewBox="-4 -4 452 410" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa do Brasil por estado: cor do líder e % de urnas apuradas">${h}${rot}</svg></div>
    <p class="legenda"><span class="sw" style="--c:var(--lula)"></span>Lula <span class="sw" style="--c:var(--flavio)"></span>Flávio <span class="sw" style="--c:var(--sem)"></span>sem votos · número = % de urnas apuradas</p>`;
}

/* ---------- gráfico de evolução (SVG, não captura o toque) ---------- */
function svgEvolucao(serie, { compacto = false, margemSo = false } = {}) {
  const pts = serie.filter((q) => q.pct_apurado > 0 && dois(q) > 0);
  const sl = document.querySelector(".slide") || {};
  const larg = sl.clientWidth || 640, altSlide = sl.clientHeight || 500;
  const W = compacto ? 320 : Math.max(300, Math.min(1060, larg - 40));
  const H = compacto ? 110 : Math.round(Math.max(150, Math.min(300, altSlide * 0.45)));
  const m = { l: compacto ? 30 : 36, r: compacto ? 6 : 12, t: 10, b: compacto ? 20 : 26 };
  const ys = margemSo ? pts.map(margem) : pts.flatMap((q) => [shareF(q), shareL(q)]);
  let lo, hi, passo;
  if (margemSo) {
    const a = Math.max(5, ...ys.map(Math.abs));
    passo = a > 20 ? 10 : 5; hi = Math.ceil(a / passo) * passo; lo = -hi;
  } else {
    lo = ys.length ? Math.min(...ys, 50) : 40; hi = ys.length ? Math.max(...ys, 50) : 60;
    passo = hi - lo > 16 ? 5 : 2;
    lo = Math.max(0, Math.floor((lo - 0.5) / passo) * passo); hi = Math.min(100, Math.ceil((hi + 0.5) / passo) * passo);
  }
  const X = (x) => m.l + (x / 100) * (W - m.l - m.r), Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * (H - m.t - m.b);
  const grid = cssVar("--grid");
  let h = "";
  const ref = margemSo ? 0 : 50;
  for (let y = lo; y <= hi + 1e-9; y += passo) {
    if (compacto && y !== lo && y !== hi && y !== ref) continue;
    h += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="${grid}" ${y === ref ? 'stroke-width="2"' : ""}/>`;
    h += `<text x="${m.l - 5}" y="${Y(y) + 4}" text-anchor="end">${margemSo ? (y > 0 ? "F+" : y < 0 ? "L+" : "") + Math.abs(y) : y + "%"}</text>`;
  }
  for (const x of compacto ? [0, 50, 100] : [0, 25, 50, 75, 100]) h += `<text x="${X(x)}" y="${H - 6}" text-anchor="${x === 0 ? "start" : x === 100 ? "end" : "middle"}">${x}%</text>`;
  const cF = cssVar("--flavio"), cL = cssVar("--lula");
  const linha = (f, cor) => (pts.length ? `<polyline fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" points="${pts.map((q) => `${X(q.pct_apurado).toFixed(1)},${Y(f(q)).toFixed(1)}`).join(" ")}"/>` : "");
  if (margemSo) {
    h += linha(margem, cssVar("--text"));
    if (pts.length) { const u = pts[pts.length - 1]; h += `<circle cx="${X(u.pct_apurado)}" cy="${Y(margem(u))}" r="3.5" fill="${margem(u) >= 0 ? cF : cL}"/>`; }
  } else {
    h += linha(shareF, cF) + linha(shareL, cL);
    if (pts.length) {
      const u = pts[pts.length - 1], cima = shareF(u) >= shareL(u);
      const lx = Math.min(X(u.pct_apurado) + 6, W - m.r - 46);
      h += `<text x="${lx}" y="${Y(shareF(u)) + (cima ? -6 : 14)}" style="fill:${cF}">Flávio</text><text x="${lx}" y="${Y(shareL(u)) + (cima ? 14 : -6)}" style="fill:${cL}">Lula</text>`;
    }
  }
  if (!pts.length) h += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Aguardando os primeiros votos…</text>`;
  if (!compacto) h += `<g class="cursor" visibility="hidden"><line y1="${m.t}" y2="${H - m.b}" stroke="${cssVar("--faint")}"/><circle r="4" fill="${cF}"/><circle r="4" fill="${cL}"/></g>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução conforme a apuração">${h}</svg>`;
  return { svg, pts, W, H, X, Y, m };
}
function ligaDica(el, g) {
  const svg = el.querySelector("svg"), dica = el.querySelector(".dica"), cur = svg && svg.querySelector(".cursor");
  if (!svg || !cur || !g.pts.length) return;
  const mostra = (ev) => {
    const r = svg.getBoundingClientRect();
    const alvo = ((((ev.clientX - r.left) / r.width) * g.W - g.m.l) / (g.W - g.m.l - g.m.r)) * 100;
    let q = g.pts[0];
    for (const p of g.pts) if (Math.abs(p.pct_apurado - alvo) < Math.abs(q.pct_apurado - alvo)) q = p;
    const cx = g.X(q.pct_apurado);
    cur.setAttribute("visibility", "visible");
    const ln = cur.querySelector("line"); ln.setAttribute("x1", cx); ln.setAttribute("x2", cx);
    const [a, b] = cur.querySelectorAll("circle");
    a.setAttribute("cx", cx); a.setAttribute("cy", g.Y(shareF(q))); b.setAttribute("cx", cx); b.setAttribute("cy", g.Y(shareL(q)));
    dica.hidden = false;
    dica.innerHTML = `${fmtPct(q.pct_apurado, 1)} apurado · ${fmtHora(q.tse || q.ts)}<br>Flávio ${fmtPct(shareF(q))} · Lula ${fmtPct(shareL(q))}`;
    const px = (cx / g.W) * r.width;
    dica.style.left = Math.min(Math.max(0, px - dica.offsetWidth / 2), r.width - dica.offsetWidth) + "px";
    dica.style.top = "-38px";
  };
  svg.addEventListener("click", mostra);
  svg.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") mostra(ev); });
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") { dica.hidden = true; cur.setAttribute("visibility", "hidden"); } });
}
function tabelaMarcos(serie) {
  const pts = serie.filter((q) => dois(q));
  if (!pts.length) return "";
  const linha = (rot, q, forte) => {
    const b = (x) => (forte ? `<b>${x}</b>` : x);
    return `<tr><td>${b(rot)}</td><td class="num-f">${b(fmtPct(shareF(q)))}</td><td class="num-l">${b(fmtPct(shareL(q)))}</td>
      <td class="${q.votos.flavio >= q.votos.lula ? "num-f" : "num-l"}">${q.votos.flavio >= q.votos.lula ? "F" : "L"} +${num(Math.abs(q.votos.flavio - q.votos.lula))}</td><td class="col-hora">${fmtHora(q.tse || q.ts).split(", ")[1] || "–"}</td></tr>`;
  };
  const linhas = [];
  for (let t = 10; t <= 100; t += 10) {
    const q = pts.find((p) => p.pct_apurado >= t);
    if (!q) break;
    linhas.push(linha(`${t}%`, q, false));
  }
  const u = pts[pts.length - 1];
  if (u.pct_apurado < 100) linhas.push(linha(`Agora, ${fmtPct(u.pct_apurado, 1)}`, u, true));
  return `<div class="tabela-wrap"><table class="tabela"><colgroup><col class="c-nome"><col><col><col><col class="col-hora"></colgroup><thead><tr><th>Apurado</th><th>Flávio</th><th>Lula</th><th>Vantagem</th><th class="col-hora">Hora</th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;
}

/* ---------- telas: GERAL ---------- */
function nomeUnid(u) {
  if (u.mun) return nomeMun(u.uf, u.mun);
  if (u.uf) return NOME_UF[u.uf];
  return NOME_REG[u.regiao];
}
function rotuloUnid(sel, paraRegiao) {
  const n = nivel(sel);
  if (n === "br") return paraRegiao ? "Região" : "Estado";
  if (n === "regiao") return "Estado";
  return "Município";
}
function tabelaProjecao(pr, rotulo) {
  const linhas = [...pr.linhas].sort((a, b) => b.falta - a.falta);
  const lim = Math.min(60, linhas.length);
  const tr = linhas.slice(0, lim).map((x) => `<tr><td><button type="button" class="link-cel" data-ir-local='${esc(JSON.stringify(x.sel))}'>${esc(nomeUnid(x.sel))}</button>${x.fonte === "1º turno" ? '<span class="sub"> · 1º t.</span>' : ""}</td>
      <td>${fmtPct(x.pct, 1)}</td><td class="num-f">${fmtPct(100 * x.share, 1)}</td><td class="col-opc">${num(x.esperado)}</td><td>${num(x.falta)}</td></tr>`).join("");
  const t = pr.tot;
  return `<div class="tabela-wrap"><table class="tabela"><colgroup><col class="c-nome"><col><col><col class="col-opc"><col></colgroup><thead><tr><th>${rotulo}</th><th>Apurado</th><th>Flávio</th><th class="col-opc">Esperados</th><th>Faltam</th></tr></thead>
    <tbody>${tr}</tbody><tfoot><tr><td>Total${lim < linhas.length ? ` (${lim} de ${linhas.length})` : ""}</td><td></td><td class="num-f">${fmtPct((100 * t.flavio) / (t.flavio + t.lula || 1), 1)}</td><td class="col-opc">${num(t.esperado)}</td><td>${num(t.falta)}</td></tr></tfoot></table></div>`;
}
function telaGeral(p, serie) {
  const lat = L();
  const pr = !T1() ? projecao(S.sel, false) : null;
  // 1. Apuração
  $("s0").innerHTML = `<div class="apur enche"><div class="apur-esq">
      ${blocoCandidatos(p)}
      <p class="achado achado-s0">${achado(p, pr, serie)}</p>
      ${indicadores(p)}</div>
    <div class="apur-dir">${blocoMapa(lat)}</div></div>`;
  // 2. Projeção ponderada pelo eleitorado
  if (T1()) {
    $("s1").innerHTML = `<h2>Projeção</h2><p class="sub">O 1º turno já terminou: o resultado da primeira tela é o final. A projeção funciona durante a apuração do 2º turno.</p>`;
  } else {
    const t = pr.tot, mF = t.flavio - t.lula, un = rotuloUnid(S.sel, false).toLowerCase();
    $("s1").innerHTML = `<h2>Se cada ${un} mantiver o percentual atual</h2>
      <p class="sub">Estimativa não oficial<span class="sub-longo">. O percentual de hoje de cada ${un} é aplicado a todos os votos esperados ali (eleitorado × comparecimento), e a soma dá o resultado final</span>.</p>
      <div class="apur enche bloco"><div class="apur-esq">${blocoCandidatos(null, t)}
        <p class="achado">${t.falta > 0 ? `${mF >= 0 ? "Flávio" : "Lula"} terminaria cerca de ${fmtInt(Math.abs(mF))} votos à frente<span class="sub-longo">. Faltam cerca de ${fmtInt(t.falta)} votos válidos</span>.` : "Apuração completa: a estimativa é igual ao resultado."}</p></div>
        <div class="apur-dir enche">${tabelaProjecao(pr, rotuloUnid(S.sel, false))}</div></div>`;
  }
  // 3. Histórico
  if (T1()) {
    $("s2").innerHTML = `<h2>Histórico</h2><p class="sub">O 1º turno não tem histórico gravado (o coletor começou no 2º turno).</p>`;
  } else {
    const g = svgEvolucao(serie);
    $("s2").innerHTML = `<h2>Evolução da apuração</h2><p class="sub">% dos válidos conforme as urnas foram apuradas<span class="sub-longo">. Toque no gráfico para ver um ponto</span>.</p>
      <div class="grafico">${g.svg}<div class="dica" hidden></div></div>
      <div class="enche bloco">${tabelaMarcos(serie)}</div>`;
    ligaDica($("s2").querySelector(".grafico"), g);
  }
}

/* ---------- telas: POR REGIÃO ---------- */
function telaRegiao() {
  const n = nivel();
  let us = unidades(S.sel, true).map((u) => ({ u, p: pontoAtual(u) })).filter((x) => x.p);
  if (n === "uf") us = us.sort((a, b) => b.p.eleitorado - a.p.eleitorado).slice(0, 40);
  const tit = n === "br" ? "Regiões" : n === "regiao" ? `Estados do ${NOME_REG[S.sel.regiao]}` : n === "uf" ? `Maiores municípios de ${NOME_UF[S.sel.uf]}` : nomeLocal();
  // 1. Barras divididas, ordenadas por % apurado
  const lin = [...us].sort((a, b) => b.p.pct_apurado - a.p.pct_apurado).map(({ u, p }) => {
    const f = pctC(p, "flavio") || 0, l = pctC(p, "lula") || 0;
    return `<button type="button" class="div-linha" data-ir-local='${esc(JSON.stringify(u))}' aria-label="${esc(nomeUnid(u))}: Flávio ${fmtPct(f, 1)}, Lula ${fmtPct(l, 1)}, ${fmtPct(p.pct_apurado, 1)} apurado">
      <span class="div-nome">${esc(nomeUnid(u))}<small>${fmtInt(p.eleitorado)} eleitores</small></span>
      <span class="div-barra">${dois(p) ? `<span style="--c:var(--flavio);width:${f}%">${NF[1].format(f)}%</span>${T1() ? `<span style="--c:var(--outros);width:${Math.max(0, 100 - f - l)}%"></span>` : ""}<span style="--c:var(--lula);width:${l}%">${NF[1].format(l)}%</span>` : ""}</span>
      <span class="div-apur">${fmtPct(p.pct_apurado, 1)}<small>apurado</small></span></button>`;
  }).join("");
  $("s0").innerHTML = `<h2>${esc(tit)}</h2><p class="sub">Flávio à esquerda, Lula à direita; ordenado pelo quanto já foi apurado. Toque numa linha para abrir o local.</p><div class="enche"><div class="divs">${lin || '<p class="sub">Sem dados ainda.</p>'}</div></div>`;
  // 2. Projeção por região: quanto cada uma soma para a vantagem final
  if (T1()) {
    $("s1").innerHTML = `<h2>Projeção</h2><p class="sub">O 1º turno já terminou. A projeção por região funciona durante a apuração do 2º turno.</p>`;
  } else {
    const pr = projecao(S.sel, true);
    const rows = [...pr.linhas].sort((a, b) => Math.abs(b.flavio - b.lula) - Math.abs(a.flavio - a.lula)).slice(0, 40);
    const t = pr.tot, un = rotuloUnid(S.sel, true);
    const saldo = (x) => { const s = x.flavio - x.lula; return `<td class="${s >= 0 ? "num-f" : "num-l"}">${s >= 0 ? "F" : "L"} +${num(Math.abs(s))}</td>`; };
    $("s1").innerHTML = `<h2>Quanto cada ${un.toLowerCase()} soma no final</h2>
      <p class="sub">Mesmo cálculo da visão Geral: percentual atual × votos esperados. "Saldo" é a vantagem estimada que cada uma dá ao seu líder (F = Flávio, L = Lula).</p>
      <div class="enche bloco"><div class="tabela-wrap"><table class="tabela t-saldo"><colgroup><col class="c-nome"><col class="col-opc"><col><col><col class="c-saldo"></colgroup><thead><tr><th>${un}</th><th class="col-opc">Apurado</th><th>Flávio</th><th>Lula</th><th>Saldo</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(nomeUnid(x.sel))}</td><td class="col-opc">${fmtPct(x.pct, 1)}</td><td class="num-f">${num(x.flavio)}</td><td class="num-l">${num(x.lula)}</td>${saldo(x)}</tr>`).join("")}
      </tbody><tfoot><tr><td>Total</td><td class="col-opc"></td><td class="num-f">${num(t.flavio)}</td><td class="num-l">${num(t.lula)}</td>${saldo(t)}</tr></tfoot></table></div></div>`;
  }
  // 3. Histórico: um gráfico pequeno de margem por unidade
  if (T1()) {
    $("s2").innerHTML = `<h2>Histórico</h2><p class="sub">O 1º turno não tem histórico gravado.</p>`;
    return;
  }
  const alvo = us.slice(0, n === "uf" ? 6 : 10);
  $("s2").innerHTML = `<h2>Margem ao longo da apuração</h2><p class="sub">Diferença Flávio − Lula em pontos percentuais (F+ acima da linha, L+ abaixo) conforme o % apurado.</p><div class="enche"><div class="multiplos" id="mult"></div></div>`;
  Promise.all(alvo.map(async ({ u, p }) => ({ u, p, s: await carregaSerie(u) }))).then((itens) => {
    const el = $("mult");
    if (!el) return;
    el.innerHTML = itens.map(({ u, p, s }) => {
      const m = margem(p);
      return `<div class="multiplo"><h3>${esc(nomeUnid(u))}<small>${m == null ? "–" : `${m >= 0 ? "Flávio" : "Lula"} +${NF[1].format(Math.abs(m))}`}</small></h3>
        <div class="grafico">${svgEvolucao(s, { compacto: true, margemSo: true }).svg}</div></div>`;
    }).join("");
  });
}

/* ---------- render ---------- */
let seq = 0;
async function renderTudo() {
  renderMeta();
  syncCombos();
  $("titulo-local").textContent = nomeLocal();
  $("btn-limpar").disabled = nivel() === "br";
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.modo === S.modo)));
  if (!L()) {
    $("s0").innerHTML = `<p class="achado">${T1() ? "Carregando o 1º turno…" : "O 2º turno ainda não tem votos publicados. A apuração começa às 17h; abra o filtro para ver o 1º turno."}</p>`;
    $("s1").innerHTML = ""; $("s2").innerHTML = "";
    return;
  }
  const meu = ++seq;
  if (S.modo === "regiao") { telaRegiao(); requestAnimationFrame(ajustaAltura); setTimeout(ajustaAltura, 400); return; }
  const p = pontoAtual();
  telaGeral(p, []);
  requestAnimationFrame(ajustaAltura);
  if (T1()) return;
  const serie = await carregaSerie(S.sel);
  if (meu !== seq || S.modo !== "geral") return;
  telaGeral(p, serie);
  requestAnimationFrame(ajustaAltura);
}
function renderMeta() {
  const m = S.d[S.turno].meta || {};
  const p = pontoAtual();
  const txt = { aguardando: "aguardando o início", apurando: "apurando", finalizado: "resultado final", encerrado: "coleta encerrada" }[m.status] || (T1() ? "carregando…" : "sem dados ainda");
  $("status").textContent = `${T1() ? "1º turno, 4/10" : "2º turno, 25/10"} · ${txt}${p && !T1() ? ` · ${fmtPct(p.pct_apurado)} das urnas` : ""}`;
  $("status").className = `status ${m.status || ""}`;
  $("rod-atual").textContent = fmtHora(m.ultima_coleta);
  $("rod-tse").textContent = fmtHora(m.ultima_totalizacao_tse);
  document.querySelectorAll("[data-turno]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.turno === S.turno)));
}

/* ---------- filtro de local ---------- */
const CB = {};
function syncCombos() {
  const { regiao, uf, mun } = S.sel;
  CB.regiao.set([{ v: "", label: "Brasil (todas)" }, ...Object.keys(REGIOES).map((r) => ({ v: r, label: NOME_REG[r] }))], regiao || "");
  const ufs = regiao ? REGIOES[regiao] : UFS;
  CB.uf.set([{ v: "", label: regiao ? `Todos do ${NOME_REG[regiao]}` : "Todos os estados" },
    ...ufs.map((u) => ({ v: u, label: NOME_UF[u], extra: u === "zz" ? "" : u.toUpperCase() }))], uf || "");
  const munOpts = [];
  for (const u of uf ? [uf] : ufs) for (const [cd, nm] of Object.entries(S.municipios[u] || {})) munOpts.push({ v: `${u}-${cd}`, label: titulo(nm), extra: u === "zz" ? "Exterior" : u.toUpperCase() });
  munOpts.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  CB.mun.set([{ v: "", label: uf ? `Todos de ${NOME_UF[uf]}` : "Todos os municípios" }, ...munOpts], mun ? `${uf}-${mun}` : "");
  const n = nivel();
  const h = [T1() ? "t1" : "", S.modo === "regiao" ? "por-regiao" : "",
    n === "regiao" ? `regiao-${regiao}` : n === "uf" ? `uf-${uf}` : n === "mun" ? `mun-${uf}-${mun}` : ""].filter(Boolean).join("/");
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}
function lerHash() {
  for (const parte of location.hash.replace("#", "").split("/")) {
    const [n, a, b] = parte.split("-");
    if (n === "t1") S.turno = "t1";
    else if (parte === "por-regiao") S.modo = "regiao";
    else if (n === "regiao" && REGIOES[a]) S.sel = { regiao: a, uf: null, mun: null };
    else if (n === "uf" && NOME_UF[a]) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: null };
    else if (n === "mun" && NOME_UF[a] && b) S.sel = { regiao: UF_REG[a] || null, uf: a, mun: b };
  }
}
function selecionar(mud) {
  Object.assign(S.sel, mud);
  renderTudo();
}

/* ---------- carrossel ---------- */
function slideAtual() {
  const c = $("carrossel");
  return Math.round(c.scrollLeft / (c.clientWidth + 16));
}
function irPara(i) {
  const c = $("carrossel");
  i = Math.max(0, Math.min(2, i));
  c.scrollTo({ left: i * (c.clientWidth + 16), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function ajustaAltura() { /* a altura agora vem do CSS (cabe na janela) */ }
function marcaSlide() {
  const i = slideAtual();
  ajustaAltura();
  document.querySelectorAll(".abas button").forEach((b, j) => (j === i ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  document.querySelector(".nav-seta.esq").disabled = i === 0;
  document.querySelector(".nav-seta.dir").disabled = i === 2;
}

/* ---------- eventos ---------- */
function corDaBarra() {
  const cor = cssVar("--ground");
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute("content", cor); m.removeAttribute("media"); });
}
function montaEventos() {
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
  const abreFiltro = (abrir) => { $("filtros").hidden = !abrir; $("btn-filtro").setAttribute("aria-expanded", String(abrir)); };
  $("btn-filtro").addEventListener("click", () => abreFiltro($("filtros").hidden));
  $("fechar-filtro").addEventListener("click", () => abreFiltro(false));
  $("btn-limpar").addEventListener("click", () => { abreFiltro(false); selecionar({ regiao: null, uf: null, mun: null }); irPara(0); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("filtros").hidden) abreFiltro(false); });
  document.querySelectorAll("[data-turno]").forEach((b) => b.addEventListener("click", () => trocaTurno(b.dataset.turno)));
  document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => { S.modo = b.dataset.modo; renderTudo(); irPara(0); }));
  // carrossel
  const c = $("carrossel");
  let t;
  c.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(marcaSlide, 60); }, { passive: true });
  document.querySelectorAll(".abas button").forEach((b) => b.addEventListener("click", () => irPara(+b.dataset.ir)));
  document.querySelectorAll(".nav-seta").forEach((b) => b.addEventListener("click", () => irPara(slideAtual() + +b.dataset.passo)));
  c.addEventListener("keydown", (e) => {
    const g = e.target.closest("[data-uf]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selecionar({ regiao: UF_REG[g.dataset.uf] || null, uf: g.dataset.uf, mun: null }); return; }
    if (e.target !== c) return;
    if (e.key === "ArrowRight") { e.preventDefault(); irPara(slideAtual() + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); irPara(slideAtual() - 1); }
  });
  // cliques dentro das telas (mapa, linhas, tabelas)
  c.addEventListener("click", (e) => {
    const g = e.target.closest("[data-uf]");
    if (g) return selecionar({ regiao: UF_REG[g.dataset.uf] || null, uf: g.dataset.uf, mun: null });
    const l = e.target.closest("[data-ir-local]");
    if (l) { selecionar(JSON.parse(l.dataset.irLocal)); irPara(0); }
  });
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { renderTudo(); marcaSlide(); }, 250); });
  // tema
  let salvo = null;
  try { salvo = localStorage.getItem("tema"); } catch (e) { /* sem storage */ }
  if (salvo) { document.documentElement.dataset.theme = salvo; corDaBarra(); }
  $("tema").addEventListener("click", () => {
    const novo = getComputedStyle(document.documentElement).colorScheme.includes("dark") ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem("tema", novo); } catch (e) { /* sem storage */ }
    corDaBarra();
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
// Página aberta há horas: se saiu versão nova do site, recarrega sozinha
async function confereVersao() {
  if (TESTE || location.protocol === "file:") return;
  try {
    const r = await fetch(`versao.txt?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok && (await r.text()).trim() !== VERSAO) location.reload();
  } catch (e) { /* sem rede: tenta no próximo minuto */ }
}
async function atualizar() {
  confereVersao();
  const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
  if (latest) S.d.t2.latest = latest;
  if (meta) S.d.t2.meta = meta;
  if (!T1()) await renderTudo();
}
async function iniciar() {
  if (TESTE) $("aviso-teste").hidden = false;
  montaEventos();
  lerHash();
  const hashT1 = S.turno === "t1";
  S.turno = "t2";
  const [mun] = await Promise.all([getJSON("municipios.json"), (async () => {
    const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
    Object.assign(S.d.t2, { latest, meta });
  })()]);
  if (mun) S.municipios = mun;
  // Abre no 2º turno se já houver votos; senão no 1º
  const br2 = S.d.t2.latest && S.d.t2.latest.br;
  S.turno = hashT1 || !br2 || !(br2.pct_apurado > 0) ? "t1" : "t2";
  if (S.turno === "t1") await carregaT1();
  renderTudo();
  marcaSlide();
  Promise.all([getJSON("base_1t/br.json"), getJSON("base_1t/uf.json"), getJSON("base_1t/mun.json")]).then(([br, uf, m]) => {
    if (br && uf && m) { S.base = { br, uf, mun: m }; if (!T1()) renderTudo(); }
  });
  fetch(GEOJSON).then((r) => r.json()).then((g) => { S.geo = projetaGeo(g); renderTudo(); }).catch(() => {});
  setInterval(atualizar, REFRESH_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();
