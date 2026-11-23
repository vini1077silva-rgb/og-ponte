// ==UserScript==
// @name         OG Ponte · Flow ⇄ Planilha ⇄ WordPress ⇄ ChatGPT
// @namespace    nazarick.oestegeral
// @version      1.2.3
// @updateURL    https://raw.githubusercontent.com/vini1077silva-rgb/og-ponte/main/og-ponte.user.js
// @downloadURL  https://raw.githubusercontent.com/vini1077silva-rgb/og-ponte/main/og-ponte.user.js
// @description  Leva prompts da planilha Nazarick ao Flow, prepara as imagens em 1280x720 JPG, manda os textos para revisão da AURA no ChatGPT, confere texto, links e português, e monta/agenda os posts nos WordPress (Oeste Geral, Em Foco, Além do Agro, UAI) sem passar o conteúdo pelo chat.
// @match        https://labs.google/fx/*
// @match        https://flow.google.com/*
// @match        https://revistaoeste.com/oestegeral/wp-admin/*
// @match        https://www.em.com.br/emfoco/wp-admin/*
// @match        https://www.canalrural.com.br/alem-do-agro/wp-admin/*
// @match        https://www.uai.com.br/wp-admin/*
// @match        https://chatgpt.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      googleapis.com
// @connect      labs.google
// @connect      flow.google.com
// @connect      *
// @sandbox      JavaScript
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* Uso: todas as funções ficam em window.og (no console ou pela ferramenta do navegador).
   Funções longas devolvem Promise e também gravam o andamento em og.st e o resultado em og.r.

   Novidades 1.1.0
   • ChatGPT: og.gpt.enviar(linha) manda um texto da planilha para a AURA (uma conversa por texto);
     og.gpt.ler() lê a resposta, descarta correção cujo trecho não existe no texto e guarda o resultado;
     og.revisoes() lista as revisões guardadas em qualquer aba (Flow, WP ou ChatGPT).
   • Flow: og.empacotar recusa chave fora do padrão 'L128-capa', 'L128-1'...
   • WordPress: og.lote recusa post novo sem as 4 imagens e com título já existente no site;
     URL do YouTube sozinha num parágrafo vira bloco de incorporação; a 3ª interna nunca fica colada no vídeo;
     og.trocarImagem troca uma imagem sem reconstruir o post (mantém título, legendas e edições manuais). */

