from routers.auth import router as auth
from routers.lojas import router as lojas
from routers.notificacoes import router as notificacoes
from routers.pedidos import router as pedidos
from routers.sistema import router as sistema
from routers.usuarios import router as usuarios
from routers.webhooks import router as webhooks

ROUTERS = [auth, lojas, pedidos, webhooks, notificacoes, usuarios, sistema]
