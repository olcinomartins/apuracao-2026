"""Coletor da apuração: grava snapshots do TSE a cada ~60s e publica na branch `data`.

Uso:
  python collector/collect.py --eleicao 6258 --out data-out --repo data-out --push
"""
import argparse
import asyncio
import logging
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import Store, now_ts, _dump  # noqa: E402
from tse import (TSEClient, ab_key, parse_ab_entry, parse_result,  # noqa: E402
                 path_ab, path_config_mun, path_result)

log = logging.getLogger("coletor")

MAX_TENTATIVAS = 5      # tentativas para um arquivo "atrasado" em relação ao EA14/EA15
HEARTBEAT_S = 600       # publica meta.json mesmo sem dados novos a cada 10 min


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def git_publish(repo, msg):
    git(repo, "add", "-A")
    if git(repo, "diff", "--cached", "--quiet").returncode == 0:
        return True
    r = git(repo, "commit", "-q", "-m", msg)
    if r.returncode != 0:
        log.error("git commit falhou: %s", r.stderr.strip())
        return False
    for i in range(4):
        r = git(repo, "pull", "--rebase", "-q", "origin", "data")
        if r.returncode != 0:
            log.warning("git pull --rebase falhou (%d): %s", i + 1, r.stderr.strip())
            git(repo, "rebase", "--abort")
        else:
            r = git(repo, "push", "-q", "origin", "HEAD:data")
            if r.returncode == 0:
                return True
            log.warning("git push falhou (%d): %s", i + 1, r.stderr.strip())
        time.sleep(3 * (i + 1))
    return False


