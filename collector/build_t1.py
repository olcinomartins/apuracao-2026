"""Gera t1/ (foto final do 1º turno, todos os candidatos) para o seletor de turno do site.

Uso: python collector/build_t1.py --out data-out
Saída:
  t1/latest.json     mesmo formato do latest.json do 2º turno; cada ponto tem também
                     "cand": {numero: votos}
  t1/candidatos.json [{"n": "22", "nome": "FLAVIO BOLSONARO"}, ...] por votos no Brasil
  t1/meta.json
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import REGIOES, UFS, _dump, aggregate, now_ts  # noqa: E402
from tse import TSEClient, parse_result, path_ab, path_result  # noqa: E402

log = logging.getLogger("t1")
NOMES = {}


def ponto(d):
    p = parse_result(d)
    p.pop("final", None)
    cand = {}
    for carg in d.get("carg", []):
        for agr in carg.get("agr", []):
            for par in agr.get("par", []):
                for c in par.get("cand", []):
                    cand[str(c["n"])] = int(c.get("vap") or 0)
                    NOMES[str(c["n"])] = c.get("nmu") or c.get("nm")
    p["cand"] = cand
    return p


def soma(pts):
    pts = [p for p in pts if p]
    agg = aggregate(pts)
    if agg:
        agg["cand"] = {}
        for p in pts:
            for n, v in p["cand"].items():
                agg["cand"][n] = agg["cand"].get(n, 0) + v
    return agg


async def main(out, ele, rps):
    cli = TSEClient(rps=rps)
    d, _ = await cli.get(path_result(ele, "br"))
    br = ponto(d)
    ufs, mun = {}, {}

    async def uf_task(uf):
        d, _ = await cli.get(path_result(ele, uf))
        if d:
            ufs[uf] = ponto(d)
        ab, _ = await cli.get(path_ab(ele, uf))
        cds = [x["cdabr"] for x in (ab or {}).get("abr", []) if x.get("tpabr") == "mun"]
        mun[uf] = {}

        async def mun_task(cd):
            d, _ = await cli.get(path_result(ele, uf, cd))
            if d:
                mun[uf][cd] = ponto(d)

        await asyncio.gather(*[mun_task(cd) for cd in cds])
        log.info("%s: %d/%d municípios", uf, len(mun[uf]), len(cds))

    await asyncio.gather(*[uf_task(uf) for uf in UFS])
    await cli.close()
    reg = {r: soma([ufs.get(u) for u in us]) for r, us in REGIOES.items()}
    ts = now_ts()
    base = os.path.join(out, "t1")
    _dump(os.path.join(base, "latest.json"), {"ts": ts, "br": br, "regiao": reg, "uf": ufs, "mun": mun})
    ordem = sorted(br["cand"], key=lambda n: -br["cand"][n])
    _dump(os.path.join(base, "candidatos.json"), [{"n": n, "nome": NOMES.get(n, n)} for n in ordem])
    _dump(os.path.join(base, "meta.json"), {"eleicao": ele, "ultima_coleta": ts, "ultima_totalizacao_tse": br["tse"],
                                             "pct_apurado_br": br["pct_apurado"], "status": "finalizado"})
    log.info("ok | req %s", cli.stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data-out")
    ap.add_argument("--eleicao", default="6257")
    ap.add_argument("--rps", type=float, default=20)
    a = ap.parse_args()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    asyncio.run(main(a.out, a.eleicao, a.rps))
