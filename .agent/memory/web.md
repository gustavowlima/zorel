# web
keywords: web, react, ui, chat, channel, sidebar, route, memories, skills, model picker, tools, settings
status: active
updated: 2026-11-03

## current

- rota no hash (#/project/:id, #/chat/:id, #/memories, #/settings, #/new-project) em state.ts; id desconhecido dispara um reload
- api.ts: client tipado do contrato (call) + leitor SSE (sendMessage, abortável)
- features/: chat.tsx (membros, resposta ao vivo por agente, cartão de aprovação, passos de ferramenta), project.tsx (+ "Canal com todos"), memories.tsx (fatos e skills), tools.tsx (servidores MCP e Configurações/chaves), model-picker.tsx
- mensagens cobertas pelo resumo com opacidade 50%

- chat consome o runtime por RPC (api.ts: ManagedRuntime com RpcClient.layerProtocolSocket + reconexão; subscribeChat refaz a assinatura e recebe novo snapshot); enviar com o chat ocupado entra na fila; Parar = interrupt

## avoid

- arrow sem chaves em useEffect com APIs que podem devolver Promise (scrollIntoView no Chrome novo)
- estado global com lib externa enquanto as listas forem pequenas
