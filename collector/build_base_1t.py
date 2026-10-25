"""Gera base_1t/ com o resultado final do 1º turno (6257) por Brasil, UF e município.

Uso: python collector/build_base_1t.py --out data-out
Saída:
  base_1t/br.json, base_1t/uf.json {uf: ponto}
  base_1t/mun.json {uf: {cd: [eleitorado, comparecimento, flavio, lula, validos, brancos, nulos]}}
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import UFS, _dump  # noqa: E402
from tse import TSEClient, parse_result, path_ab, path_result  # noqa: E402

log = logging.getLogger("base_1t")


async def main(out, ele, rps):
    cli = TSEClient(rps=rps)
    d, _ = await cli.get(path_result(ele, "br"))
    br = parse_result(d)
    ufs, mun = {}, {}

    async def uf_task(uf):
        d, _ = await cli.get(path_result(ele, uf))
        if d:
            ufs[uf] = parse_result(d)
        ab, _ = await cli.get(path_ab(ele, uf))
        cds = [x["cdabr"] for x in (ab or {}).get("abr", []) if x.get("tpabr") == "mun"]
        mun[uf] = {}

        async def mun_task(cd):
            d, _ = await cli.get(path_result(ele, uf, cd))
            if d:
                p = parse_result(d)
                mun[uf][cd] = [p["eleitorado"], p["comparecimento"], p["votos"]["flavio"], p["votos"]["lula"],
                               p["validos"], p["brancos"], p["nulos"]]

        await asyncio.gather(*[mun_task(cd) for cd in cds])
        log.info("%s: %d/%d municípios", uf, len(mun[uf]), len(cds))

    await asyncio.gather(*[uf_task(uf) for uf in UFS])
    await cli.close()
    for p in [br, *ufs.values()]:
        p.pop("final", None)
    base = os.path.join(out, "base_1t")
    _dump(os.path.join(base, "br.json"), br)
    _dump(os.path.join(base, "uf.json"), ufs)
    _dump(os.path.join(base, "mun.json"), mun)
    log.info("BR 1T: Flávio %d Lula %d | %d municípios | req %s", br["votos"]["flavio"], br["votos"]["lula"],
             sum(len(v) for v in mun.values()), cli.stats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data-out")
    ap.add_argument("--eleicao", default="6257")
    ap.add_argument("--rps", type=float, default=20)
    a = ap.parse_args()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    asyncio.run(main(a.out, a.eleicao, a.rps))
