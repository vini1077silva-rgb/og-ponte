# og-ponte

Ferramentas do fluxo editorial Nazarick do Paulo.

- `og-ponte.user.js`: script do Tampermonkey. Leva prompts da planilha Nazarick ao Flow, prepara as imagens, manda textos para revisão da AURA no ChatGPT, confere texto, links e português e monta/agenda os posts nos WordPress (Oeste Geral, Em Foco, Além do Agro, UAI). Instale abrindo o link "Raw" do arquivo com o Tampermonkey ativo; as próximas versões chegam sozinhas pela atualização automática.
- `qa/05_qa_artigo.py`: QA do artigo em HTML (`python3 qa/05_qa_artigo.py arquivo.html --portal dominio`).
- `skill/SKILL.md`: roteiro do método (mesmo conteúdo da skill nazarick-artigos).

Nada aqui contém senha ou token. As sessões do WordPress, da planilha e do ChatGPT são as do navegador do Paulo.
