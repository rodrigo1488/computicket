# Agente Uniplus (Computicket)

Agente local que roda **no servidor do ERP Unico/Uniplus**, conecta ao Computicket por Socket.IO (`namespace /uniplus`) e executa escritas no Postgres `unico`.

Espelha o padrão do Print Agent Compuchat (Bearer + Device-Id + ACK, **bandeja do Windows**, PyInstaller **sem console**).

## Requisitos (máquina de build)

- Python 3.10+
- Rede de saída até a API Computicket (porta 5000 ou a que usar)
- Acesso local ao Postgres `unico` (geralmente `127.0.0.1`)

## Build — gerar o `.exe` (PyInstaller)

Na pasta do agente:

```bat
cd agents\uniplus_agent
build.bat
```

O `build.bat`:

1. Cria `.venv` (se ainda não existir)
2. Instala `requirements.txt` + `requirements-build.txt` (PyInstaller, pystray, Pillow)
3. Gera `assets\uniplus_agent.ico`
4. Faz smoke-check dos imports (inclui `tray` / `pystray`)
5. Gera o executável com `UniplusAgent.spec` (`console=False`)

**Saída:** `agents\uniplus_agent\dist\UniplusAgent.exe` (onefile, **sem console**, ícone na bandeja)

Você pode copiar **apenas** `UniplusAgent.exe` para o servidor Uniplus (qualquer pasta). Na primeira execução cria `agent.db` **ao lado do .exe**.

### Build manual (equivalente)

```bat
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt -r requirements-build.txt
.venv\Scripts\python.exe make_icon.py
.venv\Scripts\python.exe -m PyInstaller --noconfirm UniplusAgent.spec
```

## Como rodar

### No servidor Uniplus (produção)

1. Copie `dist\UniplusAgent.exe` para a máquina do Unico
2. Execute (duplo clique): o agente sobe **na bandeja** (sem janela preta)
3. Clique com o botão direito no ícone:
   - **Abrir configuração** → http://localhost:5100
   - **Ver logs** → abre `agent_console.log` (ou a página de logs)
   - **Status** → Conectado / Desconectado
   - **Sair** → encerra Flask + agente
4. Configure URL do Computicket, Device ID, Token e Postgres

O `agent.db` fica na mesma pasta do executável. Stdout/stderr vão para `agent_console.log` ao lado do `.exe`.

### Desenvolvimento / máquina de build

```bat
run.bat
```

- Se existir `dist\UniplusAgent.exe`, o `run.bat` inicia o `.exe` (modo bandeja)
- Caso contrário, usa `.venv\Scripts\python.exe app.py` (console; use `app.py --tray` para testar a bandeja)

```bat
.venv\Scripts\python.exe app.py --tray
```

## Configuração

### No Computicket — preferencial: UI

**Configurações → Uniplus**: habilitar agente, Device ID e Token. Valores ficam em `SystemConfig` (`uniplus_agent_*`).

### Alternativa — `.env` da API (fallback se a UI não tiver valor)

```
UNIPLUS_AGENT_ENABLED=1
UNIPLUS_AGENT_DEVICE_ID=uniplus-server-1
UNIPLUS_AGENT_TOKEN=gere-um-segredo-longo
```

### No agente (UI :5100)

| Campo | Exemplo |
|-------|---------|
| URL Computicket | `http://192.168.x.x:5000` |
| Device ID | mesmo da aba Uniplus / `UNIPLUS_AGENT_DEVICE_ID` |
| Token | mesmo da aba Uniplus / `UNIPLUS_AGENT_TOKEN` |
| Postgres | host `127.0.0.1`, db `unico`, user/senha locais |

## Fluxo

1. API enfileira `UniplusJob` e emite `uniplus_job` no namespace `/uniplus`
2. Agente recebe, executa SQL no Unico, envia `ack` (`done`/`error`)
3. API (`wait_job`) libera a request HTTP

Com o agente desabilitado a API volta ao modo legado (`connect_postgres` direto).

## Job types

`create_client`, `update_client`, `assign_contract`, `add_client_to_contract`, `remove_client_from_contract`, `update_contract_type`, `remove_contract_from_all`, `add_clients_to_contract`, `insert_finance_ps`, `delete_finance_ps`, `create_dav`, `insert_finance_avulso`, `cancel_finance_avulso`, `finalize_ordemservico`

Ver também `docs/BANCO_UNICO.md`.

## Notas / caveats

- O build é **onefile** + **windowed** (`console=False`), no espírito do Print Agent Compuchat. Templates e `assets/` vão embutidos (`sys._MEIPASS`).
- `agent.db` e `agent_console.log` **não** ficam dentro do `.exe`: ficam ao lado do executável.
- Antivírus às vezes sinaliza executáveis PyInstaller; se bloqueado, adicione exceção ou use assinatura de código.
- Rebuild após mudar `templates/` ou código Python: rode `build.bat` de novo e redistribua o `.exe`.
