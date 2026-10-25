"""Séries históricas (só acrescenta quando muda), agregação por região e escrita dos JSON."""
import json
import os
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))

REGIOES = {
    "N": ["ac", "am", "ap", "pa", "ro", "rr", "to"],
    "NE": ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"],
    "CO": ["df", "go", "ms", "mt"],
    "SE": ["es", "mg", "rj", "sp"],
    "S": ["pr", "rs", "sc"],
}
UFS = sorted(uf for ufs in REGIOES.values() for uf in ufs) + ["zz"]
SOMA = ["validos", "brancos", "nulos", "abst", "eleitorado", "comparecimento"]


def now_ts():
    return datetime.now(BRT).replace(microsecond=0).isoformat()


def _same(a, b):
    if a is None or b is None:
        return False
    keys = ["pct_apurado", "s", "votos", "validos", "brancos", "nulos", "abst", "eleitorado", "comparecimento"]
    return all(a.get(k) == b.get(k) for k in keys)


def clean(p, ts):
    q = {k: v for k, v in p.items() if k != "final"}
    q["ts"] = ts
    return q


def aggregate(points):
    pts = [p for p in points if p]
    if not pts:
        return None
    st = sum(p["s"][0] for p in pts)
    tot = sum(p["s"][1] for p in pts)
    agg = {
        "tse": max((p.get("tse") or "" for p in pts), default=""),
        "pct_apurado": round(100.0 * st / tot, 4) if tot else 0.0,
        "s": [st, tot],
        "votos": {k: sum(p["votos"][k] for p in pts) for k in pts[0]["votos"]},
    }
    for k in SOMA:
        agg[k] = sum(p[k] for p in pts)
    return agg


def _dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


class Store:
    def __init__(self, out):
        self.out = out
        sd = os.path.join(out, "series")
        self.br = _load(os.path.join(sd, "br.json"), [])
        self.reg = {r: _load(os.path.join(sd, "regiao", f"{r}.json"), []) for r in REGIOES}
        self.uf = {uf: _load(os.path.join(sd, "uf", f"{uf}.json"), []) for uf in UFS}
        self.mun = {uf: _load(os.path.join(sd, "mun", f"{uf}.json"), {}) for uf in UFS}
        self.dirty = set()

    def _append(self, serie, p, ts, tag):
        last = serie[-1] if serie else None
        if _same(last, p):
            return False
        serie.append(clean(p, ts))
        self.dirty.add(tag)
        return True

    def set_br(self, p, ts):
        return self._append(self.br, p, ts, ("br",))

    def set_uf(self, uf, p, ts):
        return self._append(self.uf[uf], p, ts, ("uf", uf))

    def set_mun(self, uf, cd, p, ts):
        return self._append(self.mun[uf].setdefault(cd, []), p, ts, ("mun", uf))

    def update_regions(self, ts):
        changed = False
        for r, ufs in REGIOES.items():
            agg = aggregate([self.uf[u][-1] if self.uf[u] else None for u in ufs])
            if agg:
                changed |= self._append(self.reg[r], agg, ts, ("reg", r))
        return changed

    def latest(self):
        last = lambda s: s[-1] if s else None
        return {
            "br": last(self.br),
            "regiao": {r: last(s) for r, s in self.reg.items()},
            "uf": {u: last(s) for u, s in self.uf.items()},
            "mun": {u: {cd: {k: v for k, v in s[-1].items() if k != "ts"} for cd, s in m.items() if s}
                    for u, m in self.mun.items()},
        }

    def flush(self, meta, force_meta=False):
        """Grava arquivos sujos + latest + meta. Retorna True se algo de dados mudou."""
        had_data = bool(self.dirty)
        sd = os.path.join(self.out, "series")
        for tag in self.dirty:
            if tag[0] == "br":
                _dump(os.path.join(sd, "br.json"), self.br)
            elif tag[0] == "reg":
                _dump(os.path.join(sd, "regiao", f"{tag[1]}.json"), self.reg[tag[1]])
            elif tag[0] == "uf":
                _dump(os.path.join(sd, "uf", f"{tag[1]}.json"), self.uf[tag[1]])
            elif tag[0] == "mun":
                _dump(os.path.join(sd, "mun", f"{tag[1]}.json"), self.mun[tag[1]])
        self.dirty.clear()
        if had_data:
            _dump(os.path.join(self.out, "latest.json"), {"ts": meta["ultima_coleta"], **self.latest()})
        if had_data or force_meta:
            _dump(os.path.join(self.out, "meta.json"), meta)
        return had_data
