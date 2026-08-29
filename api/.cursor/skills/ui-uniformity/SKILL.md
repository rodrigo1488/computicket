---
name: ui-uniformity
description: Padroniza interface e front-end no tema escuro com componentes uniformes. Use quando criar ou editar telas, modais, formulários, tabelas, botões, estados visuais, cores, espaçamento, tipografia ou rolagem.
---

# UI Uniformity

## Objetivo
Manter todas as telas visualmente consistentes e previsíveis no tema escuro do projeto.

## Regras obrigatórias
- Use paleta `slate` de forma consistente: fundo (`bg-slate-950/900`), borda (`border-slate-700`), texto principal (`text-slate-100`) e secundário (`text-slate-400/500`).
- Preserve o mesmo padrão de raio, sombra e espaçamento entre componentes equivalentes.
- Em botões e elementos clicáveis, sempre definir `hover`, `focus` e contraste legível.
- Evite misturar tons antigos (`gray-*`) com a base nova (`slate-*`) no mesmo componente.
- Mensagens de erro/sucesso/aviso devem manter semântica de cor e contraste.

## Padrão de modal
- Overlay escuro com blur.
- Container com `overflow-hidden` e `max-height` explícito (`85vh` ou `90vh`).
- Header e footer fixos visuais; corpo com `overflow-y-auto`.
- Lista longa sempre com área rolável interna (`custom-scrollbar` quando existir no projeto).

## Padrão de formulário e lista
- Inputs com fundo escuro, borda visível e foco azul.
- Placeholder discreto e legível.
- Linhas de tabela/lista com hover e indicação visual de seleção.
- Estados vazios com mensagem clara e ícone quando aplicável.

## Checklist antes de finalizar
- [ ] Cores e contraste seguem o padrão escuro.
- [ ] Espaçamento, bordas e tipografia estão uniformes.
- [ ] Modal/lista longa rola corretamente.
- [ ] Não há mistura inconsistente de classes de cor.
- [ ] Fluxo continua funcional (buscar, selecionar, confirmar).
