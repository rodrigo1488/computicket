# Desempenho e CPU — backend

## Diagnóstico na VPS

```bash
cd /home/deploy/compumais/backend   # ajuste o caminho
bash scripts/cpu-diagnostic.sh
pm2 show compumais-backend
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SCHEDULE_MONITOR_CRON` | `*/30 * * * * *` | Repeat Bull de agendamentos (antes: 5s) |
| `CAMPAIGN_VERIFY_CRON` | `*/60 * * * * *` | Verificação de campanhas (antes: 20s) |
| `QUEUE_MONITOR_CRON` | `*/60 * * * * *` | Monitor de filas (antes: 20s) |
| `CAMPAIGN_QUEUE_CONCURRENCY` | `2` | Paralelismo Prepare/Dispatch |
| `WHATSAPP_MESSAGE_CONCURRENCY` | `5` | Mensagens processadas em paralelo |
| `FFMPEG_MAX_CONCURRENT` | `2` | Processos ffmpeg simultâneos |
| `ENABLE_WHATSAPP` | `true` | `false` = não abre Baileys neste processo |
| `ENABLE_BULL_WORKERS` | `true` | `false` = não processa filas Bull |
| `WHATSAPP_SHARD_COUNT` | `1` | Número de processos PM2 com WhatsApp |
| `WHATSAPP_SHARD_INDEX` | `0` | Índice deste processo (`companyId % COUNT`) |
| `WHATSAPP_MAX_SESSIONS_PER_PROCESS` | `0` | Máx. sessões por processo (`0` = ilimitado) |

## Shard com 20+ conexões (exemplo 3 processos PM2)

Processo 0 (`ecosystem` ou `.env`):

```
WHATSAPP_SHARD_COUNT=3
WHATSAPP_SHARD_INDEX=0
WHATSAPP_MAX_SESSIONS_PER_PROCESS=8
```

Processo 1: `WHATSAPP_SHARD_INDEX=1`  
Processo 2: `WHATSAPP_SHARD_INDEX=2`

Cada instância deve ter **apenas 1** réplica PM2 (`instances: 1`).

## API + worker (futuro)

- API: `ENABLE_WHATSAPP=false`, `ENABLE_BULL_WORKERS=false`
- Worker: `ENABLE_WHATSAPP=true`, `ENABLE_BULL_WORKERS=true`

Após deploy: `npm run build` e `pm2 restart compumais-backend`.
