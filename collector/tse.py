"""Cliente HTTP e parser dos JSON públicos de resultados do TSE.

Campos (spec TSE de divulgação, conferidos nos arquivos reais do 1º turno 6257):
  s.st / s.ts / s.pstn   seções totalizadas / total / % totalizadas
  e.te / e.c / e.a       eleitorado / comparecimento / abstenção
  v.vv / v.vb / v.tvn    votos válidos / brancos / nulos (inclui nulos técnicos)
  carg[].agr[].par[].cand[].n / vap   número / votos apurados do candidato
  dt / ht                data/hora da totalização; tf = "s" totalização final
"""
import asyncio
import logging
import time
from datetime import datetime

import httpx

BASE = "https://resultados.tse.jus.br/oficial"
CICLO = "ele2026"
CANDIDATOS = {"22": "flavio", "13": "lula"}

log = logging.getLogger("tse")


def path_config_mun(ele):
    return f"/{CICLO}/{ele}/config/mun-e{int(ele):06d}-cm.json"


def path_result(ele, uf, cdmun=None):
    e = f"{int(ele):06d}"
    if uf == "br":
        return f"/{CICLO}/{ele}/dados/br/br-c0001-e{e}-u.json"
    nome = f"{uf}{cdmun}" if cdmun else uf
    return f"/{CICLO}/{ele}/dados/{uf}/{nome}-c0001-e{e}-u.json"


def path_ab(ele, uf):
    return f"/{CICLO}/{ele}/dados/{uf}/{uf}-e{int(ele):06d}-ab.json"


def _int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def _float(x):
    try:
        return float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def tse_time(d):
    """'25/10/2026' + '17:05:12' -> '2026-10-25T17:05:12' (ou '' se vazio)."""
    dt, ht = d.get("dt") or "", d.get("ht") or ""
    if not dt or not ht:
        return ""
    try:
        return datetime.strptime(f"{dt} {ht}", "%d/%m/%Y %H:%M:%S").isoformat()
    except ValueError:
        return ""


def parse_result(d):
    """Arquivo *-c0001-*-u.json -> ponto no formato das séries (sem 'ts')."""
    s, e, v = d.get("s", {}), d.get("e", {}), d.get("v", {})
    votos = {k: 0 for k in CANDIDATOS.values()}
    for carg in d.get("carg", []):
        for agr in carg.get("agr", []):
            for par in agr.get("par", []):
                for cand in par.get("cand", []):
                    k = CANDIDATOS.get(str(cand.get("n")))
                    if k:
                        votos[k] = _int(cand.get("vap"))
    return {
        "tse": tse_time(d),
        "pct_apurado": round(_float(s.get("pstn")), 4),
        "s": [_int(s.get("st")), _int(s.get("ts"))],
        "votos": votos,
        "validos": _int(v.get("vv")),
        "brancos": _int(v.get("vb")),
        "nulos": _int(v.get("tvn")),
        "abst": _int(e.get("a")),
        "eleitorado": _int(e.get("te")),
        "comparecimento": _int(e.get("c")),
        "final": d.get("tf") == "s",
    }


def parse_ab_entry(x):
    """Entrada de EA14/EA15 -> ponto parcial (sem votos) + chave de mudança."""
    s, e = x.get("s", {}), x.get("e", {})
    return {
        "tse": tse_time(x),
        "pct_apurado": round(_float(s.get("pstn")), 4),
        "s": [_int(s.get("st")), _int(s.get("ts"))],
        "votos": {k: 0 for k in CANDIDATOS.values()},
        "validos": 0,
        "brancos": 0,
        "nulos": 0,
        "abst": _int(e.get("a")),
        "eleitorado": _int(e.get("te")),
        "comparecimento": _int(e.get("c")),
    }


def ab_key(x):
    s = x.get("s", {})
    return f"{x.get('dt', '')} {x.get('ht', '')} {s.get('st', '')}"


class TSEClient:
    """GET com limite de taxa global, semáforo, ETag e pausa em caso de bloqueio."""

    def __init__(self, base=BASE, rps=20, concurrency=10):
        self.base = base
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            headers={"User-Agent": "painel-apuracao-2026 (github actions)"},
            follow_redirects=False,
        )
        self.sem = asyncio.Semaphore(concurrency)
        self.interval = 1.0 / rps
        self._next = 0.0
        self._lock = asyncio.Lock()
        self.etags = {}
        self.blocked_until = 0.0
        self.stats = {"req": 0, "200": 0, "304": 0, "404": 0, "err": 0}

    async def close(self):
        await self.client.aclose()

    async def _throttle(self):
        async with self._lock:
            now = time.monotonic()
            wait = self._next - now
            self._next = max(now, self._next) + self.interval
        if wait > 0:
            await asyncio.sleep(wait)

    async def get(self, path, use_etag=True):
        """Retorna (json|None, changed). 304 -> (None, False)."""
        if time.monotonic() < self.blocked_until:
            return None, False
        headers = {}
        if use_etag and path in self.etags:
            headers["If-None-Match"] = self.etags[path]
        async with self.sem:
            await self._throttle()
            self.stats["req"] += 1
            try:
                r = await self.client.get(self.base + path, headers=headers)
            except httpx.HTTPError as ex:
                self.stats["err"] += 1
                log.warning("erro de rede %s: %s", path, ex)
                return None, False
        if r.status_code == 304:
            self.stats["304"] += 1
            return None, False
        if r.status_code == 200:
            self.stats["200"] += 1
            try:
                data = r.json()
            except ValueError:
                self.stats["err"] += 1
                log.warning("JSON inválido em %s", path)
                return None, False
            if r.headers.get("etag"):
                self.etags[path] = r.headers["etag"]
            return data, True
        if r.status_code == 404:
            self.stats["404"] += 1
            log.warning("404 %s", path)
        else:
            self.stats["err"] += 1
            log.warning("HTTP %s %s", r.status_code, path)
            if r.status_code in (403, 429):
                # Provável bloqueio de IP: para tudo por 2 min (não insistir reinicia o bloqueio)
                self.blocked_until = time.monotonic() + 120
                log.error("possível bloqueio do TSE; pausando requisições por 120s")
        return None, False
