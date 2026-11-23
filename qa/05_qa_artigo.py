"""QA automático do contrato Nazarick (complementa a leitura humana; não a substitui).
Uso: python3 05_qa_artigo.py artigo.html --portal canalrural.com.br [--componentes]"""
import re, sys, html

s = open(sys.argv[1], encoding="utf-8").read()
portal = sys.argv[sys.argv.index("--portal") + 1] if "--portal" in sys.argv else ""
comp = "--componentes" in sys.argv
corpo = re.sub(r"<style.*?</style>|<!--.*?-->", "", s, flags=re.S)
def vis(t): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()
ok = True
def check(cond, msg):
    global ok
    print(("OK   " if cond else "FALHA"), msg); ok = ok and bool(cond)

lide = re.search(r"</h1>\s*<p>(.*?)</p>", s, re.S)
n = len(vis(lide.group(1))) if lide else 0
check(300 <= n <= 320, f"lide com {n} caracteres (300 a 320)")
check(lide and "href" not in lide.group(1), "lide sem link")
h2 = re.findall(r"<h2[^>]*>(.*?)</h2>", s, re.S)
perg = [i + 1 for i, h in enumerate(h2) if vis(h).endswith("?")]
check(len(h2) == 6 and len(perg) == 3, f"{len(h2)} H2, perguntas em {perg}")
check(not any(re.search(r"<(strong|b)\b", h) for h in h2), "nenhum negrito em H2")
palavras = len(vis(re.sub(r"<p>\s*https?://\S+\s*</p>", "", corpo)).split())
check(650 <= palavras <= 800, f"{palavras} palavras visíveis (650 a 800)")

anchors = re.findall(r"<a [^>]+>", s)
check(all('target="_blank"' in a and 'rel="noopener"' in a for a in anchors), "todos os links com target e rel")
urls = re.findall(r'href="([^"]+)"', s)
internos = [u for u in urls if portal and portal in u]
externos = [u for u in urls if u not in internos]
check(len(set(internos)) == 2, f"{len(set(internos))} internos do portal (esperado 2)")
check(len(set(externos)) == 2, f"{len(set(externos))} externos (esperado 2)")
check(not any(re.search(r"\.br(/|$)", u) for u in externos), "nenhum externo brasileiro (.br)")
print("     internos:", internos); print("     externos:", externos)
print("     CONFERIR À MÃO: externo brasileiro em .com e nome de site/veículo brasileiro citado na prosa")

# ponte da lista em parágrafo próprio, terminado em dois-pontos, logo antes da lista
m = re.search(r"((?:<p>.*?</p>\s*){3})<ul>", s, re.S)
if m:
    ps = re.findall(r"<p>(.*?)</p>", m.group(1), re.S)
    ponte = vis(ps[-1])
    check(ponte.endswith(":") and len(ponte.split()) <= 25, f"ponte da lista em linha própria: \"{ponte}\"")
    check(not vis(ps[-2]).endswith(":"), "parágrafo anterior à ponte não termina em dois-pontos")
else:
    check(False, "lista do H2 3 precedida de dois parágrafos e uma ponte própria")

check(not re.search(r"[—–]| - ", vis(corpo)), "sem travessão, meia-risca ou hífen cercado de espaços")
check(bool(re.search(r"<p>\s*\nhttps://www\.youtube\.com/watch\?v=[\w-]+\s*\n</p>", s)) or "youtube" not in s, "URL do vídeo em parágrafo exclusivo")
blocos = s.count("<!-- wp:html -->")
check(blocos == (2 if comp else 0), f"{blocos} blocos wp:html (esperado {2 if comp else 0})")

# negrito: parágrafos de conteúdo com 2 a 5 trechos em strong
fracos = []
for p in re.findall(r"<p>(.*?)</p>", s, re.S):
    t = vis(p)
    if t.endswith(":") or t.startswith("http") or len(t.split()) < 25: continue
    if len(re.findall(r"<strong>", p)) < 2: fracos.append(t[:50])
check(not fracos, f"parágrafos com menos de 2 trechos em strong: {fracos}")
print("\nRESULTADO:", "OK" if ok else "HÁ FALHAS")
