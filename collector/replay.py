"""Gera uma apuração SINTÉTICA a partir do 1º turno, para testar o site localmente.

Cada município "entra" num horário que depende da região (S/SE primeiro, NE e exterior depois)
e avança aos poucos; a divisão Flávio x Lula vem do 1º turno (normalizada) com um swing por UF.
Uso: python collector/replay.py --base data-out --out data-test
Depois: python -m http.server  e abra http://localhost:8000/?fonte=teste
"""
import argparse
import json
import os
import random
import shutil
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import REGIOES, Store, aggregate  # noqa: E402

UF_REG = {uf: r for r, ufs in REGIOES.items() for uf in ufs}
UF_REG["zz"] = "ZZ"
# (início em minutos após 17h, duração média) por região
RITMO = {"S": (0, 35), "SE": (2, 45), "CO": (4, 45), "N": (8, 60), "NE": (10, 70), "ZZ": (25, 60)}


def main(base, out, passos, seed):
    rnd = random.Random(seed)
    with open(os.path.join(base, "base_1t", "mun.json"), encoding="utf-8") as f:
        mun1 = json.load(f)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    shutil.copytree(os.path.join(base, "base_1t"), os.path.join(out, "base_1t"))
    if os.path.exists(os.path.join(base, "t1")):
        shutil.copytree(os.path.join(base, "t1"), os.path.join(out, "t1"))
    if os.path.exists(os.path.join(base, "municipios.json")):
        shutil.copy(os.path.join(base, "municipios.json"), out)

    swing = {uf: rnd.uniform(-0.03, 0.03) for uf in mun1}
    plano = {}
    for uf, ms in mun1.items():
        ini, dur = RITMO[UF_REG[uf]]
        for cd, (te, c, fl, lu, vv, vb, vn) in ms.items():
            # capitais/grandes cidades demoram mais
            peso = 1 + min(2.0, te / 500_000)
            plano[(uf, cd)] = (ini + rnd.uniform(0, 20), dur * peso * rnd.uniform(0.5, 1.2))

    store = Store(out)
    t0 = datetime(2026, 10, 25, 17, 0, 0)
    for k in range(passos + 1):
        minuto = k * 2
        ts = (t0 + timedelta(minutes=minuto)).isoformat() + "-03:00"
        tse = (t0 + timedelta(minutes=minuto)).isoformat()
        ufpts = {}
        for uf, ms in mun1.items():
            pts = []
            for cd, (te, c, fl, lu, vv, vb, vn) in ms.items():
                ini, dur = plano[(uf, cd)]
                f = min(1.0, max(0.0, (minuto - ini) / dur))
                secoes = max(1, round(te / 330))
                st = round(f * secoes)
                f = st / secoes
                share = fl / (fl + lu) if fl + lu else 0.5
                share = min(0.99, max(0.01, share - 0.03 + swing[uf]))
                comp = round(c * f)
                validos = round((vv + 0.6 * vn) * f)
                flavio = round(validos * share)
                p = {
                    "tse": tse if st else "",
                    "pct_apurado": round(100 * f, 4),
                    "s": [st, secoes],
                    "votos": {"flavio": flavio, "lula": validos - flavio},
                    "validos": validos,
                    "brancos": round(vb * f),
                    "nulos": max(0, comp - validos - round(vb * f)),
                    "abst": round((te - c) * f),
                    "eleitorado": te,
                    "comparecimento": comp,
                }
                store.set_mun(uf, cd, p, ts)
                pts.append(p)
            ufpts[uf] = aggregate(pts)
            store.set_uf(uf, ufpts[uf], ts)
        store.update_regions(ts)
        br = aggregate(list(ufpts.values()))
        store.set_br(br, ts)
        status = "finalizado" if br["pct_apurado"] >= 100 else "apurando"
        store.flush({"eleicao": "teste", "ultima_coleta": ts, "ultima_totalizacao_tse": tse,
                     "pct_apurado_br": br["pct_apurado"], "status": status, "municipios_pendentes": 0},
                    force_meta=True)
        print(f"{ts} BR {br['pct_apurado']:6.2f}%  F {br['votos']['flavio']:>10}  L {br['votos']['lula']:>10}")
        if status == "finalizado":
            break


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="data-out", help="pasta com base_1t/ (e municipios.json)")
    ap.add_argument("--out", default="data-test")
    ap.add_argument("--passos", type=int, default=120)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    main(a.base, a.out, a.passos, a.seed)
