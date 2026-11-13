# Painel do Pulso

Frontend em React 19 + TypeScript + Vite + Tailwind CSS 4.

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run build
```

O Vite faz proxy de `/api`, `/webhooks` e `/health` para `http://127.0.0.1:8000` (ajuste com `PULSO_API_URL`). Para apontar a outro host, defina `VITE_API_URL` no build; em produção o padrão é a mesma origem, com a API servindo o `dist`.

Documentação completa, arquitetura e deploy: [README principal](../README.md).
