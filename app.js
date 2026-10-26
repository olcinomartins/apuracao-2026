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
const VERSAO = "20261025220617";

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
  candProj: "flavio",  // candidato cujos dados aparecem na tabela da projeção
  ordProj: { col: "pct", dir: -1 },     // ordenação da tabela da projeção (Geral): maior % apurado primeiro
  ordReg: { col: "pct", dir: -1 },
  candComp: "flavio",                   // candidato da tabela 1º × 2º
  ordBar: { reg: "apur", transf: "eleit", mult: "eleit" },  // ordenação das listas com barras
  ordComp: { col: "var", dir: -1 },     // ordenação da tabela 1º × 2º: maior variação primeiro      // ordenação da tabela da projeção (Por região): maior % apurado primeiro
};

// Cabeçalho clicável que ordena a tabela; a seta mostra a coluna e o sentido atuais
function thOrd(estado, tabela, col, txt, cls = "") {
  const ativo = estado.col === col;
  // txt pode ser [rótulo longo, rótulo curto para o celular]
  if (Array.isArray(txt)) txt = `<span class="rot-lg">${txt[0]}</span><span class="rot-sm">${txt[1]}</span>`;
  return `<th class="${cls}" aria-sort="${ativo ? (estado.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="th-ord" data-ord-tab="${tabela}" data-ord-col="${col}">${txt}${ativo ? (estado.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
}
// Seletor "Ordenar" das listas com barras e gráficos pequenos
const OPC_ORD = {
  reg: [["apur", "Apurado"], ["eleit", "Eleitores"], ["flavio", "Flávio %"], ["lula", "Lula %"], ["nome", "Nome"]],
  transf: [["eleit", "Eleitores"], ["outros", "Votos de outros %"], ["flavio", "Mais para Flávio"], ["lula", "Mais para Lula"], ["nome", "Nome"]],
  mult: [["eleit", "Eleitores"], ["mf", "Margem Flávio"], ["ml", "Margem Lula"], ["nome", "Nome"]],
};
function seletorOrdem(chave) {
  return `<label class="ord-sel"><span>Ordenar</span><select data-ord-bar="${chave}" aria-label="Ordenar a lista">${OPC_ORD[chave]
    .map(([v, t]) => `<option value="${v}"${S.ordBar[chave] === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
}
// Ordena pela chave escolhida: nome em ordem alfabética, números do maior para o menor
function ordenaBar(linhas, chave, val) {
  const k = S.ordBar[chave], f = val[k];
  return [...linhas].sort((a, b) => (k === "nome" ? f(a).localeCompare(f(b), "pt-BR") : (f(b) ?? -1e9) - (f(a) ?? -1e9)));
}
function ordena(linhas, estado, val) {
  const { col, dir } = estado;
  return [...linhas].sort((a, b) => {
    const x = val[col](a), y = val[col](b);
    return (typeof x === "string" ? x.localeCompare(y, "pt-BR") : x - y) * dir;
  });
}

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtInt = (x) => (x == null || isNaN(x) ? "–" : nf0.format(Math.round(x)));
// Compacto para tabelas no celular: 9.632.309 → "9,63 mi"; 563.412 → "563 mil"
const fmtCurto = (x) => {
  if (x == null || isNaN(x)) return "–";
  const a = Math.abs(x);
  if (a >= 1e6) return NF[a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2].format(x / 1e6) + " mi";
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

// Painéis: "t1" (1º turno), "t2" (2º turno) e "comp" (1º × 2º, que usa os dois)
const T1 = () => S.turno === "t1";
const COMP = () => S.turno === "comp";
const L = () => (COMP() ? S.d.t2.latest : S.d[S.turno].latest);
const META = () => (COMP() ? S.d.t2.meta : S.d[S.turno].meta);
function mix(a, b, t) {
  const hx = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [p, q] = [hx(a), hx(b)];
  return "#" + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, "0")).join(""); // taste-skill-ignore (hex)
}
// Intensidade pela margem: tom claro = disputa apertada, cor cheia = vitória folgada (mapa de municípios)
function corIntensa(p) {
  if (!dois(p)) return cssVar("--sem");
  const m = Math.abs(margem(p)), base = cssVar(p.votos.flavio >= p.votos.lula ? "--flavio" : "--lula");
  return mix(base, cssVar("--surface"), 0.72 - 0.72 * Math.min(1, m / 40));
}
// Mudança da margem entre os turnos (só entre os dois, em p.p.): positiva = a disputa andou para Flávio
function mudanca(sel) {
  const a = pontoAtual(sel, S.d.t1.latest), b = pontoAtual(sel, S.d.t2.latest);
  if (!a || !b || !dois(a) || !dois(b)) return null;
  return margem(b) - margem(a);
}
// Mudança menor que 1 p.p. é "quase igual": cinza neutro, para não parecer que alguém virou
const MUD_NEUTRA = 1;
function corMud(d) {
  if (d == null) return cssVar("--sem");
  if (Math.abs(d) < MUD_NEUTRA) return cssVar("--neutra");
  const base = cssVar(d >= 0 ? "--flavio" : "--lula");
  return mix(base, cssVar("--surface"), 0.78 - 0.68 * Math.min(1, Math.abs(d) / 12));
}
const txtMud = (d) => (d == null ? "–" : Math.abs(d) < MUD_NEUTRA ? "=" : `${d >= 0 ? "F" : "L"}+${NF[Math.abs(d) < 10 ? 1 : 0].format(Math.abs(d))}`);
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
  return { sel, p, pct, eleitorado: te, esperado, apur, falta: esperado - apur, flavio: esperado * share, lula: esperado * (1 - share), share, fonte };
}
function projecao(sel, paraRegiao) {
  const us = unidades(sel, paraRegiao);
  const linhas = us.map((u) => {
    // Regiões somam as projeções dos seus estados (mesmo método, na granularidade estadual)
    if (paraRegiao && nivel(sel) === "br" && u.regiao && !u.uf) {
      const filhos = REGIOES[u.regiao].map((uf) => projetaUnidade({ regiao: u.regiao, uf, mun: null }));
      const t = filhos.reduce((a, x) => ({ eleitorado: a.eleitorado + x.eleitorado, esperado: a.esperado + x.esperado, apur: a.apur + x.apur, flavio: a.flavio + x.flavio, lula: a.lula + x.lula }), { eleitorado: 0, esperado: 0, apur: 0, flavio: 0, lula: 0 });
      const p = pontoAtual(u);
      return { sel: u, p, pct: p ? p.pct_apurado : 0, ...t, falta: t.esperado - t.apur, share: t.flavio / (t.esperado || 1), fonte: "estados" };
    }
    return projetaUnidade(u);
  });
  const tot = linhas.reduce((a, x) => ({ eleitorado: a.eleitorado + x.eleitorado, esperado: a.esperado + x.esperado, apur: a.apur + x.apur, flavio: a.flavio + x.flavio, lula: a.lula + x.lula }), { eleitorado: 0, esperado: 0, apur: 0, flavio: 0, lula: 0 });
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
function blocoCandidatos(p, proj, selecionavel) {
  // proj: {flavio, lula} → mostra a estimativa em vez da apuração
  const linhas = CAND.map((c) => {
    let pct, votos;
    if (proj) { pct = (100 * proj[c.k]) / (proj.flavio + proj.lula || 1); votos = proj[c.k]; }
    else { pct = pctC(p, c.k); votos = p ? p.votos[c.k] : 0; }
    return { ...c, pct, votos };
  }).sort((a, b) => (b.pct || 0) - (a.pct || 0));
  const max = Math.max(60, ...linhas.map((l) => l.pct || 0));
  const abre = (c, cls) => (selecionavel
    ? `<button type="button" class="${cls} cand-btn" data-cand="${c.k}" aria-pressed="${S.candProj === c.k}" style="--c:var(${c.cor})" aria-label="Ver os dados de ${c.nome} na tabela">`
    : `<div class="${cls}" style="--c:var(${c.cor})">`);
  const fecha = selecionavel ? "</button>" : "</div>";
  let h = linhas.map((c) => `${abre(c, "cand")}
      <div class="cand-nome" translate="no"><span class="sw"></span>${c.nome} <small>${c.partido}</small></div>
      <div class="cand-linha"><div class="cand-trilho"><span style="width:${((c.pct || 0) / max) * 100}%"></span></div>
      <div class="cand-pct">${c.pct == null ? "–" : fmtPct(c.pct)}</div></div>
      <div class="cand-votos">${fmtInt(c.votos)} votos${proj ? " estimados" : ""}</div>${fecha}`).join("");
  if (!proj && T1() && p && p.validos) {
    const out = Math.max(0, 100 - (pctC(p, "flavio") || 0) - (pctC(p, "lula") || 0));
    h += `<div class="cand" style="--c:var(--outros)"><div class="cand-nome"><span class="sw"></span>Outros candidatos</div>
      <div class="cand-linha"><div class="cand-trilho"><span style="width:${(out / max) * 100}%"></span></div><div class="cand-pct">${fmtPct(out)}</div></div>
      <div class="cand-votos">${fmtInt(p.validos - dois(p))} votos</div></div>`;
  }
  // No celular: os dois lado a lado e uma barra dividida (o CSS escolhe qual mostrar)
  const [a, b] = linhas;
  const tot = (a.pct || 0) + (b.pct || 0);
  const lado = (c) => `${abre(c, "lado")}<small>${c.curto}</small><b>${c.pct == null ? "–" : fmtPct(c.pct)}</b>${fecha}`;
  const duelo = `<div class="duelo-m"${selecionavel ? "" : ' aria-hidden="true"'}><div class="duelo-lados">${lado(a)}${lado(b)}</div>
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
  return `<div class="indic"><div><small>Apurado</small><b>${fmtPct(p.pct_apurado)}</b></div>
    <div><small>Diferença</small><b>${dois(p) ? fmtInt(dif) : "–"}</b></div>
    <div><small>Brancos/nulos</small><b>${fmtPct(bn)}</b></div></div>`;
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
  const paths = {}, centro = {}, caixa = {};
  for (const f of geo.features) {
    const uf = String(f.properties.sigla).toLowerCase();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = "", melhor = null;
    const cx = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polys) {
      for (const ring of poly) {
        d += "M" + ring.map((c) => {
          const q = P(c);
          cx[0] = Math.min(cx[0], q[0]); cx[1] = Math.min(cx[1], q[1]); cx[2] = Math.max(cx[2], q[0]); cx[3] = Math.max(cx[3], q[1]);
          return q.map((v) => v.toFixed(1)).join(",");
        }).join("L") + "Z";
      }
      const c = centroide(poly[0], P);
      if (!melhor || c[2] > melhor[2]) melhor = c;
    }
    paths[uf] = d; centro[uf] = [melhor[0], melhor[1]]; caixa[uf] = cx;
  }
  // Ajustes finos de rótulo (formas irregulares)
  const desl = { go: [-6, 10], pa: [4, 6], ma: [2, 6], pi: [0, 4], ba: [4, 0], mg: [-4, 6], am: [0, 4], sc: [4, 0], to: [0, 4] };
  for (const [u, [dx, dy]] of Object.entries(desl)) if (centro[u]) centro[u] = [centro[u][0] + dx, centro[u][1] + dy];
  return { paths, centro, caixa, P };
}

/* ---------- municípios no mapa (malha do IBGE, carregada sob demanda por estado) ---------- */
const MALHA_IBGE = (uf) => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf.toUpperCase()}?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio`;
let IBGE = null;            // código IBGE → [uf, código TSE]
const MALHAS = {};          // uf → [{cd, d}] já projetados
const pedindo = {};
async function carregaMalha(uf) {
  if (MALHAS[uf] || pedindo[uf] || !S.geo) return;
  pedindo[uf] = true;
  try {
    if (!IBGE) IBGE = await fetch("ibge.json").then((r) => r.json());
    const g = await fetch(MALHA_IBGE(uf)).then((r) => r.json());
    const P = S.geo.P;
    MALHAS[uf] = g.features.map((f) => {
      const id = IBGE[f.properties.codarea];
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const d = polys.map((poly) => poly.map((ring) => "M" + ring.map((c) => P(c).map((v) => v.toFixed(2)).join(",")).join("L") + "Z").join("")).join("");
      let melhor = null;
      for (const poly of polys) { const c = centroide(poly[0], P); if (!melhor || c[2] > melhor[2]) melhor = c; }
      return { cd: id && id[0] === uf ? id[1] : null, d, c: melhor };
    });
    renderTudo();
  } catch (e) {
    console.warn("malha do IBGE indisponível para", uf, e);
  } finally {
    pedindo[uf] = false;
  }
}
function caixaDe(ufs) {
  const c = [Infinity, Infinity, -Infinity, -Infinity];
  for (const u of ufs) {
    const b = S.geo.caixa[u];
    if (!b) continue;
    c[0] = Math.min(c[0], b[0]); c[1] = Math.min(c[1], b[1]); c[2] = Math.max(c[2], b[2]); c[3] = Math.max(c[3], b[3]);
  }
  const w = c[2] - c[0], h = c[3] - c[1], pad = Math.max(w, h) * 0.06;
  return [c[0] - pad, c[1] - pad, w + 2 * pad, h + 2 * pad];
}
function blocoMapaEstado(lat, uf) {
  // Mapa do estado com os municípios: cor do líder com intensidade pela margem (no 1º × 2º, a mudança
  // entre os turnos); toque num município para abri-lo
  const mal = MALHAS[uf];
  const vb = caixaDe([uf]);
  const pts = lat.mun[uf] || {};
  const k = vb[2] / 452;
  const munSel = S.sel.mun;
  let h = "";
  if (!mal) {
    carregaMalha(uf);
    h = `<path d="${S.geo.paths[uf]}" fill="${cssVar(corLider(lat.uf[uf]))}" stroke="${cssVar("--surface")}" vector-effect="non-scaling-stroke"/>
      <text x="${vb[0] + vb[2] / 2}" y="${vb[1] + vb[3] / 2}" text-anchor="middle" class="r-uf" style="font-size:${12 * k}px" fill="#fff">Carregando municípios…</text>`;
  } else {
    const ord = [...mal].sort((a, b) => (a.cd === munSel) - (b.cd === munSel));
    for (const m of ord) {
      const p = m.cd ? pts[m.cd] : null;
      const nome = m.cd ? nomeMun(uf, m.cd) : "";
      const dica = `${nome}: ${fmtPct(p ? p.pct_apurado : 0, 1)} apurado${p && dois(p) ? ` · Flávio ${fmtPct(pctC(p, "flavio"), 1)}, Lula ${fmtPct(pctC(p, "lula"), 1)}` : ""}`;
      const d = COMP() && m.cd ? mudanca({ regiao: UF_REG[uf] || null, uf, mun: m.cd }) : null;
      const fill = COMP() ? corMud(d) : corIntensa(p);
      const dica2 = COMP() ? `${nome}: ${d == null ? "sem dados" : Math.abs(d) < MUD_NEUTRA ? "margem quase igual nos dois turnos" : `margem andou ${NF[1].format(Math.abs(d))} p.p. para ${d >= 0 ? "Flávio" : "Lula"}`}` : dica;
      h += `<g class="uf mun${m.cd === munSel ? " sel" : ""}" ${m.cd ? `data-mun="${m.cd}" tabindex="0" role="button" aria-label="${esc(dica2)}"` : ""}><title>${esc(dica2)}</title><path d="${m.d}" fill="${fill}"/></g>`;
    }
    if (munSel) {
      const sel = mal.find((m) => m.cd === munSel);
      if (sel) {
        h += `<path d="${sel.d}" fill="none" stroke="${cssVar("--text")}" stroke-width="2.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        if (sel.c) h += `<text x="${sel.c[0]}" y="${sel.c[1] - 3 * k}" text-anchor="middle" class="r-uf rot-mun" style="font-size:${11 * k}px;stroke-width:${3 * k}px">${esc(nomeMun(uf, munSel))}</text>`;
      }
    }
  }
  return `<div class="mapa"><svg viewBox="${vb.join(" ")}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa de ${esc(NOME_UF[uf])} por município">${h}</svg></div>
    ${legendaMapa(true)}`;
}
function legendaMapa(municipios) {
  if (COMP()) return `<p class="legenda"><span class="sw" style="--c:var(--lula)"></span>Lula cresceu mais <span class="sw" style="--c:var(--flavio)"></span>Flávio cresceu mais <span class="sw" style="--c:var(--neutra)"></span>quase igual (&lt;1 p.p.) · a cor não indica quem venceu${municipios ? "" : " · número = mudança da margem"}</p>`;
  if (municipios) return `<p class="legenda"><span class="sw" style="--c:var(--lula)"></span>Lula <span class="sw" style="--c:var(--flavio)"></span>Flávio <span class="sw" style="--c:var(--sem)"></span>sem votos · tom mais forte = vitória mais folgada · toque num município</p>`;
  return `<p class="legenda"><span class="sw" style="--c:var(--lula)"></span>Lula <span class="sw" style="--c:var(--flavio)"></span>Flávio <span class="sw" style="--c:var(--sem)"></span>sem votos · número = % de urnas apuradas</p>`;
}
function blocoMapa(lat) {
  if (!S.geo) return `<div class="mapa" style="aspect-ratio:1"></div>`;
  const n = nivel();
  if ((n === "uf" || n === "mun") && S.sel.uf !== "zz" && S.geo.paths[S.sel.uf]) return blocoMapaEstado(lat, S.sel.uf);
  const { paths, centro } = S.geo;
  // Região escolhida: aproxima nos estados dela (rótulos na mesma escala visual)
  const vbReg = n === "regiao" ? caixaDe(REGIOES[S.sel.regiao]) : null;
  const k = vbReg ? vbReg[2] / 452 : 1;
  // Na região, os estados dela ficam normais e os vizinhos apagados (sem contorno de seleção)
  const sel = new Set(nivel() === "uf" || nivel() === "mun" ? [S.sel.uf] : []);
  const daRegiao = vbReg ? new Set(REGIOES[S.sel.regiao]) : null;
  const ordem = Object.keys(paths).sort((a, b) => sel.has(a) - sel.has(b));
  let h = "", rot = "";
  for (const uf of ordem) {
    const p = lat.uf[uf];
    const dUF = COMP() ? mudanca({ regiao: UF_REG[uf] || null, uf, mun: null }) : null;
    const cor = COMP() ? corMud(dUF) : cssVar(corLider(p));
    const dica = COMP() ? `${NOME_UF[uf]}: ${dUF == null ? "sem dados" : Math.abs(dUF) < MUD_NEUTRA ? "margem quase igual nos dois turnos" : `margem andou ${NF[1].format(Math.abs(dUF))} p.p. para ${dUF >= 0 ? "Flávio" : "Lula"}`}`
      : `${NOME_UF[uf]}: ${fmtPct(p ? p.pct_apurado : 0, 1)} apurado${p && dois(p) ? ` · Flávio ${fmtPct(pctC(p, "flavio"), 1)}, Lula ${fmtPct(pctC(p, "lula"), 1)}` : ""}`;
    h += `<g class="uf${sel.has(uf) ? " sel" : ""}${daRegiao && !daRegiao.has(uf) ? " fora-reg" : ""}" data-uf="${uf}" tabindex="0" role="button" aria-label="${esc(dica)}"><title>${esc(dica)}</title><path d="${paths[uf]}" fill="${cor}"/></g>`;
  }
  const mudUF = (uf) => mudanca({ regiao: UF_REG[uf] || null, uf, mun: null });
  const ink = (uf) => (COMP() ? (Math.abs(mudUF(uf) || 0) >= 5 ? "#ffffff" : cssVar("--text")) : dois(lat.uf[uf]) ? "#ffffff" : cssVar("--text"));
  // Abaixo de 1% mostra uma casa decimal (0,4%), acima arredonda (38%); no 1º × 2º, a mudança da margem
  const pctTxt = (uf) => {
    if (COMP()) return txtMud(mudUF(uf));
    const v = lat.uf[uf] ? lat.uf[uf].pct_apurado : 0; return fmtPct(v, v > 0 && v < 1 ? 1 : 0);
  };
  for (const uf of Object.keys(centro)) {
    if (CHAMADAS.includes(uf) && !vbReg) continue;
    const [x, y] = centro[uf];
    const pequeno = uf === "df";
    if (vbReg && !REGIOES[S.sel.regiao].includes(uf)) continue;
    rot += `<text x="${x}" y="${y - (pequeno ? -2 : 3) * k}" text-anchor="middle" class="r-uf" fill="${ink(uf)}" style="font-size:${(pequeno ? 6.5 : 10.5) * k}px">${uf.toUpperCase()}</text>`;
    if (!pequeno) rot += `<text x="${x}" y="${y + 8 * k}" text-anchor="middle" class="r-pct" fill="${ink(uf)}" style="font-size:${8.5 * k}px">${pctTxt(uf)}</text>`;
  }
  if (vbReg) {
    return `<div class="mapa"><svg viewBox="${vbReg.join(" ")}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa da região ${esc(NOME_REG[S.sel.regiao])}">${h}${rot}</svg></div>
      ${legendaMapa(false)}`;
  }
  // Chamadas fora do mapa, empilhadas sem sobrepor (mín. 18 unidades entre rótulos)
  const lista = CHAMADAS.filter((u) => centro[u]).map((u) => ({ u, x: centro[u][0], y: centro[u][1], ly: centro[u][1] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < lista.length; i++) lista[i].ly = Math.max(lista[i].ly, lista[i - 1].ly + 18);
  for (const c of lista) {
    rot += `<line class="guia" x1="${c.x}" y1="${c.y}" x2="398" y2="${c.ly}"/><circle cx="${c.x}" cy="${c.y}" r="1.4" fill="${cssVar("--faint")}"/>`;
    rot += `<text x="402" y="${c.ly + 3.5}" class="r-uf fora">${c.u.toUpperCase()} <tspan class="r-pct">${pctTxt(c.u)}</tspan></text>`;
  }
  rot += `<text x="340" y="392" class="r-uf fora">Exterior <tspan class="r-pct">${lat.uf.zz || COMP() ? pctTxt("zz") : "–"}</tspan></text>`;
  return `<div class="mapa"><svg viewBox="-4 -4 452 410" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa do Brasil por estado">${h}${rot}</svg></div>
    ${legendaMapa(false)}`;
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
  // Eixo X acompanha a apuração: 0–2%, 0–5%, 0–10%… até 0–100%, para a linha não ficar espremida no começo
  const maxX = pts.length ? pts[pts.length - 1].pct_apurado : 0;
  const xmax = [2, 5, 10, 25, 50, 100].find((v) => v >= maxX * 1.15) || 100;
  const X = (x) => m.l + (x / xmax) * (W - m.l - m.r), Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * (H - m.t - m.b);
  const grid = cssVar("--grid");
  let h = "";
  const ref = margemSo ? 0 : 50;
  for (let y = lo; y <= hi + 1e-9; y += passo) {
    if (compacto && y !== lo && y !== hi && y !== ref) continue;
    h += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="${grid}" ${y === ref ? 'stroke-width="2"' : ""}/>`;
    h += `<text x="${m.l - 5}" y="${Y(y) + 4}" text-anchor="end">${margemSo ? (y > 0 ? "F+" : y < 0 ? "L+" : "") + Math.abs(y) : y + "%"}</text>`;
  }
  // Marcas redondas no eixo X: passo conforme a escala
  const passoX = compacto ? xmax / 2 : { 2: 0.5, 5: 1, 10: 2, 25: 5, 50: 10, 100: 25 }[xmax];
  for (let x = 0; x <= xmax + 1e-9; x += passoX) {
    h += `<text x="${X(x)}" y="${H - 6}" text-anchor="${x === 0 ? "start" : x >= xmax - 1e-9 ? "end" : "middle"}">${NF[x % 1 ? 1 : 0].format(x)}%</text>`;
  }
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
  return { svg, pts, W, H, X, Y, m, xmax };
}
function ligaDica(el, g) {
  const svg = el.querySelector("svg"), dica = el.querySelector(".dica"), cur = svg && svg.querySelector(".cursor");
  if (!svg || !cur || !g.pts.length) return;
  const mostra = (ev) => {
    const r = svg.getBoundingClientRect();
    const alvo = ((((ev.clientX - r.left) / r.width) * g.W - g.m.l) / (g.W - g.m.l - g.m.r)) * g.xmax;
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
  // Todas as atualizações gravadas pelo coletor, da mais recente para a mais antiga
  const pts = serie.filter((q) => dois(q));
  if (!pts.length) return `<p class="sub">Aguardando as primeiras atualizações…</p>`;
  const linhas = pts.slice().reverse().map((q, i) => {
    const b = (x) => (i === 0 ? `<b>${x}</b>` : x);
    const F = q.votos.flavio >= q.votos.lula;
    return `<tr><td>${b(i === 0 ? `Agora, ${fmtPct(q.pct_apurado, 1)}` : fmtPct(q.pct_apurado, q.pct_apurado < 10 ? 2 : 1))}</td>
      <td class="num-f">${b(fmtPct(shareF(q)))}</td><td class="num-l">${b(fmtPct(shareL(q)))}</td>
      <td class="${F ? "num-f" : "num-l"}">${F ? "F" : "L"} +${num(Math.abs(q.votos.flavio - q.votos.lula))}</td>
      <td class="col-hora">${fmtHora(q.tse || q.ts).split(", ")[1] || "–"}</td></tr>`;
  });
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
  const ck = S.candProj, cnome = ck === "flavio" ? "Flávio" : "Lula", ccls = ck === "flavio" ? "num-f" : "num-l";
  const pctDe = (x) => 100 * (ck === "flavio" ? x.share : 1 - x.share);
  const linhas = ordena(pr.linhas, S.ordProj, {
    nome: (x) => nomeUnid(x.sel), eleit: (x) => x.eleitorado, pct: (x) => x.pct, share: pctDe, votos: (x) => x[ck], falta: (x) => x.falta,
  });
  const lim = Math.min(60, linhas.length);
  const tr = linhas.slice(0, lim).map((x) => `<tr><td><button type="button" class="link-cel" data-ir-local='${esc(JSON.stringify(x.sel))}'>${esc(nomeUnid(x.sel))}</button>${x.fonte === "1º turno" ? '<span class="sub"> · 1º&nbsp;t.</span>' : ""}</td>
      <td>${num(x.eleitorado)}</td><td>${fmtPct(x.pct, 1)}</td><td class="${ccls}">${fmtPct(pctDe(x), 1)}</td><td class="${ccls}">${num(x[ck])}</td><td class="col-opc">${num(x.falta)}</td></tr>`).join("");
  const t = pr.tot;
  return `<div class="tabela-wrap"><table class="tabela"><colgroup><col class="c-nome"><col><col><col><col><col class="col-opc"></colgroup><thead><tr>${thOrd(S.ordProj, "proj", "nome", rotulo)}${thOrd(S.ordProj, "proj", "eleit", ["Eleitores", "Eleit."])}${thOrd(S.ordProj, "proj", "pct", ["Apurado", "Apur."])}${thOrd(S.ordProj, "proj", "share", [cnome + " %", "%"], ccls)}${thOrd(S.ordProj, "proj", "votos", "Votos", ccls)}${thOrd(S.ordProj, "proj", "falta", "Faltam", "col-opc")}</tr></thead>
    <tbody>${tr}</tbody><tfoot><tr><td>Total${lim < linhas.length ? ` (${lim} de ${linhas.length})` : ""}</td><td>${num(t.eleitorado)}</td><td></td><td class="${ccls}">${fmtPct((100 * t[ck]) / (t.flavio + t.lula || 1), 1)}</td><td class="${ccls}">${num(t[ck])}</td><td class="col-opc">${num(t.falta)}</td></tr></tfoot></table></div>`;
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
      <p class="sub">Estimativa não oficial. Toque num candidato para ver os dados dele na tabela<span class="sub-longo">. O percentual de hoje de cada ${un} é aplicado a todos os votos esperados ali (eleitorado × comparecimento), e a soma dá o resultado final</span>.</p>
      <div class="apur enche bloco"><div class="apur-esq">${blocoCandidatos(null, t, true)}
        <p class="achado">${t.falta > 0 ? `${mF >= 0 ? "Flávio" : "Lula"} terminaria cerca de ${fmtInt(Math.abs(mF))} votos à frente<span class="sub-longo">. Faltam cerca de ${fmtInt(t.falta)} votos válidos</span>.` : "Apuração completa: a estimativa é igual ao resultado."}</p></div>
        <div class="apur-dir enche">${tabelaProjecao(pr, rotuloUnid(S.sel, false))}</div></div>`;
  }
  // 3. Histórico
  if (T1()) {
    $("s2").innerHTML = `<h2>Histórico</h2><p class="sub">O 1º turno não tem histórico gravado (o coletor começou no 2º turno).</p>`;
  } else {
    const g = svgEvolucao(serie);
    $("s2").innerHTML = `<h2>Evolução da apuração</h2><p class="sub">% dos válidos a cada atualização do TSE<span class="sub-longo">. Toque no gráfico para ver um ponto</span>.</p>
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
  const lin = ordenaBar(us, "reg", {
    apur: (x) => x.p.pct_apurado, eleit: (x) => x.p.eleitorado, flavio: (x) => pctC(x.p, "flavio"), lula: (x) => pctC(x.p, "lula"), nome: (x) => nomeUnid(x.u),
  }).map(({ u, p }) => {
    const f = pctC(p, "flavio") || 0, l = pctC(p, "lula") || 0;
    return `<button type="button" class="div-linha" data-ir-local='${esc(JSON.stringify(u))}' aria-label="${esc(nomeUnid(u))}: Flávio ${fmtPct(f, 1)}, Lula ${fmtPct(l, 1)}, ${fmtPct(p.pct_apurado, 1)} apurado">
      <span class="div-nome">${esc(nomeUnid(u))}<small>${fmtCurto(p.eleitorado)} eleitores</small></span>
      <span class="div-barra">${dois(p) ? `<span style="--c:var(--flavio);width:${f}%">${NF[1].format(f)}%</span>${T1() ? `<span style="--c:var(--outros);width:${Math.max(0, 100 - f - l)}%"></span>` : ""}<span style="--c:var(--lula);width:${l}%">${NF[1].format(l)}%</span>` : ""}</span>
      <span class="div-apur">${fmtPct(p.pct_apurado, 1)}<small>apurado</small></span></button>`;
  }).join("");
  $("s0").innerHTML = `<div class="tela-cab"><h2>${esc(tit)}</h2>${seletorOrdem("reg")}</div><p class="sub">Flávio à esquerda, Lula à direita<span class="sub-longo">. Toque numa linha para abrir o local</span>.</p><div class="enche"><div class="divs">${lin || '<p class="sub">Sem dados ainda.</p>'}</div></div>`;
  // 2. Projeção por região: quanto cada uma soma para a vantagem final
  if (T1()) {
    $("s1").innerHTML = `<h2>Projeção</h2><p class="sub">O 1º turno já terminou. A projeção por região funciona durante a apuração do 2º turno.</p>`;
  } else {
    const pr = projecao(S.sel, true);
    const rows = ordena(pr.linhas, S.ordReg, {
      nome: (x) => nomeUnid(x.sel), eleit: (x) => x.eleitorado, pct: (x) => x.pct, flavio: (x) => x.flavio, lula: (x) => x.lula, saldo: (x) => Math.abs(x.flavio - x.lula),
    }).slice(0, 40);
    const t = pr.tot, un = rotuloUnid(S.sel, true);
    const saldo = (x) => { const s = x.flavio - x.lula; return `<td class="${s >= 0 ? "num-f" : "num-l"}">${s >= 0 ? "F" : "L"} +${num(Math.abs(s))}</td>`; };
    $("s1").innerHTML = `<h2>Quanto cada ${un.toLowerCase()} soma no final</h2>
      <p class="sub">Mesmo cálculo da visão Geral: percentual atual × votos esperados. "Saldo" é a vantagem estimada que cada uma dá ao seu líder (F = Flávio, L = Lula).</p>
      <div class="enche bloco"><div class="tabela-wrap"><table class="tabela t-saldo"><colgroup><col class="c-nome"><col><col class="col-opc"><col><col><col class="c-saldo"></colgroup><thead><tr>${thOrd(S.ordReg, "reg", "nome", un)}${thOrd(S.ordReg, "reg", "eleit", ["Eleitores", "Eleit."])}${thOrd(S.ordReg, "reg", "pct", "Apurado", "col-opc")}${thOrd(S.ordReg, "reg", "flavio", "Flávio", "num-f")}${thOrd(S.ordReg, "reg", "lula", "Lula", "num-l")}${thOrd(S.ordReg, "reg", "saldo", "Saldo")}</tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(nomeUnid(x.sel))}</td><td>${num(x.eleitorado)}</td><td class="col-opc">${fmtPct(x.pct, 1)}</td><td class="num-f">${num(x.flavio)}</td><td class="num-l">${num(x.lula)}</td>${saldo(x)}</tr>`).join("")}
      </tbody><tfoot><tr><td>Total</td><td>${num(t.eleitorado)}</td><td class="col-opc"></td><td class="num-f">${num(t.flavio)}</td><td class="num-l">${num(t.lula)}</td>${saldo(t)}</tr></tfoot></table></div></div>`;
  }
  // 3. Histórico: um gráfico pequeno de margem por unidade
  if (T1()) {
    $("s2").innerHTML = `<h2>Histórico</h2><p class="sub">O 1º turno não tem histórico gravado.</p>`;
    return;
  }
  const alvo = ordenaBar(us, "mult", {
    eleit: (x) => x.p.eleitorado, mf: (x) => margem(x.p), ml: (x) => (margem(x.p) == null ? null : -margem(x.p)), nome: (x) => nomeUnid(x.u),
  }).slice(0, n === "uf" ? 6 : 10);
  $("s2").innerHTML = `<div class="tela-cab"><h2>Margem ao longo da apuração</h2>${seletorOrdem("mult")}</div><p class="sub">Diferença Flávio − Lula em pontos percentuais (F+ acima da linha, L+ abaixo) conforme o % apurado.</p><div class="enche"><div class="multiplos" id="mult"></div></div>`;
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

/* ---------- tela 1º × 2º: diferença de resultado entre os turnos ----------
   1º turno: % sobre todos os votos válidos (havia outros candidatos). 2º turno: % sobre os votos dos dois
   (que são todos os válidos). Variação em pontos percentuais. O 2º turno ainda é parcial: vale o apurado até agora. */
function pct1(p, k) { return p && p.validos ? (100 * p.votos[k]) / p.validos : null; }
function pct2(p, k) { return dois(p) ? (100 * p.votos[k]) / dois(p) : null; }
function telaComparacao(paraRegiao, alvo = "s2") {
  const lat1 = S.d.t1.latest, lat2 = S.d.t2.latest;
  if (!lat1 || !lat2) { $(alvo).innerHTML = `<h2>1º × 2º turno</h2><p class="sub">Carregando…</p>`; return; }
  const ck = S.candComp, ccls = ck === "flavio" ? "num-f" : "num-l";
  const p1 = pontoAtual(S.sel, lat1), p2 = pontoAtual(S.sel, lat2);
  const sinal = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${NF[1].format(Math.abs(v))} p.p.`);
  const resumo = CAND.map((c) => {
    const a = pct1(p1, c.k), b = pct2(p2, c.k), v = a != null && b != null ? b - a : null;
    return `<button type="button" class="comp-cand cand-btn" data-comp-cand="${c.k}" aria-pressed="${ck === c.k}" style="--c:var(${c.cor})" aria-label="Ver a variação de ${c.nome} na tabela">
      <span class="comp-nome"><span class="sw"></span>${c.curto}</span>
      <span class="comp-num">${fmtPct(a)} <span class="comp-seta">→</span> <b>${fmtPct(b)}</b></span>
      <span class="comp-var ${v == null ? "" : v >= 0 ? "sobe" : "desce"}">${sinal(v)}</span></button>`;
  }).join("");
  const n = nivel();
  const us = n === "mun" ? [] : unidades(S.sel, paraRegiao);
  let rows = us.map((u) => {
    const a = pontoAtual(u, lat1), b = pontoAtual(u, lat2);
    const x1 = pct1(a, ck), x2 = pct2(b, ck);
    return { u, a, b, x1, x2, v: x1 != null && x2 != null ? x2 - x1 : null, eleit: (a && a.eleitorado) || (b && b.eleitorado) || 0, apur: b ? b.pct_apurado : 0 };
  }).filter((r) => r.a || r.b);
  rows = ordena(rows, S.ordComp, {
    nome: (r) => nomeUnid(r.u), eleit: (r) => r.eleit, apur: (r) => r.apur,
    p1: (r) => r.x1 ?? -1, p2: (r) => r.x2 ?? -1, var: (r) => (r.v == null ? 999 * S.ordComp.dir : r.v),
  });
  const lim = Math.min(120, rows.length);
  const un = rotuloUnid(S.sel, paraRegiao), cn = ck === "flavio" ? "Flávio" : "Lula";
  const tabela = rows.length ? `<div class="enche bloco"><div class="tabela-wrap"><table class="tabela">
    <colgroup><col class="c-nome"><col class="col-opc"><col><col><col><col></colgroup>
    <thead><tr>${thOrd(S.ordComp, "comp", "nome", un)}${thOrd(S.ordComp, "comp", "apur", ["Apurado 2º", "Apur."], "col-opc")}${thOrd(S.ordComp, "comp", "p1", [cn + " 1º", "1º"], ccls)}${thOrd(S.ordComp, "comp", "p2", [cn + " 2º", "2º"], ccls)}${thOrd(S.ordComp, "comp", "var", ["Variação", "Var."])}${thOrd(S.ordComp, "comp", "eleit", ["Eleitores", "Eleit."])}</tr></thead>
    <tbody>${rows.slice(0, lim).map((r) => `<tr><td><button type="button" class="link-cel" data-ir-local='${esc(JSON.stringify(r.u))}'>${esc(nomeUnid(r.u))}</button></td>
      <td class="col-opc">${fmtPct(r.apur, 1)}</td><td>${fmtPct(r.x1, 1)}</td><td class="${ccls}">${fmtPct(r.x2, 1)}</td>
      <td class="${r.v == null ? "" : r.v >= 0 ? "sobe" : "desce"}">${r.v == null ? "–" : `${r.v >= 0 ? "+" : "−"}${NF[1].format(Math.abs(r.v))}`}</td><td>${num(r.eleit)}</td></tr>`).join("")}</tbody>
    </table></div>${lim < rows.length ? `<p class="sub">Mostrando ${lim} de ${rows.length}. Ordene pelas colunas ou filtre um local.</p>` : ""}</div>`
    : `<p class="sub bloco">Escolha um nível acima (estado ou região) para comparar as partes.</p>`;
  $(alvo).innerHTML = `<h2>Tabela: ${esc(nomeLocal())}</h2>
    <p class="sub">1º turno: % de todos os válidos. 2º turno: % dos válidos apurados até agora<span class="sub-longo">. Toque num candidato para ver a variação dele; toque no título de uma coluna para ordenar</span>.</p>
    <div class="comp-resumo bloco">${resumo}</div>${tabela}`;
}

/* ---------- painel 1º × 2º: mapa da mudança e para onde foram os votos ---------- */
// Dos votos que foram para outros candidatos no 1º turno, quanto cada um "herdou" no 2º (estimativa simples:
// ganho de % de cada um entre os turnos ÷ soma dos ganhos; ignora troca direta entre os dois e comparecimento)
function herdou(sel) {
  const a = pontoAtual(sel, S.d.t1.latest), b = pontoAtual(sel, S.d.t2.latest);
  if (!a || !a.validos || !dois(b)) return null;
  const f1 = (100 * a.votos.flavio) / a.validos, l1 = (100 * a.votos.lula) / a.validos;
  const gF = shareF(b) - f1, gL = shareL(b) - l1, outros = 100 - f1 - l1;
  const tot = gF + gL;
  const fracF = tot > 0.3 ? Math.min(1, Math.max(0, gF / tot)) : null;
  return { outros, gF, gL, fracF, eleit: a.eleitorado };
}
function fraseHerdou(hd) {
  if (!hd || hd.fracF == null) return "";
  if (hd.fracF <= 0.03) return `Dos ${fmtPct(hd.outros, 1)} que votaram em outros no 1º turno, praticamente todos foram para Lula.`;
  if (hd.fracF >= 0.97) return `Dos ${fmtPct(hd.outros, 1)} que votaram em outros no 1º turno, praticamente todos foram para Flávio.`;
  return `Dos ${fmtPct(hd.outros, 1)} que votaram em outros no 1º turno, cerca de ${NF[0].format(100 * (1 - hd.fracF))}% foram para Lula e ${NF[0].format(100 * hd.fracF)}% para Flávio.`;
}
function telaMudanca() {
  const lat1 = S.d.t1.latest, lat2 = S.d.t2.latest;
  if (!lat1 || !lat2) { $("s0").innerHTML = `<p class="achado">Carregando os dois turnos…</p>`; return; }
  const p1 = pontoAtual(S.sel, lat1), p2 = pontoAtual(S.sel, lat2);
  const m1 = dois(p1) ? margem(p1) : null, m2 = dois(p2) ? margem(p2) : null;
  const d = m1 != null && m2 != null ? m2 - m1 : null;
  const lado = (m) => (m == null ? "–" : `${m >= 0 ? "Flávio" : "Lula"} +${NF[1].format(Math.abs(m))} p.p.`);
  const cartao = (c) => {
    const a = pct1(p1, c.k), b = pct2(p2, c.k), v = a != null && b != null ? b - a : null;
    return `<div class="comp-cand" style="--c:var(${c.cor})"><span class="comp-nome"><span class="sw"></span>${c.curto}</span>
      <span class="comp-num">${fmtPct(a)} <span class="comp-seta">→</span> <b>${fmtPct(b)}</b></span>
      <span class="comp-var ${v == null ? "" : v >= 0 ? "sobe" : "desce"}">${v == null ? "–" : `${v >= 0 ? "+" : "−"}${NF[1].format(Math.abs(v))} p.p.`}</span></div>`;
  };
  const hd = herdou(S.sel);
  $("s0").innerHTML = `<div class="apur enche"><div class="apur-esq">
      <div class="comp-resumo">${CAND.map(cartao).join("")}</div>
      <div class="indic"><div><small>Margem no 1º</small><b class="${m1 == null ? "" : m1 >= 0 ? "num-f" : "num-l"}">${lado(m1).replace(" p.p.", "")}</b></div>
        <div><small>Margem no 2º</small><b class="${m2 == null ? "" : m2 >= 0 ? "num-f" : "num-l"}">${lado(m2).replace(" p.p.", "")}</b></div>
        <div><small>Mudança</small><b class="${d == null ? "" : d >= 0 ? "num-f" : "num-l"}">${txtMud(d)}</b></div></div>
      <p class="achado">${d == null ? "Aguardando votos dos dois turnos."
        : Math.abs(d) < MUD_NEUTRA ? `A margem quase não mudou entre os turnos (${NF[1].format(Math.abs(d))} p.p.).`
        : `Entre os turnos, a disputa andou ${NF[1].format(Math.abs(d))} p.p. para ${d >= 0 ? "Flávio" : "Lula"}.`}${d != null && Math.abs(d) >= MUD_NEUTRA && m2 != null && Math.sign(d) !== Math.sign(m2) ? ` ${m2 >= 0 ? "Flávio" : "Lula"} continua vencendo aqui; a mudança só mostra que ${d >= 0 ? "Flávio" : "Lula"} cresceu mais entre os turnos.` : ""}${hd && hd.fracF != null ? " " + fraseHerdou(hd) : ""}</p>
    </div>
    <div class="apur-dir">${blocoMapa(lat2)}</div></div>`;
}
function telaTransferencia(paraRegiao) {
  const lat1 = S.d.t1.latest, lat2 = S.d.t2.latest;
  if (!lat1 || !lat2) { $("s1").innerHTML = `<h2>Para onde foram os votos</h2><p class="sub">Carregando…</p>`; return; }
  const hd = herdou(S.sel);
  const barra = (fracF, rot) => (fracF == null ? `<span class="div-barra"></span>`
    : `<span class="div-barra"><span style="--c:var(--flavio);width:${100 * fracF}%">${rot && fracF >= 0.24 ? NF[0].format(100 * fracF) + "%" : ""}</span><span style="--c:var(--lula);width:${100 * (1 - fracF)}%">${rot && fracF <= 0.76 ? NF[0].format(100 * (1 - fracF)) + "%" : ""}</span></span>`);
  const n = nivel();
  let rows = n === "mun" ? [] : unidades(S.sel, paraRegiao).map((u) => ({ u, hd: herdou(u) })).filter((r) => r.hd && r.hd.fracF != null);
  rows = ordenaBar(rows, "transf", {
    eleit: (r) => r.hd.eleit, outros: (r) => r.hd.outros, flavio: (r) => r.hd.fracF, lula: (r) => 1 - r.hd.fracF, nome: (r) => nomeUnid(r.u),
  }).slice(0, 60);
  const lin = rows.map(({ u, hd: x }) => `<button type="button" class="div-linha" data-ir-local='${esc(JSON.stringify(u))}' aria-label="${esc(nomeUnid(u))}: dos votos de outros candidatos, ${NF[0].format(100 * x.fracF)}% para Flávio">
      <span class="div-nome">${esc(nomeUnid(u))}<small>outros: ${fmtPct(x.outros, 1)}</small></span>${barra(x.fracF, true)}<span class="div-apur">${num(x.eleit)}<small>eleitores</small></span></button>`).join("");
  $("s1").innerHTML = `<div class="tela-cab"><h2>Para onde foram os votos dos outros candidatos</h2>${seletorOrdem("transf")}</div>
    <p class="sub">Estimativa: compara os percentuais dos dois turnos<span class="sub-longo">; ignora quem trocou de um candidato para o outro e mudanças de comparecimento</span>.</p>
    <div class="bloco transf-topo">${hd && hd.fracF != null
      ? `<p class="achado">${esc(nomeLocal())}: ${fraseHerdou(hd).replace(/^D/, "d")}</p>${barra(hd.fracF, true)}`
      : `<p class="sub">Ainda não dá para estimar neste local.</p>`}</div>
    <div class="enche bloco"><div class="divs">${lin || '<p class="sub">Escolha um nível acima (estado ou região) para ver as partes.</p>'}</div></div>`;
}

// Título do local nunca cortado: diminui e quebra; se precisar, o seletor de painel vai para a linha de baixo
function ajustaTitulo() {
  const h1 = $("titulo-local"), cab = h1.closest(".cab");
  h1.textContent = nomeLocal();
  h1.classList.remove("longo"); cab.classList.remove("empilha");
  if (h1.scrollWidth <= h1.clientWidth + 1) return;
  h1.classList.add("longo");
  // mais de 2 linhas na largura disponível → empilha
  if (h1.scrollHeight > 2 * 21 + 4 || h1.scrollWidth > h1.clientWidth + 1) cab.classList.add("empilha");
}

/* ---------- render ---------- */
let seq = 0;
async function renderTudo() {
  renderMeta();
  syncCombos();
  ajustaTitulo();
  const filtrado = nivel() !== "br";
  const bl = $("btn-limpar");
  if (filtrado && bl.disabled) { bl.classList.remove("pulsa"); void bl.offsetWidth; bl.classList.add("pulsa"); }
  bl.disabled = !filtrado;
  bl.classList.toggle("ativo", filtrado);
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.modo === S.modo)));
  const rotulos = COMP() ? ["Mudança", "Tabela", "Para onde foram"] : ["Apuração", "Histórico", "Projeção"];
  document.querySelectorAll(".abas button").forEach((b, i) => { b.textContent = rotulos[i]; });
  if (COMP()) {
    if (!S.d.t1.latest) { carregaT1().then(renderTudo); }
    telaMudanca();
    telaComparacao(S.modo === "regiao", "s2");
    telaTransferencia(S.modo === "regiao");
    return;
  }
  if (!L()) {
    $("s0").innerHTML = `<p class="achado">${T1() ? "Carregando o 1º turno…" : "O 2º turno ainda não tem votos publicados. A apuração começa às 17h; abra o filtro para ver o 1º turno."}</p>`;
    $("s1").innerHTML = ""; $("s2").innerHTML = "";
    return;
  }
  const meu = ++seq;
  if (S.modo === "regiao") { telaRegiao(); return; }
  const p = pontoAtual();
  telaGeral(p, []);
  if (T1()) return;
  const serie = await carregaSerie(S.sel);
  if (meu !== seq || S.modo !== "geral") return;
  telaGeral(p, serie);
  requestAnimationFrame(ajustaAltura);
}
function renderMeta() {
  const m = META() || {};
  const p = pontoAtual();
  const txt = { aguardando: "aguardando o início", apurando: "apurando", finalizado: "resultado final", encerrado: "coleta encerrada" }[m.status] || (T1() ? "carregando…" : "sem dados ainda");
  $("status").textContent = COMP()
    ? `1º turno (final) × 2º turno (${p ? fmtPct(p.pct_apurado, 1) + " apurado" : "aguardando"})`
    : `${T1() ? "1º turno, 4/10" : "2º turno, 25/10"} · ${txt}${p && !T1() ? ` · ${fmtPct(p.pct_apurado)} das urnas` : ""}`;
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
  const h = [T1() ? "t1" : COMP() ? "comp" : "", S.modo === "regiao" ? "por-regiao" : "",
    n === "regiao" ? `regiao-${regiao}` : n === "uf" ? `uf-${uf}` : n === "mun" ? `mun-${uf}-${mun}` : ""].filter(Boolean).join("/");
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}
function lerHash() {
  for (const parte of location.hash.replace("#", "").split("/")) {
    const [n, a, b] = parte.split("-");
    if (n === "t1") S.turno = "t1";
    else if (n === "comp") S.turno = "comp";
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
  // Tira só o zoom de local (volta para Brasil); mantém o painel, a visão e a tela onde a pessoa está
  $("btn-limpar").addEventListener("click", () => {
    abreFiltro(false);
    selecionar({ regiao: null, uf: null, mun: null });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("filtros").hidden) abreFiltro(false); });
  document.querySelectorAll("[data-turno]").forEach((b) => b.addEventListener("click", () => { trocaTurno(b.dataset.turno); irPara(0); }));
  document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => { S.modo = b.dataset.modo; renderTudo(); irPara(0); }));
  // carrossel
  const c = $("carrossel");
  let t;
  c.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(marcaSlide, 60); }, { passive: true });
  document.querySelectorAll(".abas button").forEach((b) => b.addEventListener("click", () => irPara(+b.dataset.ir)));
  document.querySelectorAll(".nav-seta").forEach((b) => b.addEventListener("click", () => irPara(slideAtual() + +b.dataset.passo)));
  c.addEventListener("keydown", (e) => {
    const gm = e.target.closest("g[data-mun]");
    if (gm && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selecionar({ mun: gm.dataset.mun }); return; }
    const g = e.target.closest("[data-uf]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selecionar({ regiao: UF_REG[g.dataset.uf] || null, uf: g.dataset.uf, mun: null }); return; }
    if (e.target !== c) return;
    if (e.key === "ArrowRight") { e.preventDefault(); irPara(slideAtual() + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); irPara(slideAtual() - 1); }
  });
  // cliques dentro das telas (mapa, linhas, tabelas)
  c.addEventListener("click", (e) => {
    const ob = e.target.closest("[data-ord-col]");
    if (ob) {
      const est = { proj: S.ordProj, reg: S.ordReg, comp: S.ordComp }[ob.dataset.ordTab], col = ob.dataset.ordCol;
      est.dir = est.col === col ? -est.dir : col === "nome" ? 1 : -1;
      est.col = col;
      return renderTudo();
    }
    const cc = e.target.closest("[data-comp-cand]");
    if (cc) { S.candComp = cc.dataset.compCand; return renderTudo(); }
    const cb = e.target.closest("[data-cand]");
    if (cb) { S.candProj = cb.dataset.cand; return renderTudo(); }
    const gm = e.target.closest("g[data-mun]");
    if (gm) return selecionar({ mun: gm.dataset.mun });
    const g = e.target.closest("[data-uf]");
    if (g) return selecionar({ regiao: UF_REG[g.dataset.uf] || null, uf: g.dataset.uf, mun: null });
    const l = e.target.closest("[data-ir-local]");
    if (l) { selecionar(JSON.parse(l.dataset.irLocal)); irPara(0); }
  });
  c.addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-ord-bar]");
    if (sel) { S.ordBar[sel.dataset.ordBar] = sel.value; renderTudo(); }
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
  if (t !== "t2") { renderTudo(); await carregaT1(); }
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
  if (!T1()) await renderTudo();  // 2º turno e 1º × 2º acompanham a apuração
}
async function iniciar() {
  if (TESTE) $("aviso-teste").hidden = false;
  montaEventos();
  lerHash();
  const doHash = S.turno;
  S.turno = "t2";
  const [mun] = await Promise.all([getJSON("municipios.json"), (async () => {
    const [latest, meta] = await Promise.all([getJSON("latest.json"), getJSON("meta.json")]);
    Object.assign(S.d.t2, { latest, meta });
  })()]);
  if (mun) S.municipios = mun;
  // Abre no 2º turno se já houver votos; senão no 1º
  const br2 = S.d.t2.latest && S.d.t2.latest.br;
  S.turno = doHash !== "t2" ? doHash : !br2 || !(br2.pct_apurado > 0) ? "t1" : "t2";
  if (S.turno !== "t2") await carregaT1();
  renderTudo();
  marcaSlide();
  Promise.all([getJSON("base_1t/br.json"), getJSON("base_1t/uf.json"), getJSON("base_1t/mun.json")]).then(([br, uf, m]) => {
    if (br && uf && m) { S.base = { br, uf, mun: m }; if (!T1()) renderTudo(); }
  });
  fetch(GEOJSON).then((r) => r.json()).then((g) => { S.geo = projetaGeo(g); renderTudo(); }).catch(() => {});
  carregaT1().then(() => { if (!T1()) renderTudo(); });
  setInterval(atualizar, REFRESH_MS);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
else iniciar();
