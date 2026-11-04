2026-11-04 | desktop moves from Electrobun to Electron (server stays Bun as a child process; native WebContentsView tabs driven over CDP) | native in-app browser controllable by agents, as OpenBot; WKWebView has no CDP
2026-11-04 | Electrobun trocado por Electron; server como processo filho compilado | D11, pedido de fase desktop
2026-11-04 | navegador nativo dos agentes por WebContentsView + CDP, partição por agente | D11
2026-11-04 | barra de título de largura total no desktop, no lugar do divisor ajustado | pedido do usuário (estilo OpenBot)
2026-11-04 | abrir no login, atualização automática e release no CI | item 1 (falta o Developer ID)
2026-11-04 | CI e release para Windows e Linux além do macOS | regra: tudo nos três sistemas
2026-11-04 | menu/contexto/zoom/permissões/fuses, ícone no grid da Apple, aviso de atualização no trilho | pedido: boas práticas do Electron e ícone atualizado
2026-11-04 | versão 0.2.0; install.sh + assinatura ad hoc + update manual no macOS; macOS 27 recusa ad hoc | pedido: estratégia sem certificado (testada: não roda no macOS 27)
