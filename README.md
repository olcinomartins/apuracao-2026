# Apuração · 2º turno Presidente 2026

Painel público com a apuração do 2º turno (Flávio Bolsonaro x Lula) por Brasil, região, UF e município,
**com o histórico da evolução**. O TSE só publica a foto atual; o histórico vem de um coletor que grava
snapshots a cada ~60 s.

**Painel:** https://olcinomartins.github.io/apuracao-2026/

## Como disparar

1. GitHub → **Actions** → **apuracao** → **Run workflow** (padrões: eleição `6258`, 350 min, pasta vazia).
2. Há um `schedule` de reserva às 19:45 UTC (16:45 em Brasília) de 25/10. Se o manual já estiver rodando,
   o reserva fica na fila (`concurrency`) e, ao começar, só complementa os dados. **Desative o workflow depois
   da eleição** (o cron também casaria com 25/10 de outros anos).
3. O coletor encerra sozinho quando o Brasil tiver totalização final (depois de drenar os municípios, até 15 min)
   ou após 5h50.

Teste: rode com `eleicao=6257`, `minutos=3`, `pasta=teste-6257`. Os dados vão para `teste-6257/` na branch `data`
sem tocar nos dados reais.

## Como funciona

- `main`: coletor (`collector/`), workflow e site estático (GitHub Pages, raiz da `main`).
- `data`: só os dados (`series/`, `latest.json`, `meta.json`, `municipios.json`, `base_1t/`). Commits frequentes
  ali não disparam rebuild do Pages. O site lê de `raw.githubusercontent.com/.../data/` e se atualiza a cada 60 s.
- Coletor: baixa Brasil + EA14; só as UFs cujo horário/seções mudaram (inclusive ZZ); para essas, o EA15 e só os
  municípios que mudaram. Usa ETag, ~20 req/s com semáforo, só URLs montadas a partir dos arquivos do TSE, e
  pausa 2 min se receber 403/429. Municípios sem nenhuma seção totalizada não são baixados (o EA15 já basta).
- Local: `python collector/build_base_1t.py --out <pasta>` gera `base_1t/`;
  `python collector/replay.py --base <pasta> --out data-test` gera uma apuração sintética;
  `python -m http.server` e abra `http://localhost:8000/?fonte=teste`.

## Projeções (estimativas não oficiais)

- **Linear:** regressão da margem (Flávio − Lula, p.p.) contra % apurado nos últimos N pontos (padrão 10),
  extrapolada até 100%. Aparece tracejada no gráfico de evolução.
- **Ponderada (bottom-up):** por município, votos faltantes = eleitorado × comparecimento esperado − apurados.
  Comparecimento esperado = o do local se > 30% apurado, senão o do 1º turno. Divisão = % atual do local; com
  < 5% apurado, divisão Flávio/Lula do 1º turno (normalizada) + swing médio observado na UF. Soma até o nível
  escolhido.
- Elas divergem porque a ordem de apuração não é aleatória (regiões, capitais e exterior chegam em momentos
  diferentes).

## Limitações

- Atraso de alguns minutos: ciclo de 60 s + push + cache do `raw.githubusercontent.com` (~5 min).
- No pico, municípios podem levar alguns ciclos para alcançar o TSE (limite de ~20 req/s).
- "% apurado" é % de seções totalizadas. "Votos restantes" e o selo "matematicamente definido" usam a
  estimativa ponderada, não um número oficial.
- Se o GitHub Actions falhar ou o TSE bloquear o IP do runner, o histórico fica com lacunas.