(function () {
  'use strict';
  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // ---------------------------------------------------------------- configuração
  const CFG = {
    planilhaId: '1RXmLaivHBlB9TtQWTUTrTRJQq30MuwAzA8mcaiXsNsc',   // Nazarick (fixa)
    abaGid: null,                  // null = aba do site ativo (og.site)
    largura: 1280,
    altura: 720,
    qualidadeJpg: 0.9,
    maxTags: 4,
    folgaAgendamentoMin: 10,       // recusa agendar com menos que isso de antecedência
    pausaEnvioMs: 3500,            // intervalo entre prompts no Flow
    projetoRevisao: 'https://chatgpt.com/g/g-p-6b042bb35700819190e86cc756449de8/project', // AURA
    mensagemCurta: false,          // true quando as instruções da AURA estiverem no projeto
    lide: [300, 320], palavras: [650, 800],
  };
  const COL = { D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, K: 10, L: 11, M: 12, N: 13, O: 14, S: 18, T: 19 };

  /* Sites. internas = imagens dentro do texto (3: antes do 2º H2, depois da lista do 3º H2, antes do 6º H2;
     2: antes do 2º H2 e depois da lista do 3º H2). video: 'opcional' | 'sempre' | 'nao'. pendente = formato ainda não definido. */
  const SITES = {
    oeste:      { nome: 'Oeste Geral',              host: 'revistaoeste.com',      base: 'https://revistaoeste.com/oestegeral',       gid: 71000105, autor: 27, internas: 3, video: 'opcional' },
    emfoco:     { nome: 'Em Foco (Estado de Minas)', host: 'www.em.com.br',         base: 'https://www.em.com.br/emfoco',              gid: 71000101, autor: 36, internas: 2, video: 'nao' },
    alemdoagro: { nome: 'Além do Agro (Canal Rural)', host: 'www.canalrural.com.br', base: 'https://www.canalrural.com.br/alem-do-agro', gid: 71000107, autor: 7,  internas: 2, video: 'sempre' },
    uai:        { nome: 'UAI',                      host: 'www.uai.com.br',        base: 'https://www.uai.com.br',                    gid: 71000106, autor: 50, internas: 2, video: 'opcional', pendente: true },
  };
  const siteDaPagina = () => Object.keys(SITES).find((k) => location.hostname === SITES[k].host && location.pathname.startsWith(new URL(SITES[k].base).pathname.replace(/\/$/, '') + '/wp-admin'));
  const siteAtual = () => siteDaPagina() || GM_getValue('ogsite', 'oeste');
  const SITE = () => SITES[siteAtual()];
  const gidAtual = () => CFG.abaGid || SITE().gid;

  const og = { versao: '1.2.3', cfg: CFG, sites: SITES, st: 'pronto', r: null, log: [] };
  // og.site('emfoco') escolhe o site nas abas que não são WordPress (Flow, ChatGPT). No WordPress o site é o da própria página.
  og.site = (k) => { if (k) { if (!SITES[k]) throw new Error('site desconhecido: ' + k + ' (use ' + Object.keys(SITES).join(', ') + ')'); GM_setValue('ogsite', k); } return { site: siteAtual(), ...SITE() }; };
  const msg = (s) => { og.st = s; og.log.push(new Date().toTimeString().slice(0, 8) + ' ' + s); if (og.log.length > 200) og.log.shift(); };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const guarda = (p) => p.then((r) => { og.r = r; msg('ok'); return r; }, (e) => { og.r = { erro: String(e && e.message || e) }; msg('erro: ' + og.r.erro); throw e; });
  const RE_CHAVE = /^L\d+-(capa|[123])$/;

  // ---------------------------------------------------------------- utilidades comuns
  function gmGet(url, tipo) {
    return new Promise((res, rej) => GM_xmlhttpRequest({
      method: 'GET', url, responseType: tipo || 'text', anonymous: false,
      onload: (r) => (r.status >= 200 && r.status < 300) ? res(tipo ? r.response : r.responseText) : rej(new Error('HTTP ' + r.status + ' em ' + url.split('?')[0])),
      onerror: () => rej(new Error('falha de rede em ' + url.split('?')[0])),
    }));
  }

  function parseCSV(txt) {
    const linhas = []; let lin = [], cel = '', aspas = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (aspas) {
        if (c === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
        else cel += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { lin.push(cel); cel = ''; }
      else if (c === '\n') { lin.push(cel); linhas.push(lin); lin = []; cel = ''; }
      else if (c !== '\r') cel += c;
    }
    if (cel !== '' || lin.length) { lin.push(cel); linhas.push(lin); }
    return linhas;
  }

  // Lê linhas da planilha com a sessão Google do navegador. linhas: [89,90] ou '89-98'
  function normLinhas(l) {
    if (typeof l === 'string' && l.includes('-')) { const [a, b] = l.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); }
    return [].concat(l).map(Number);
  }
  async function lerPlanilha(linhas) {
    linhas = normLinhas(linhas);
    const a = Math.min(...linhas), b = Math.max(...linhas);
    const url = `https://docs.google.com/spreadsheets/d/${CFG.planilhaId}/export?format=csv&gid=${gidAtual()}&range=A${a}:AF${b}`;
    msg(`lendo planilha (${SITE().nome}) A${a}:AF${b}`);
    const rows = parseCSV(await gmGet(url));
    const out = {};
    linhas.forEach((n) => { const r = rows[n - a] || []; out[n] = {
      linha: n, html: r[COL.D] || '', meta: r[COL.E] || '', tags: r[COL.F] || '', kw: r[COL.G] || '', tema: r[COL.H] || '', video: (r[COL.K] || '').trim(),
      titulo: r[COL.I] || '', capa: r[COL.L] || '', p1: r[COL.M] || '', p2: r[COL.N] || '', p3: r[COL.O] || '', id: r[COL.S] || '', lote: r[COL.T] || '' }; });
    return out;
  }
  const limpaPrompt = (p) => String(p || '').replace(/\n?\s*LOTE:\s*OG-IMG-[^\n]*/gi, '').trim();

  // normalização para comparar trechos: espaços, aspas tipográficas, travessões
  const normTxt = (s) => String(s || '').replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- armazenamento compartilhado (Flow ⇄ WP ⇄ ChatGPT)
  const IMG = 'ogimg:';
  function imgSalvar(chave, dataUrl) { GM_setValue(IMG + chave, dataUrl); }
  function imgLer(chave) { return GM_getValue(IMG + chave, null); }
  function imgLista() { return GM_listValues().filter((k) => k.startsWith(IMG)).map((k) => k.slice(IMG.length)).sort(); }
  function imgLimpar(chaves) { (chaves ? [].concat(chaves) : imgLista()).forEach((k) => GM_deleteValue(IMG + k)); return imgLista().length; }

  // revisões guardadas por site e linha: 'ogrev:oeste:128'
  const REV = 'ogrev:';
  const revChave = (L) => REV + siteAtual() + ':' + L;
  og.revisoes = (linhas) => {
    const pre = REV + siteAtual() + ':';
    const out = {};
    GM_listValues().filter((k) => k.startsWith(pre)).sort().forEach((k) => { const L = Number(k.slice(pre.length)); if (!linhas || normLinhas(linhas).includes(L)) out[L] = GM_getValue(k); });
    return out;
  };
  og.limparRevisoes = (linhas) => { Object.keys(og.revisoes(linhas)).forEach((L) => GM_deleteValue(revChave(L))); return { restam: Object.keys(og.revisoes()).length }; };

  og.planilha = (linhas) => guarda(lerPlanilha(linhas).then((o) => {
    const resumo = {}; Object.values(o).forEach((r) => { resumo[r.linha] = { titulo: r.titulo.slice(0, 60), html: r.html.length, tags: r.tags, kw: r.kw, capa: !!r.capa, p: [r.p1, r.p2, r.p3].map((x) => !!x) }; });
    og._planilha = o; return resumo;
  }));
  og.imagens = () => { const l = imgLista(); return { total: l.length, chaves: l }; };
  og.limparImagens = (chaves) => ({ restam: imgLimpar(chaves) });

  // ================================================================= FERRAMENTAS DE TEXTO (funcionam em qualquer aba)
  function gmReq(method, url, { data, headers, anonymous = true, timeout = 20000 } = {}) {
    return new Promise((res) => GM_xmlhttpRequest({
      method, url, data, headers, anonymous, timeout,
      onload: (r) => res({ status: r.status, url: r.finalUrl || url, headers: r.responseHeaders || '', texto: r.responseText }),
      onerror: () => res({ status: 0, url, headers: '', texto: '', erro: 'rede' }),
      ontimeout: () => res({ status: 0, url, headers: '', texto: '', erro: 'tempo esgotado' }),
    }));
  }
  const domDe = (html) => new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html').getElementById('r');
  const blocosTexto = (r) => [...r.children].flatMap((el) => (el.tagName === 'UL' || el.tagName === 'OL') ? [...el.children] : [el]);

  /* ---------- QA do texto direto da planilha (só devolve falhas)
     og.qa('128-135') → { 128: 'ok', 129: ['lide 296', ...] } */
  function qaHtml(p, s) {
    const f = []; const r = domDe(p.html);
    const h1 = r.querySelector('h1'); if (!h1) f.push('sem H1');
    const lide = h1 && h1.nextElementSibling;
    if (!lide || lide.tagName !== 'P') f.push('lide não é o 1º parágrafo depois do H1');
    else { const n = lide.textContent.trim().length; if (n < CFG.lide[0] || n > CFG.lide[1]) f.push(`lide ${n} caracteres`); if (lide.querySelector('a')) f.push('link no lide'); }
    const h2 = [...r.querySelectorAll('h2')];
    if (h2.length !== 6) f.push(`${h2.length} H2`);
    const q = h2.filter((h) => h.textContent.trim().endsWith('?')).length; if (q !== 3) f.push(`${q} H2 em pergunta`);
    if (r.querySelector('h2 strong, h2 b, h2 a')) f.push('negrito ou link em H2');
    const listas = [...r.querySelectorAll('ul, ol')];
    if (listas.length !== 1) f.push(`${listas.length} listas`);
    if (listas[0]) {
      const l = listas[0]; const pv = l.previousElementSibling;
      if (!pv || pv.tagName !== 'P' || !pv.textContent.trim().endsWith(':')) f.push('ponte da lista não termina em ":"');
      let e = l.previousElementSibling, n = 0; while (e && e.tagName !== 'H2') { e = e.previousElementSibling; n++; }
      if (e !== h2[2]) f.push('lista fora do 3º H2');
    }
    const textos = blocosTexto(r).map((e) => e.textContent.replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean);
    // mesma contagem do 05_qa_artigo.py: tags viram espaço, URL do vídeo fora
    const vis = (t) => { const d = document.createElement('textarea'); d.innerHTML = t.replace(/<[^>]+>/g, ' '); return d.value.replace(/\s+/g, ' ').trim(); };
    const palavras = vis(p.html.replace(/<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '').replace(/<p>\s*https?:\/\/\S+\s*<\/p>/g, '')).split(' ').filter(Boolean).length;
    if (palavras < CFG.palavras[0] || palavras > CFG.palavras[1]) f.push(`${palavras} palavras`);
    const as = [...r.querySelectorAll('a')];
    const internos = as.filter((a) => (a.getAttribute('href') || '').includes(s.host.replace(/^www\./, '')));
    const externos = as.filter((a) => !internos.includes(a) && !/youtu\.?be/.test(a.getAttribute('href') || ''));
    const nInt = new Set(internos.map((a) => a.getAttribute('href'))).size;
    if (nInt !== 2) f.push(`${nInt} internos distintos`);
    if (externos.length !== 2) f.push(`${externos.length} externos`);
    externos.forEach((a) => { try { if (/\.br$/.test(new URL(a.getAttribute('href')).hostname)) f.push('externo brasileiro: ' + new URL(a.getAttribute('href')).hostname); } catch (e) { f.push('externo inválido'); } });
    if (as.some((a) => !a.closest('strong') && !a.querySelector('strong') && !/youtu\.?be/.test(a.getAttribute('href') || ''))) f.push('link sem negrito');
    const txt = textos.join(' \n ');
    const trav = (txt.match(/[—–]/g) || []).length; if (trav) f.push(`${trav} travessão`);
    const credito = txt.match(/\b(segundo|de acordo com|conforme)\s+(a|o)\s+(revista|site|portal|jornal|blog|publicação|fabricante|marca)\b/gi);
    if (credito) f.push('crédito a veículo/empresa: "' + credito[0] + '"');
    // nomes próprios sem negrito: palavra com inicial maiúscula fora do início de frase e fora de <strong>/<a>
    const clone = r.cloneNode(true); clone.querySelectorAll('h1,h2,strong,b,a').forEach((e) => e.remove());
    const solto = new Set(); const re = /(?<=[^.!?:\n"“(\s]\s)([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wáéíóúâêôãõçàüʻ'-]{1,})/g; let m;
    const plano = blocosTexto(clone).map((e) => e.textContent).join(' \n ');
    while ((m = re.exec(plano))) if (!/^(US|R)$/.test(m[1])) solto.add(m[1]);
    if (solto.size) f.push('maiúscula sem negrito: ' + [...solto].slice(0, 8).join(', '));
    // vídeo: ponte terminada em ":" e URL no fim do 5º H2
    if (s.video !== 'nao') {
      const yt = [...r.querySelectorAll('p')].filter((e) => /^https:\/\/(www\.)?youtu/.test(e.textContent.trim()));
      if (s.video === 'sempre' && !yt.length) f.push('sem vídeo (obrigatório neste site)');
      if (p.video && !yt.length) f.push('coluna K tem vídeo, texto não');
      yt.forEach((v) => {
        let e = v.previousElementSibling, k = 0; while (e && e.tagName !== 'H2') { e = e.previousElementSibling; k++; }
        if (e !== h2[4]) f.push('vídeo fora do 5º H2');
        const pv = v.previousElementSibling; if (!pv || !pv.textContent.trim().endsWith(':')) f.push('vídeo sem ponte com ":"');
        if (v.nextElementSibling && v.nextElementSibling.tagName !== 'H2') f.push('vídeo não é o último bloco do 5º H2');
      });
    } else if (/youtu\.?be/.test(p.html)) f.push('vídeo em site sem vídeo');
    return f;
  }
  og._qaHtml = qaHtml;
  og.qa = (linhas) => guarda((async () => {
    const o = await lerPlanilha(linhas); const s = SITE(); const out = {};
    Object.values(o).forEach((p) => { out[p.linha] = p.html ? (qaHtml(p, s).length ? qaHtml(p, s) : 'ok') : 'sem texto'; });
    return { site: s.nome, resultado: out };
  })());

  /* ---------- links externos: abrem? redirecionam? são .br? PDF que baixa?
     og.checarLinks('128-135') → só os problemas */
  og.checarLinks = (linhas) => guarda((async () => {
    const o = await lerPlanilha(linhas); const s = SITE(); const out = {};
    for (const p of Object.values(o)) {
      const hrefs = [...domDe(p.html).querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h && !h.includes(s.host.replace(/^www\./, '')) && !/youtu\.?be/.test(h));
      const prob = [];
      for (const h of hrefs) {
        msg(`L${p.linha}: ${h.slice(0, 60)}`);
        let r = await gmReq('HEAD', h);
        if (!r.status || r.status === 405 || r.status === 403 || r.status === 404) r = await gmReq('GET', h, { headers: { Range: 'bytes=0-2048' } });
        const ct = (r.headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '';
        const disp = (r.headers.match(/content-disposition:\s*([^\r\n]+)/i) || [])[1] || '';
        const host = (() => { try { return new URL(h).hostname; } catch (e) { return ''; } })();
        const ps = [];
        if (!r.status || r.status >= 400) ps.push(`HTTP ${r.status || r.erro}`);
        if (r.url && r.url.split('#')[0].replace(/\/$/, '') !== h.split('#')[0].replace(/\/$/, '')) ps.push('redireciona para ' + r.url.slice(0, 90));
        if (/\.br$/.test(host)) ps.push('site brasileiro');
        if (/attachment/i.test(disp)) ps.push('força download');
        if (/pdf/i.test(ct)) ps.push('PDF');
        if (ps.length) prob.push({ link: h.slice(0, 120), problema: ps.join('; ') });
      }
      out[p.linha] = prob.length ? prob : 'ok';
    }
    return { site: s.nome, resultado: out };
  })());

  /* ---------- candidatos a link interno no próprio site (busca pública do WordPress)
     og.internos('estádio futebol', {n: 8, site: 'oeste'}) → [{titulo, url}] */
  og.internos = (termo, { n = 8, site } = {}) => guarda((async () => {
    const s = site ? SITES[site] : SITE();
    const r = await gmReq('GET', `${s.base}/wp-json/wp/v2/search?search=${encodeURIComponent(termo)}&per_page=${n}&type=post&subtype=post&_fields=title,url`);
    if (r.status !== 200) throw new Error('busca falhou: HTTP ' + r.status);
    const div = document.createElement('div');
    return JSON.parse(r.texto).map((x) => { div.innerHTML = x.title; return { titulo: div.textContent, url: x.url }; });
  })());

  /* ---------- português (LanguageTool, gratuito): concordância, crase, vírgula, repetição
     og.portugues('128-135', {max: 10}) → até max apontamentos por texto */
  const LT_IGNORAR = /^(WHITESPACE_RULE|UPPERCASE_SENTENCE_START|DASH_RULE|PT_MULTITOKEN_SPELLING|TYPOGRAPHY|DOUBLE_PUNCTUATION|PARENTHESIS)/;
  og.portugues = (linhas, { max = 12 } = {}) => guarda((async () => {
    const o = await lerPlanilha(linhas); const out = {};
    for (const p of Object.values(o)) {
      if (!p.html) { out[p.linha] = 'sem texto'; continue; }
      const texto = blocosTexto(domDe(p.html)).map((e) => e.textContent.trim()).filter((t) => t && !/^https?:\/\//.test(t)).join('\n\n');
      msg(`L${p.linha}: português`);
      const r = await gmReq('POST', 'https://api.languagetool.org/v2/check', { data: 'language=pt-BR&text=' + encodeURIComponent(texto), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
      if (r.status !== 200) { out[p.linha] = 'LanguageTool: HTTP ' + (r.status || r.erro); await espera(4000); continue; }
      const ms = (JSON.parse(r.texto).matches || []).filter((m) => !LT_IGNORAR.test(m.rule.id))
        .filter((m) => !(m.rule.issueType === 'misspelling' && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(texto.substr(m.offset, m.length))))   // nomes próprios
        .slice(0, max)
        .map((m) => ({ trecho: texto.substr(Math.max(0, m.offset - 25), m.length + 50).replace(/\s+/g, ' '), erro: texto.substr(m.offset, m.length), sugestao: (m.replacements || []).slice(0, 2).map((x) => x.value).join(' | '), regra: m.rule.id, msg: m.shortMessage || m.message.slice(0, 80) }));
      out[p.linha] = ms.length ? ms : 'ok';
      await espera(3500); // limite gratuito: 20 pedidos por minuto
    }
    return out;
  })());

  // ================================================================= FLOW
  if (/(^|\.)labs\.google$|^flow\.google\.com$/.test(location.hostname)) {

    // ---------- 1. prompts a partir da planilha
    og.prompts = (linhas, { so } = {}) => guarda(lerPlanilha(linhas).then((o) => {
      const lista = [];
      Object.values(o).forEach((r) => {
        const pares = [['capa', r.capa], ['1', r.p1], ['2', r.p2], ['3', r.p3]];
        pares.forEach(([k, p]) => { if (p && (!so || so.includes(k))) lista.push({ chave: `L${r.linha}-${k}`, prompt: limpaPrompt(p) }); });
      });
      og._prompts = lista;
      return { total: lista.length, faltando: Object.values(o).flatMap((r) => [['capa', r.capa], ['1', r.p1], ['2', r.p2], ['3', r.p3]].filter(([, p]) => !p).map(([k]) => `L${r.linha}-${k}`)) };
    }));

    // ---------- 2. envio para a fila do Flow
    const visivel = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    function caixaPrompt() {
      if (CFG.seletorCaixa) return document.querySelector(CFG.seletorCaixa);
      const c = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visivel)
        .filter((el) => !el.closest('#og-painel'));
      return c.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
    }
    function botaoEnviar(caixa) {
      if (CFG.seletorBotao) return document.querySelector(CFG.seletorBotao);
      const re = /(iniciar gera|arrow_forward|generate|gerar|enviar|send|submit)/i;  // no Flow: "Iniciar geração arrow_forward"
      const nao = /(cole[cç][aã]o|collection|add)/i;                                    // nunca o "Criar coleção"
      const cb = caixa.getBoundingClientRect();
      const c = [...document.querySelectorAll('button')].filter(visivel).filter((b) => !b.disabled)
        .filter((b) => { const t = (b.getAttribute('aria-label') || '') + ' ' + b.innerText; return re.test(t) && !nao.test(t); });
      return c.sort((a, b) => dist(a) - dist(b))[0] || null;
      function dist(b) { const r = b.getBoundingClientRect(); return Math.hypot(r.left - cb.right, r.top - cb.top); }
    }
    async function escrever(caixa, texto) {
      caixa.focus();
      if (caixa.tagName === 'TEXTAREA' || caixa.tagName === 'INPUT') {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(caixa), 'value').set;
        set.call(caixa, texto); caixa.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null); document.execCommand('insertText', false, texto);
      }
      await espera(400);
    }
    async function enviarUm(texto) {
      const caixa = caixaPrompt(); if (!caixa) throw new Error('caixa de prompt não encontrada (defina og.cfg.seletorCaixa)');
      await escrever(caixa, texto);
      const lido = (caixa.value ?? caixa.innerText ?? '').trim();
      if (lido.slice(0, 30) !== texto.trim().slice(0, 30)) throw new Error('o texto não entrou na caixa');
      let bt = null; for (let t = 0; t < 10 && !(bt = botaoEnviar(caixa)); t++) await espera(300); // espera o botão habilitar
      if (bt) bt.click();
      else caixa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await espera(900);
      const resto = (caixa.value ?? caixa.innerText ?? '').trim();
      return resto.length < 5 || resto.slice(0, 30) !== texto.trim().slice(0, 30); // caixa esvaziou = enviado
    }
    // lista: array de {chave,prompt} ou omitida (usa og._prompts). chaves: filtra quais enviar.
    og.enviar = (lista, { chaves, pausa } = {}) => guarda((async () => {
      lista = lista || og._prompts || []; if (chaves) lista = lista.filter((x) => chaves.includes(x.chave));
      const enviados = [], falhas = [];
      for (let i = 0; i < lista.length; i++) {
        msg(`enviando ${i + 1}/${lista.length} ${lista[i].chave}`);
        try { (await enviarUm(lista[i].prompt)) ? enviados.push(lista[i].chave) : falhas.push(lista[i].chave); }
        catch (e) { falhas.push(lista[i].chave + ': ' + e.message); }
        await espera(pausa || CFG.pausaEnvioMs);
      }
      og._enviados = (og._enviados || []).concat(enviados.map((c) => ({ chave: c, prompt: lista.find((x) => x.chave === c).prompt })));
      return { enviados: enviados.length, falhas };
    })());

    // ---------- 3. coleta da grade (virtualizada) e mapeamento imagem → chave
    function imgsGrandes() { return [...document.querySelectorAll('img')].filter((i) => !i.closest('#og-folha') && i.naturalWidth >= 600 && visivel(i)); }
    function rolavel() {
      const i = imgsGrandes()[0]; let el = i && i.parentElement;
      while (el && el !== document.body) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50) return el; el = el.parentElement; }
      return document.scrollingElement;
    }
    function dica(img) {
      let el = img.parentElement;
      for (let n = 0; n < 10 && el; n++, el = el.parentElement) {
        if (el.querySelectorAll('img').length > 4) break;
        const t = (el.innerText || '').trim(); if (t.length > 30) return t.slice(0, 200);
      }
      return '';
    }
    og.coletar = () => guarda((async () => {
      const sc = rolavel(); const vistos = new Map(); const passo = Math.max(300, sc.clientHeight * 0.7);
      sc.scrollTop = 0; await espera(800);
      for (let y = 0, voltas = 0; voltas < 200; voltas++) {
        const base = sc.scrollTop;
        imgsGrandes().forEach((i) => { if (!vistos.has(i.src)) { const r = i.getBoundingClientRect(); vistos.set(i.src, { src: i.src, y: base + r.top, x: r.left, w: i.naturalWidth, h: i.naturalHeight, dica: dica(i) }); } });
        msg(`coletando: ${vistos.size} imagens`);
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5) break;
        y += passo; sc.scrollTop = y; await espera(700);
      }
      sc.scrollTop = 0;
      og._grade = [...vistos.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      return { total: og._grade.length, tamanhos: [...new Set(og._grade.map((g) => g.w + 'x' + g.h))] };
    })());

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // Mapeia cada chave enviada ao seu par de imagens. 1º tenta pelo texto do prompt na grade; senão, pela ordem (mais novo no topo).
    og.mapear = (enviados) => {
      enviados = enviados || og._enviados || []; const g = og._grade || [];
      const mapa = {}; const usados = new Set(); let porTexto = 0;
      enviados.forEach((e) => {
        const alvo = norm(e.prompt).slice(0, 45);
        const idx = g.map((x, i) => (norm(x.dica).includes(alvo) && !usados.has(i)) ? i : -1).filter((i) => i >= 0).slice(0, 2);
        if (idx.length) { idx.forEach((i) => usados.add(i)); mapa[e.chave] = idx; porTexto++; }
      });
      if (porTexto < enviados.length) { // ordem: o último enviado ocupa as posições 0 e 1
        const livres = g.map((_, i) => i).filter((i) => !usados.has(i));
        const semMapa = enviados.filter((e) => !mapa[e.chave]).reverse();
        semMapa.forEach((e, k) => { mapa[e.chave] = livres.slice(k * 2, k * 2 + 2); });
      }
      og._mapa = mapa;
      const incompletos = Object.entries(mapa).filter(([, v]) => v.length < 2).map(([k]) => k);
      return { metodo: porTexto === enviados.length ? 'texto' : (porTexto ? 'misto' : 'ordem'), chaves: Object.keys(mapa).length, incompletos };
    };

    // ---------- 4. folha de contato: uma só captura para escolher e checar texto desenhado
    og.folha = (chaves) => {
      og.fecharFolha(); const g = og._grade || []; const mapa = og._mapa || {};
      let itens = Object.entries(mapa).filter(([k]) => !chaves || chaves.includes(k)).flatMap(([k, v]) => v.map((i, j) => ({ rot: `${k}${'ab'[j]}`, i })));
      if (!itens.length) itens = g.map((_, i) => ({ rot: '#' + i, i }));
      const n = itens.length, vw = innerWidth, vh = innerHeight;
      let cols = Math.max(2, Math.ceil(Math.sqrt(n * (vw / vh) / (16 / 9)))); if (cols % 2) cols++;
      const linhas = Math.ceil(n / cols); const w = Math.floor(Math.min((vw - 16) / cols, ((vh - 16) / linhas - 16) * 16 / 9));
      const d = document.createElement('div'); d.id = 'og-folha';
      d.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:#111;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:2px;padding:6px;align-content:start;overflow:hidden`;
      itens.forEach(({ rot, i }) => {
        const c = document.createElement('div'); c.style.cssText = `position:relative;width:${w}px`;
        c.innerHTML = `<img src="${g[i] ? g[i].src : ''}" style="width:${w}px;height:${Math.round(w * 9 / 16)}px;object-fit:cover;display:block"><span style="position:absolute;left:2px;top:2px;background:#ff0;color:#000;font:bold 11px monospace;padding:0 3px">${rot}</span>`;
        d.appendChild(c);
      });
      d.addEventListener('dblclick', og.fecharFolha); document.body.appendChild(d);
      return { itens: n, colunas: cols, dica: 'tire uma captura; duplo clique fecha' };
    };
    og.fecharFolha = () => { const d = document.getElementById('og-folha'); if (d) d.remove(); return true; };

    // ---------- 5. escolha → 1280x720 JPG → armazenamento compartilhado
    async function carregarImagem(src) {
      let blob;
      try { blob = await (await fetch(src, { credentials: 'include' })).blob(); }
      catch (e) { blob = await gmGet(src, 'blob'); }
      const url = URL.createObjectURL(blob);
      try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
    }
    function paraJpg(im) {
      const W2 = CFG.largura, H2 = CFG.altura; const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
      const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      const esc = Math.max(W2 / im.naturalWidth, H2 / im.naturalHeight); // preenche e corta o excesso no centro
      const w = im.naturalWidth * esc, h = im.naturalHeight * esc;
      ctx.drawImage(im, (W2 - w) / 2, (H2 - h) / 2, w, h);
      return cv.toDataURL('image/jpeg', CFG.qualidadeJpg);
    }
    // escolhas: { 'L89-capa': 'a', 'L89-1': 'b', ... } (a/b do par) ou índice numérico da grade. Omitido = 'a' para todas.
    // A chave PRECISA seguir o padrão L<linha da planilha>-<capa|1|2|3>, senão og.lote não encontra a imagem.
    og.empacotar = (escolhas) => guarda((async () => {
      const g = og._grade || [], mapa = og._mapa || {};
      if (!escolhas) escolhas = Object.fromEntries(Object.keys(mapa).map((k) => [k, 'a']));
      const erradas = Object.keys(escolhas).filter((k) => !RE_CHAVE.test(k));
      if (erradas.length) throw new Error('chave fora do padrão L128-capa / L128-1: ' + erradas.join(', '));
      const feito = {}, falhas = [];
      const ents = Object.entries(escolhas);
      for (let n = 0; n < ents.length; n++) {
        const [k, v] = ents[n]; msg(`convertendo ${n + 1}/${ents.length} ${k}`);
        try {
          const i = typeof v === 'number' ? v : (mapa[k] || [])['ab'.indexOf(v)];
          if (i == null || !g[i]) throw new Error('sem imagem mapeada');
          const d = paraJpg(await carregarImagem(g[i].src)); imgSalvar(k, d); feito[k] = Math.round(d.length * 0.75 / 1024) + 'KB';
        } catch (e) { falhas.push(k + ': ' + e.message); }
      }
      return { salvas: Object.keys(feito).length, tamanhos: feito, falhas, formato: `${CFG.largura}x${CFG.altura} JPG ${CFG.qualidadeJpg}` };
    })());
  }

  // ================================================================= CHATGPT (revisão da AURA)
  if (location.hostname === 'chatgpt.com') {
    const G = (og.gpt = {});

    // HTML da planilha → texto legível para a revisora (sem negrito; link vira "texto [link: URL]")
    function paraTexto(html) {
      const doc = new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
      const r = doc.getElementById('r');
      r.querySelectorAll('a').forEach((a) => a.replaceWith(doc.createTextNode(`${a.textContent} [link: ${a.getAttribute('href')}]`)));
      const out = [];
      [...r.children].forEach((el) => {
        const t = el.tagName.toLowerCase(); const tx = normTxt(el.textContent);
        if (t === 'h1') out.push('# ' + tx);
        else if (t === 'h2') out.push('## ' + tx);
        else if (t === 'ul' || t === 'ol') [...el.children].forEach((li) => out.push('- ' + normTxt(li.textContent)));
        else if (tx) out.push(tx);
      });
      return out.join('\n\n');
    }
    // texto puro (sem as marcas de link) usado para validar os trechos devolvidos
    function textoPuro(html) {
      const doc = new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
      return normTxt([...doc.getElementById('r').children].map((el) => el.tagName === 'UL' || el.tagName === 'OL' ? [...el.children].map((li) => li.textContent).join(' \n ') : el.textContent).join(' \n '));
    }

    // Com as instruções da AURA no projeto (CFG.mensagemCurta = true), a mensagem leva só portal, linha e artigo.
    function mensagem(p) {
      const s = SITE();
      const cab = [`PORTAL: ${s.nome}`, `LINHA: ${p.linha}`, `TÍTULO APROVADO: ${p.titulo}`, ''];
      if (CFG.mensagemCurta) return [...cab, 'ARTIGO', '', paraTexto(p.html)].join('\n');
      return [
        `Olá, AURA. Aqui é o Claude, o redator que trabalha com o Paulo nos artigos do portal ${s.nome}. Peço a sua revisão deste artigo antes da publicação.`,
        '',
        ...cab,
        'O QUE REVISAR',
        '1. Fatos: números, datas, nomes, lugares e afirmações. Abra as fontes indicadas nos links e, se precisar, outras fontes confiáveis. Aponte só o que estiver errado, impreciso ou sem sustentação.',
        '2. Tom do Paulo: informativo com cara de entretenimento, leve, próximo, com ritmo, sem tom de relatório nem de meme. Aponte frases duras, burocráticas, repetitivas ou que soem artificiais.',
        '3. Clareza: frase confusa, ambígua ou que repete o que já foi dito.',
        '',
        'REGRAS DO PROJETO (não sugira nada que as quebre)',
        '- O primeiro parágrafo (lide) tem de 300 a 320 caracteres e não tem link. Se mexer nele, mantenha o tamanho.',
        '- Não dar crédito a revista, site ou empresa por ideia ou dica simples. Nomear só órgão oficial, universidade ou estudo quando sustentam um dado. Nunca citar site brasileiro no texto.',
        '- Os links ficam em palavras que já existem no texto. Não proponha frase nova só para abrigar link e não mexa nos trechos com link sem necessidade.',
        '- O parágrafo antes da lista termina em dois-pontos. Seis intertítulos (##): três perguntas e três afirmações. Não sugira travessão (—).',
        '- Não invente cena, fala ou emoção que a fonte não registra.',
        '',
        'COMO RESPONDER',
        '- Responda SOMENTE com um bloco de código json, sem texto antes ou depois, neste formato:',
        '```json',
        `{"linha": ${p.linha}, "correcoes": [{"tipo": "fato|promessa|tom|clareza|regra", "original": "trecho copiado exatamente do artigo", "correcao": "trecho novo que substitui o original", "motivo": "explicação curta", "fonte": "URL (obrigatória quando tipo = fato)", "citacao": "frase curta da fonte que comprova (obrigatória quando tipo = fato)"}]}`,
        '```',
        '- "original" deve ser copiado letra por letra do artigo, curto (no máximo uma frase) e dentro de um único parágrafo. Sem as marcas [link: ...].',
        '- "correcao" substitui só o "original", mantendo o resto do parágrafo.',
        '- No máximo 8 correções, as mais importantes primeiro.',
        '- Se o artigo estiver bom, responda {"linha": ' + p.linha + ', "correcoes": []}. Isso é uma resposta válida e esperada: não invente correção para ter o que entregar.',
        '- Se desconfiar de um fato mas não conseguir confirmar, use tipo "fato" com "correcao" igual ao "original" e explique a dúvida em "motivo".',
        '',
        'ARTIGO',
        '',
        paraTexto(p.html),
      ].join('\n');
    }

    const visivel = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const caixa = () => [...document.querySelectorAll('.ProseMirror[contenteditable="true"], #prompt-textarea')].filter(visivel)[0] || null;
    const botao = (re) => [...document.querySelectorAll('button')].filter(visivel).find((b) => re.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || '')));
    const gerando = () => !!botao(/(parar|interromper|stop)/i);
    // o ChatGPT nem sempre marca o papel das mensagens; a resposta da AURA é o bloco de código com "correcoes"
    const respostas = () => {
      const r = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      return r.length ? r : [...document.querySelectorAll('pre')].filter((p) => p.innerText.includes('"correcoes"'));
    };

    // Manda um texto para a AURA. Use numa aba aberta no projeto da AURA (CFG.projetoRevisao), uma aba por texto. O site vem de og.site().
    G.enviar = (linha) => guarda((async () => {
      if (!/\/g\/g-p-/.test(location.pathname)) throw new Error('abra o projeto da AURA nesta aba: ' + CFG.projetoRevisao);
      if (respostas().length) throw new Error('esta aba já tem conversa; abra o projeto da AURA numa aba nova');
      const p = (await lerPlanilha([linha]))[linha];
      if (!p.html) throw new Error(`linha ${linha} sem texto (D)`);
      const c = caixa(); if (!c) throw new Error('caixa de mensagem não encontrada');
      c.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, mensagem(p));
      await espera(800);
      if (!normTxt(c.innerText).includes(normTxt(p.titulo).slice(0, 40))) throw new Error('o texto não entrou na caixa');
      let b = null; for (let t = 0; t < 15 && !(b = botao(/^(enviar|send)|send-button/i)); t++) await espera(300);
      if (!b) throw new Error('botão Enviar não encontrado');
      b.click(); await espera(2500);
      G._linha = Number(linha); G._html = p.html; G._enviadoEm = Date.now();
      GM_setValue(revChave(linha), { linha: Number(linha), estado: 'aguardando', url: location.href, enviadoEm: new Date().toISOString() });
      return { linha: Number(linha), enviado: true, url: location.href };
    })());

    // Estado da resposta nesta aba: 'gerando' ou 'pronta'
    G.estado = () => ({ linha: G._linha, gerando: gerando(), respostas: respostas().length, minutos: G._enviadoEm ? Math.round((Date.now() - G._enviadoEm) / 60000) : null });

    function extrairJson(el) {
      const codes = [...el.querySelectorAll('pre code, code')].map((c) => c.textContent).filter((t) => t.includes('"correcoes"'));
      const cand = codes.length ? codes[codes.length - 1] : el.innerText;
      const i = cand.indexOf('{'), j = cand.lastIndexOf('}');
      if (i < 0 || j < i) throw new Error('resposta sem JSON');
      return JSON.parse(cand.slice(i, j + 1));
    }

    // Lê e valida a resposta. Corte o que não tem trecho exato no artigo (alucinação) e marca o que dá para aplicar direto no HTML.
    G.ler = (linha) => guarda((async () => {
      linha = Number(linha || G._linha); if (!linha) throw new Error('informe a linha');
      if (gerando()) return { linha, estado: 'gerando' };
      const rs = respostas(); if (!rs.length) return { linha, estado: 'sem resposta' };
      let dados; try { dados = extrairJson(rs[rs.length - 1]); } catch (e) { return { linha, estado: 'resposta fora do formato', erro: e.message }; }
      const html = G._html || (await lerPlanilha([linha]))[linha].html;
      const puro = textoPuro(html);
      const htmlNorm = normTxt(html);
      const validas = [], descartadas = [];
      (dados.correcoes || []).forEach((c, k) => {
        const o = normTxt(c.original), n = normTxt(c.correcao);
        if (!o) { descartadas.push({ k, motivo: 'sem original' }); return; }
        if (!puro.includes(o)) { descartadas.push({ k, motivo: 'trecho não existe no artigo', original: o.slice(0, 80) }); return; }
        const item = { tipo: c.tipo, original: o, correcao: n, motivo: c.motivo || '', fonte: c.fonte || '', citacao: c.citacao || '' };
        item.direto = htmlNorm.includes(o);               // o trecho existe sem marcação no meio: dá para trocar direto no HTML
        item.soAlerta = !n || n === o || (c.tipo === 'fato' && (!c.fonte || !c.citacao));
        validas.push(item);
      });
      const res = { linha, estado: 'pronta', lidaEm: new Date().toISOString(), url: location.href, total: (dados.correcoes || []).length, validas, descartadas };
      GM_setValue(revChave(linha), res);
      return { linha, estado: 'pronta', validas: validas.length, alertas: validas.filter((v) => v.soAlerta).length, descartadas: descartadas.length };
    })());
  }

  // ================================================================= WORDPRESS
  if (siteDaPagina()) {
    const SW = SITES[siteDaPagina()];
    const RAIZ = () => (W.wpApiSettings && W.wpApiSettings.root) || (SW.base + '/wp-json/');
    let NONCE = null;
    async function nonce() {
      if (NONCE) return NONCE;
      NONCE = (W.wpApiSettings && W.wpApiSettings.nonce) || await (await fetch(SW.base + '/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin' })).text();
      return NONCE;
    }
    async function api(caminho, { method = 'GET', body, headers = {}, raw } = {}) {
      const h = Object.assign({ 'X-WP-Nonce': await nonce() }, headers);
      if (body && !raw) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
      const r = await fetch(RAIZ() + caminho.replace(/^\//, ''), { method, body, headers: h, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error((j.code || r.status) + ': ' + (j.message || '')); e.data = j; throw e; }
      return j;
    }
    og.api = api;

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const normTit = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

    // ---------- HTML da planilha → blocos nativos (+ imagens nas posições)
    function blocoImagem(m) {
      if (!m) return '';
      const cap = m.legenda ? `<figcaption class="wp-element-caption">${esc(m.legenda)}</figcaption>` : '';
      return `<!-- wp:image {"id":${m.id},"sizeSlug":"large","linkDestination":"none","align":"center"} -->\n<figure class="wp-block-image aligncenter size-large"><img src="${esc(m.url)}" alt="${esc(m.alt)}" class="wp-image-${m.id}"/>${cap}</figure>\n<!-- /wp:image -->`;
    }
    function blocoVideo(url) {
      return `<!-- wp:embed {"url":"${url}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->`;
    }
    const RE_YT = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)$/;
    function paraBlocos(html, imgs = {}) {
      const doc = new DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
      const nos = [...doc.getElementById('r').children];
      const out = []; let h2 = 0; let listaNoH2_3 = false; const avisos = []; let img3Pendente = false;
      nos.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'h1') return;
        if (tag === 'h2') {
          h2++;
          if (h2 === 4 && imgs[2] && !listaNoH2_3) { out.push(blocoImagem(imgs[2])); avisos.push('H2 3 sem lista: interna 2 antes do H2 4'); }
          if (h2 === 2) out.push(blocoImagem(imgs[1]));
          if (h2 === 6 && SW.internas >= 3) {
            // nunca colar imagem logo depois do vídeo: a 3ª interna desce para depois do 1º parágrafo do 6º H2
            if (out.length && /^<!-- wp:embed/.test(out[out.length - 1])) img3Pendente = true;
            else out.push(blocoImagem(imgs[3]));
          }
          el.querySelectorAll('strong,b').forEach((s) => s.replaceWith(...s.childNodes));
          out.push(`<!-- wp:heading -->\n<h2 class="wp-block-heading">${el.innerHTML}</h2>\n<!-- /wp:heading -->`);
        } else if (tag === 'h3') {
          out.push(`<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${el.innerHTML}</h3>\n<!-- /wp:heading -->`);
        } else if (tag === 'ul' || tag === 'ol') {
          const itens = [...el.children].map((li) => `<!-- wp:list-item -->\n<li>${li.innerHTML}</li>\n<!-- /wp:list-item -->`).join('\n');
          const ord = tag === 'ol' ? ' {"ordered":true}' : '';
          out.push(`<!-- wp:list${ord} -->\n<${tag} class="wp-block-list">${itens}</${tag}>\n<!-- /wp:list -->`);
          if (h2 === 3 && !listaNoH2_3) { listaNoH2_3 = true; out.push(blocoImagem(imgs[2])); }
        } else if (tag === 'p') {
          const tx = el.textContent.trim();
          if (RE_YT.test(tx) && !el.querySelector('a')) { out.push(blocoVideo(tx)); return; }
          if (tx) out.push(`<!-- wp:paragraph -->\n<p>${el.innerHTML}</p>\n<!-- /wp:paragraph -->`);
          if (img3Pendente && tx) { out.push(blocoImagem(imgs[3])); img3Pendente = false; avisos.push('3ª interna depois do 1º parágrafo do 6º H2 (vídeo antes)'); }
        } else if (tag === 'figure' || tag === 'div' || tag === 'table') {
          out.push(`<!-- wp:html -->\n${el.outerHTML}\n<!-- /wp:html -->`); avisos.push('bloco HTML bruto: ' + tag);
        } else { out.push(`<!-- wp:html -->\n${el.outerHTML}\n<!-- /wp:html -->`); avisos.push('tag inesperada: ' + tag); }
      });
      if (img3Pendente) out.push(blocoImagem(imgs[3]));
      if (h2 !== 6) avisos.push(`${h2} H2 (esperado 6)`);
      return { conteudo: out.filter(Boolean).join('\n\n'), avisos };
    }
    og._paraBlocos = paraBlocos;

    // ---------- mídia
    async function subirImagem(chave, { alt, legenda, titulo, nome } = {}) {
      const d = imgLer(chave); if (!d) throw new Error('imagem não está no armazenamento: ' + chave);
      const blob = await (await fetch(d)).blob();
      const arq = (nome || slug(titulo || chave)) + '.jpg';
      const m = await api('wp/v2/media', { method: 'POST', body: blob, raw: true, headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${arq}"` } });
      const m2 = await api('wp/v2/media/' + m.id, { method: 'POST', body: { alt_text: alt || '', caption: legenda || '', title: titulo || alt || chave } });
      const url = (m2.media_details && m2.media_details.sizes && m2.media_details.sizes.large && m2.media_details.sizes.large.source_url) || m2.source_url;
      return { id: m.id, url, alt: alt || '', legenda: legenda || '', w: m2.media_details && m2.media_details.width, h: m2.media_details && m2.media_details.height };
    }

    // ---------- tags
    async function idsTags(lista) {
      const ids = [];
      for (const nome of lista) {
        try { ids.push((await api('wp/v2/tags', { method: 'POST', body: { name: nome } })).id); }
        catch (e) {
          if (e.data && e.data.code === 'term_exists') ids.push(e.data.data.term_id);
          else { const b = await api('wp/v2/tags?search=' + encodeURIComponent(nome)); const t = b.find((x) => x.name.toLowerCase() === nome.toLowerCase()); if (t) ids.push(t.id); else throw e; }
        }
      }
      return ids;
    }

    // ---------- título repetido no site (busca exata, ignorando acento e pontuação)
    async function tituloRepetido(titulo, ignorarId) {
      const r = await api('wp/v2/posts?search=' + encodeURIComponent(titulo) + '&status=publish,future,draft,private,pending&context=edit&_fields=id,title&per_page=20');
      return r.filter((p) => p.id !== ignorarId && normTit(p.title.raw) === normTit(titulo)).map((p) => p.id);
    }
    og.tituloRepetido = (titulo) => tituloRepetido(titulo);
    // slug que o WordPress gera para o título (aproximação de sanitize_title)
    const slugWP = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Duplicado = outro post com o mesmo título OU slug que é o do título com "-2", "-3"... no fim
    async function duplicidade(id) {
      const p = await api(`wp/v2/posts/${id}?context=edit&_fields=id,slug,generated_slug,title`);
      const slugAtual = p.slug || p.generated_slug || ''; const base = slugWP(p.title.raw).slice(0, 190);
      const f = [];
      const m = slugAtual.match(/^(.*)-(\d+)$/);
      if (m && m[1] === base) f.push(`URL com sufixo -${m[2]} (já existe post com o mesmo endereço)`);
      const outros = await tituloRepetido(p.title.raw, p.id);
      if (outros.length) f.push(`outro post com o mesmo título: ${outros.join(', ')}`);
      return f;
    }
    og.duplicidade = (ids) => guarda((async () => { const o = {}; for (const id of [].concat(ids)) { const f = await duplicidade(id); o[id] = f.length ? f : 'ok'; } return o; })());

    // ---------- data
    function conferirData(data) {
      if (!data) return null;
      const alvo = new Date(data + '-03:00'); // horário do site: Brasília
      const min = (alvo - Date.now()) / 60000;
      if (!(min >= CFG.folgaAgendamentoMin)) throw new Error(`horário ${data} está a ${Math.round(min)} min; mínimo ${CFG.folgaAgendamentoMin} (agendar no passado publica na hora)`);
      return data.length === 16 ? data + ':00' : data;
    }

    /* ---------- um post completo
       item = { linha: 89, data: '2026-11-22T13:57', categoria: 12861,
                img: { capa:{alt,legenda}, 1:{alt,legenda}, 2:{...}, 3:{...} },   // chaves L89-capa, L89-1...
                tags: 'opcional, sobrescreve F', status: 'future'|'draft' }
       Sem data = rascunho.
       ATENÇÃO: com postId, o post é RECONSTRUÍDO a partir da planilha (título, texto, tags, Yoast).
       Edições manuais somem. Para trocar uma imagem, use og.trocarImagem. */
    async function montarPost(item, cache) {
      const L = item.linha; const p = (cache && cache[L]) || (await lerPlanilha([L]))[L];
      if (!p.html || !p.titulo) throw new Error(`linha ${L} sem texto (D) ou título (I)`);
      const data = conferirData(item.data);
      if (!item.postId) {
        if (SW.pendente && !item.forcar) throw new Error(`${SW.nome}: formato ainda não definido com o Paulo (use forcar: true só com autorização dele)`);
        const faltam = ['capa', '1', '2', '3'].slice(0, 1 + SW.internas).filter((k) => !((item.img || {})[k] || {}).id && !imgLer(`L${L}-${k}`));
        if (faltam.length && !item.semImagens) throw new Error(`faltam imagens no armazenamento: ${faltam.map((k) => `L${L}-${k}`).join(', ')} (confira as chaves do og.empacotar)`);
        const rep = await tituloRepetido(p.titulo);
        if (rep.length) throw new Error(`título já existe no site (post ${rep.join(', ')}): troque uma ou duas palavras na coluna I`);
      }
      msg(`L${L}: imagens`);
      const midia = {};
      for (const k of ['capa', '1', '2', '3'].slice(0, 1 + SW.internas)) {
        const meta = (item.img || {})[k] || {};
        if (meta.id) { const m = await api('wp/v2/media/' + meta.id + '?context=edit'); midia[k] = { id: m.id, url: (m.media_details.sizes.large || {}).source_url || m.source_url, alt: m.alt_text, legenda: meta.legenda != null ? meta.legenda : String((m.caption && m.caption.raw) || '').replace(/<[^>]+>/g, '').trim() }; continue; }
        if (!imgLer(`L${L}-${k}`)) continue;
        midia[k] = await subirImagem(`L${L}-${k}`, { alt: meta.alt, legenda: meta.legenda, titulo: meta.titulo || (k === 'capa' ? p.titulo : `${p.titulo} (${k})`), nome: `${slug(p.kw || p.titulo)}-${k}` });
      }
      const { conteudo, avisos } = paraBlocos(p.html, { 1: midia['1'], 2: midia['2'], 3: midia['3'] });
      msg(`L${L}: tags`);
      let tags = String(item.tags || p.tags).split(',').map((s) => s.trim()).filter(Boolean);
      if (tags.length > CFG.maxTags) { avisos.push(`tags cortadas: ${tags.slice(CFG.maxTags).join(', ')}`); tags = tags.slice(0, CFG.maxTags); }
      const corpo = {
        title: p.titulo, content: conteudo, status: item.status || (data ? 'future' : 'draft'), author: item.autor || SW.autor,
        categories: [].concat(item.categoria || []), tags: await idsTags(tags),
        meta: { _yoast_wpseo_focuskw: p.kw, _yoast_wpseo_metadesc: p.meta },
      };
      if (midia.capa) corpo.featured_media = midia.capa.id;
      if (data) corpo.date = data;
      msg(`L${L}: criando post`);
      let post;
      try { post = await api(item.postId ? 'wp/v2/posts/' + item.postId : 'wp/v2/posts', { method: 'POST', body: corpo }); }
      catch (e) { if (/meta/i.test(e.message)) { delete corpo.meta; post = await api('wp/v2/posts', { method: 'POST', body: corpo }); avisos.push('Yoast não gravou pela API'); } else throw e; }
      try { (await duplicidade(post.id)).forEach((x) => avisos.push('DUPLICIDADE: ' + x)); } catch (e) { avisos.push('não conferiu duplicidade: ' + e.message); }
      return { linha: L, id: post.id, status: post.status, data: post.date, link: post.link, midia: Object.fromEntries(Object.entries(midia).map(([k, m]) => [k, m.id])), avisos };
    }

    og.post = (item) => guarda(montarPost(item));
    // lote = { categoria, itens:[item...] }  — um único comando para o lote inteiro
    og.lote = (lote) => guarda((async () => {
      const linhas = lote.itens.map((i) => i.linha); const cache = await lerPlanilha(linhas);
      const ok = [], falhas = [];
      for (const it of lote.itens) {
        try { ok.push(await montarPost(Object.assign({ categoria: lote.categoria, autor: lote.autor }, it), cache)); }
        catch (e) { falhas.push({ linha: it.linha, erro: e.message }); }
      }
      og._lote = ok;
      return { criados: ok.map((o) => ({ linha: o.linha, id: o.id, status: o.status, data: o.data, link: o.link, avisos: o.avisos.length ? o.avisos : undefined })), falhas };
    })());

    /* ---------- trocar UMA imagem sem reconstruir o post
       og.trocarImagem({ postId, slot: 'capa'|'1'|'2'|'3', chave: 'L121-2', alt, legenda })
       Sobe a imagem da chave e substitui só aquele bloco (ou a capa). Título, texto, outras legendas e edições manuais ficam. */
    og.trocarImagem = ({ postId, slot, chave, alt, legenda }) => guarda((async () => {
      if (!RE_CHAVE.test(chave || '')) throw new Error('chave fora do padrão L128-capa / L128-1');
      const p = await api(`wp/v2/posts/${postId}?context=edit`);
      const m = await subirImagem(chave, { alt, legenda, titulo: `${p.title.raw} (${slot})`, nome: `${slug(p.title.raw)}-${slot}-novo` });
      if (slot === 'capa') { await api(`wp/v2/posts/${postId}`, { method: 'POST', body: { featured_media: m.id } }); return { postId, slot, novaMidia: m.id }; }
      const c = p.content.raw; const blocos = [...c.matchAll(/<!-- wp:image [\s\S]*?<!-- \/wp:image -->/g)];
      const alvo = blocos[Number(slot) - 1]; if (!alvo) throw new Error(`o post não tem a interna ${slot}`);
      const novo = c.slice(0, alvo.index) + blocoImagem(m) + c.slice(alvo.index + alvo[0].length);
      const r = await api(`wp/v2/posts/${postId}`, { method: 'POST', body: { content: novo } });
      return { postId, slot, novaMidia: m.id, status: r.status, data: r.date };
    })());

    // ---------- conferência: devolve só o que falhou
    og.conferir = (ids) => guarda((async () => {
      ids = ids || (og._lote || []).map((o) => o.id);
      const res = {};
      for (const id of ids) {
        const p = await api(`wp/v2/posts/${id}?context=edit`); const c = p.content.raw || '';
        const f = [];
        if (!p.categories.length) f.push('sem categoria');
        if (!p.tags.length || p.tags.length > CFG.maxTags) f.push(`${p.tags.length} tags`);
        if (!p.featured_media) f.push('sem capa');
        const nImg = (c.match(/<!-- wp:image/g) || []).length; if (nImg !== SW.internas) f.push(`${nImg} internas (esperado ${SW.internas})`);
        const semLeg = (c.match(/<figure class="wp-block-image[^>]*>(?:(?!<\/figure>).)*<\/figure>/gs) || []).filter((x) => !/figcaption/.test(x)).length; if (semLeg) f.push(`${semLeg} internas sem legenda`);
        if ((c.match(/<!-- wp:heading/g) || []).length !== 6) f.push('H2 ≠ 6');
        if (/%%IMG|<h1/i.test(c)) f.push('marcador ou H1 no corpo');
        if (/<!-- \/wp:embed -->\s*<!-- wp:image/.test(c)) f.push('imagem colada no vídeo');
        if (/<p>\s*https:\/\/(www\.)?youtu/.test(c)) f.push('vídeo como parágrafo, não incorporado');
        const links = (c.match(/<a [^>]*href="([^"]+)"/g) || []); const int = links.filter((l) => l.includes(SW.host.replace(/^www\./, ''))).length;
        if (int < 2) f.push(`${int} internos`); if (links.length - int < 2) f.push(`${links.length - int} externos`);
        if (p.meta && (!p.meta._yoast_wpseo_focuskw || !p.meta._yoast_wpseo_metadesc)) f.push('Yoast incompleto');
        if (p.author !== SW.autor) f.push('autor ' + p.author);
        if (SW.video === 'sempre' && !/wp:embed/.test(c)) f.push('sem vídeo (obrigatório neste site)');
        if (p.status === 'future' && new Date(p.date + '-03:00') < Date.now()) f.push('data no passado');
        (await duplicidade(id)).forEach((x) => f.push(x));
        if (p.featured_media) { const m = await api('wp/v2/media/' + p.featured_media); if (!m.alt_text) f.push('capa sem alt'); if (m.media_details && m.media_details.width !== CFG.largura) f.push(`capa ${m.media_details.width}x${m.media_details.height}`); }
        res[id] = f.length ? f : 'ok';
      }
      const falhas = Object.fromEntries(Object.entries(res).filter(([, v]) => v !== 'ok'));
      return { conferidos: ids.length, ok: ids.length - Object.keys(falhas).length, falhas };
    })());

    // links para a planilha da campanha
    og.links = (ids) => guarda((async () => {
      ids = ids || (og._lote || []).map((o) => o.id); const out = [];
      for (const id of ids) { const p = await api(`wp/v2/posts/${id}?context=edit&_fields=id,date,status,link,generated_slug,permalink_template`); out.push({ id, data: p.date, status: p.status, url: p.status === 'future' && p.permalink_template ? p.permalink_template.replace(/%(post|page)name%/, p.generated_slug) : p.link }); }
      return out;
    })());
  }

  // ---------------------------------------------------------------- painel mínimo (para o Paulo ver o andamento)
  function painel() {
    const d = document.createElement('div'); d.id = 'og-painel';
    d.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483646;background:#1d1d1f;color:#fff;font:12px system-ui;padding:6px 10px;border-radius:8px;opacity:.85;max-width:320px;pointer-events:none';
    document.body.appendChild(d);
    setInterval(() => { d.textContent = `OG ${og.versao} · ${og.st} · imgs ${imgLista().length} · rev ${Object.keys(og.revisoes()).length} · ${siteAtual()}`; }, 1000);
  }
  try { painel(); } catch (e) { /* sem painel não há problema */ }

  W.og = og;
})();
