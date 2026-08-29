# Configuração de Memória para PM2

## Problema
O sistema pode apresentar erro "JavaScript heap out of memory" ao processar campanhas com muitos contatos (400+).

## Solução

### Configuração via PM2 Ecosystem File

Crie ou edite o arquivo `ecosystem.config.js` na raiz do projeto backend:

```javascript
module.exports = {
  apps: [{
    name: 'compumai',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--max-old-space-size=4096',
    env: {
      NODE_ENV: 'production',
      NODE_MAX_OLD_SPACE_SIZE: '4096'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G'
  }]
};
```

### Configuração via Variável de Ambiente

Você também pode configurar via variável de ambiente no PM2:

```bash
pm2 start dist/server.js --name compumai --node-args="--max-old-space-size=4096"
```

Ou adicione no arquivo `.env`:

```
NODE_MAX_OLD_SPACE_SIZE=4096
```

E então configure o PM2 para usar essa variável:

```bash
pm2 start dist/server.js --name compumai --node-args="--max-old-space-size=$NODE_MAX_OLD_SPACE_SIZE"
```

### Valores Recomendados

- **Servidor com 2GB RAM**: `--max-old-space-size=1536` (1.5GB)
- **Servidor com 4GB RAM**: `--max-old-space-size=3072` (3GB)
- **Servidor com 8GB+ RAM**: `--max-old-space-size=4096` (4GB) ou mais

### Variáveis de Ambiente Adicionais para Campanhas

Para otimizar ainda mais o processamento de campanhas, configure:

```env
# Tamanho do lote de contatos processados por vez (padrão: 30, recomendado: 20)
CAMPAIGN_BATCH_SIZE=20

# Pausa entre batches em milissegundos (padrão: 5000, recomendado: 5000-10000)
CAMPAIGN_RATE_LIMIT=5000
```

### Verificação

Após configurar, reinicie o PM2:

```bash
pm2 restart compumai
```

E verifique o uso de memória:

```bash
pm2 monit
```

Ou verifique os logs:

```bash
pm2 logs compumai
```

## Notas

- O valor `--max-old-space-size` é em MB
- Deixe sempre uma margem de memória para o sistema operacional
- Monitore o uso de memória após implementar as otimizações
- As otimizações de código já implementadas reduzem significativamente o uso de memória
