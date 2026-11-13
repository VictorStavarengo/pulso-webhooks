from prometheus_client import Counter, Gauge, Histogram

WEBHOOKS = Counter(
    "pulso_webhooks_recebidos",
    "Eventos de webhook processados",
    ["resultado"],
)
NOTIFICACOES = Counter(
    "pulso_notificacoes_criadas",
    "Notificações criadas por tipo",
    ["tipo"],
)
ENVIOS = Counter(
    "pulso_envios_alerta",
    "Tentativas de envio de alerta externo",
    ["canal", "status"],
)
RETENTATIVAS = Counter(
    "pulso_alertas_retentativas",
    "Resultado das retentativas da fila de alertas",
    ["canal", "resultado"],
)
SSE_CONEXOES = Gauge(
    "pulso_sse_conexoes",
    "Conexões SSE abertas neste processo",
)
PROCESSAMENTO = Histogram(
    "pulso_webhook_processamento_segundos",
    "Tempo de processamento de um evento de webhook",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5),
)
REQUISICOES = Counter(
    "pulso_requisicoes",
    "Requisições HTTP por método e status",
    ["metodo", "status"],
)