class Coletor:
    def __init__(self, args):
        self.a = args
        self.ele = args.eleicao
        self.cli = TSEClient(rps=args.rps)
        self.store = Store(args.out)
        self.ea14 = {}          # uf -> entrada EA14
        self.uf_seen = {}       # uf -> ab_key confirmado no arquivo da UF
        self.ea15_seen = {}     # uf -> ab_key do EA14 para o qual o EA15 já foi lido
        self.mun_seen = {}      # (uf, cd) -> ab_key confirmado
        self.tries = {}         # chave -> tentativas
        self.pending = {}       # (uf, cd) -> (st_alvo, ab_key)
        self.br_final = False
        self.br_tse = ""
        self.last_publish = 0.0

    def _try(self, key):
        self.tries[key] = self.tries.get(key, 0) + 1
        return self.tries[key] >= MAX_TENTATIVAS

    async def ensure_municipios(self):
        path = os.path.join(self.a.out, "municipios.json")
        if os.path.exists(path):
            return
        d, _ = await self.cli.get(path_config_mun(self.ele), use_etag=False)
        if not d:
            log.warning("não consegui baixar a configuração de municípios")
            return
        mun = {u["cd"]: {m["cd"]: m["nm"] for m in u.get("mu", [])} for u in d.get("abr", [])}
        _dump(path, mun)
        log.info("municipios.json: %d municípios", sum(len(v) for v in mun.values()))

    async def fetch_uf(self, uf, entry, ts):
        key = ab_key(entry)
        if int(entry.get("s", {}).get("st") or 0) == 0:
            self.store.set_uf(uf, parse_ab_entry(entry), ts)
            self.uf_seen[uf] = key
            return
        d, _ = await self.cli.get(path_result(self.ele, uf))
        target = int(entry["s"]["st"])
        if d:
            p = parse_result(d)
            self.store.set_uf(uf, p, ts)
            if p["s"][0] >= target:
                self.uf_seen[uf] = key
                return
        if self._try(("uf", uf, key)):
            self.uf_seen[uf] = key

    async def fetch_ea15(self, uf, ts):
        key = ab_key(self.ea14[uf])
        d, _ = await self.cli.get(path_ab(self.ele, uf))
        if not d:
            if self._try(("ea15", uf, key)):
                self.ea15_seen[uf] = key
            return
        self.ea15_seen[uf] = key
        for x in d.get("abr", []):
            if x.get("tpabr") != "mun":
                continue
            cd, k = x["cdabr"], ab_key(x)
            if self.mun_seen.get((uf, cd)) == k:
                continue
            st = int(x.get("s", {}).get("st") or 0)
            if st == 0:
                self.store.set_mun(uf, cd, parse_ab_entry(x), ts)
                self.mun_seen[(uf, cd)] = k
                self.pending.pop((uf, cd), None)
            else:
                self.pending[(uf, cd)] = (st, k)

    async def fetch_mun(self, uf, cd, ts):
        target, k = self.pending[(uf, cd)]
        d, _ = await self.cli.get(path_result(self.ele, uf, cd))
        if d:
            p = parse_result(d)
            self.store.set_mun(uf, cd, p, ts)
            if p["s"][0] >= target:
                self.mun_seen[(uf, cd)] = k
                self.pending.pop((uf, cd), None)
                return
        if self._try(("mun", uf, cd, k)):
            self.mun_seen[(uf, cd)] = k
            self.pending.pop((uf, cd), None)

    async def _safe(self, coro, what):
        try:
            await coro
        except Exception:  # nunca derrubar o loop por um arquivo
            log.exception("erro processando %s", what)

    async def cycle(self, deadline):
        ts = now_ts()
        d, _ = await self.cli.get(path_result(self.ele, "br"))
        if d:
            p = parse_result(d)
            self.br_final, self.br_tse = p["final"], p["tse"]
            self.store.set_br(p, ts)
        ab, _ = await self.cli.get(path_ab(self.ele, "br"))
        if ab:
            self.ea14 = {x["cdabr"]: x for x in ab.get("abr", []) if x.get("tpabr") == "uf"}

        ufs = [u for u, x in self.ea14.items() if ab_key(x) != self.uf_seen.get(u)]
        ea15 = [u for u, x in self.ea14.items() if ab_key(x) != self.ea15_seen.get(u)]
        await asyncio.gather(
            *[self._safe(self.fetch_uf(u, self.ea14[u], ts), f"UF {u}") for u in ufs],
            *[self._safe(self.fetch_ea15(u, ts), f"EA15 {u}") for u in ea15],
        )
        self.store.update_regions(ts)

        # Municípios pendentes, priorizando os de maior % já totalizada no EA15 (mais votos novos)
        fila = sorted(self.pending, key=lambda k: -self.pending[k][0])
        feitos = 0
        for i in range(0, len(fila), 40):
            if time.monotonic() > deadline:
                break
            lote = fila[i:i + 40]
            await asyncio.gather(*[self._safe(self.fetch_mun(u, c, ts), f"mun {u}{c}") for u, c in lote])
            feitos += len(lote)
        return ts, len(ufs), len(ea15), feitos

    def meta(self, ts, status):
        br = self.store.br[-1] if self.store.br else {}
        return {
            "eleicao": self.ele,
            "ultima_coleta": ts,
            "ultima_totalizacao_tse": self.br_tse,
            "pct_apurado_br": br.get("pct_apurado", 0),
            "status": status,
            "municipios_pendentes": len(self.pending),
        }

    async def run(self):
        start = time.monotonic()
        limite = start + self.a.minutos * 60
        await self.ensure_municipios()
        n = 0
        final_desde = None
        while True:
            n += 1
            t0 = time.monotonic()
            ts, nuf, nea15, nmun = await self.cycle(deadline=min(t0 + self.a.intervalo - 12, limite))
            br = self.store.br[-1] if self.store.br else None
            status = "finalizado" if self.br_final else ("apurando" if br and br["pct_apurado"] > 0 else "aguardando")
            fim_tempo = time.monotonic() >= limite
            if self.br_final and final_desde is None:
                final_desde = time.monotonic()
            # Após o final do BR, continua até 15 min para drenar municípios pendentes
            acabou = fim_tempo or (self.br_final and (not self.pending or time.monotonic() - final_desde > 900))
            if fim_tempo and not self.br_final:
                status = "encerrado"
            heartbeat = time.monotonic() - self.last_publish > HEARTBEAT_S
            mudou = self.store.flush(self.meta(ts, status), force_meta=heartbeat or acabou)
            if br:
                log.info("ciclo %d | BR %.2f%% F=%d L=%d | UFs %d EA15 %d mun %d pend %d | req %s | %.1fs",
                         n, br["pct_apurado"], br["votos"]["flavio"], br["votos"]["lula"],
                         nuf, nea15, nmun, len(self.pending), self.cli.stats, time.monotonic() - t0)
            if self.a.push and (mudou or heartbeat or acabou):
                ok = await asyncio.to_thread(
                    git_publish, self.a.repo, f"apuração {ts} BR {br['pct_apurado'] if br else 0:.2f}%")
                if ok:
                    self.last_publish = time.monotonic()
                else:
                    log.error("publicação falhou; tento no próximo ciclo")
            if acabou or self.a.once:
                log.info("encerrando: status=%s", status)
                break
            await asyncio.sleep(max(1.0, self.a.intervalo - (time.monotonic() - t0)))
        await self.cli.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eleicao", default="6258")
    ap.add_argument("--out", default="data-out", help="pasta onde gravar os dados")
    ap.add_argument("--repo", default=None, help="raiz git da branch data (padrão: --out)")
    ap.add_argument("--push", action="store_true", help="commit/push na branch data")
    ap.add_argument("--minutos", type=float, default=350)
    ap.add_argument("--intervalo", type=float, default=60)
    ap.add_argument("--rps", type=float, default=20)
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    a.repo = a.repo or a.out
    os.makedirs(a.out, exist_ok=True)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")
    asyncio.run(Coletor(a).run())


if __name__ == "__main__":
    main()
