# Computicket Monitor Agent

Agente universal para estações Windows. Coleta telemetria leve, inventário e
atualizações pendentes, mantendo uma fila SQLite quando o servidor estiver
indisponível. A interface administrativa é exclusivamente local.

## Requisitos e instalação para desenvolvimento

- Windows 10/11 ou Windows Server com Python 3.11 ou superior.
- Acesso HTTP ou HTTPS ao servidor Computicket (HTTP é aceito para uso local/dev).

Execute `run.bat`. O script cria `.venv`, instala as dependências e inicia o
agente. A interface fica em `http://127.0.0.1:5110`; a porta pode ser alterada
com a variável `COMPUTICKET_MONITOR_PORT`.

No primeiro acesso, informe a URL base do servidor (ex.: `http://127.0.0.1:5000` ou
`https://computicket.exemplo.com`) e o código de ativação. O
agente envia `activation_code`, seu UUID local estável e a versão para
`POST /api/remote-monitor/enroll`. O servidor devolve `device_id` e `token`.
O UUID identifica o dispositivo e não é segredo. O token é protegido pelo
DPAPI do usuário Windows e somente o ciphertext é gravado no SQLite.

## Comunicação e segurança

O Socket.IO usa o namespace `/remote-monitor`. `device_id` e `token` seguem no
dicionário `auth` do handshake, nunca na query string. Certificados TLS são
verificados; em produção use URL `https://` com certificado válido e permita a
porta HTTPS utilizada (normalmente TCP 443) no firewall/proxy. A interface
Flask escuta apenas em `127.0.0.1`.

O fallback sem DPAPI existe apenas para testes/desenvolvimento fora do Windows
e exige `COMPUTICKET_ALLOW_INSECURE_TOKEN_STORAGE=1`. Ele não deve ser usado
em publicação.

## Comandos remotos

O agente executa, em uma única fila serial, os comandos `list_directory`,
`mkdir`, `rename`, `move`, `copy`, `delete`, `upload_file`, `download_file`,
`reboot` e `shutdown`. Comandos recebidos pelo Socket.IO nunca são executados
na thread de rede. A fila e os resultados ficam registrados no SQLite para
deduplicação após reinício; comandos já concluídos têm o resultado reenviado,
sem nova execução.

Somente caminhos absolutos de volumes Windows (por exemplo, `C:\Dados`) são
aceitos. Caminhos UNC, namespaces `\\.\`/`\\?\`, NUL e operações destrutivas
na raiz de volumes são recusados. Exclusão recursiva não segue symlinks nem
reparse points. Destinos existentes não são sobrescritos. Listagens são
limitadas a 2.000 entradas e transferências a 50 MiB; os arquivos são
transferidos por streaming, com TLS verificado.

As permissões são as do usuário que iniciou o executável. Pastas protegidas,
arquivos em uso e operações de energia podem exigir execução elevada/UAC ou
ser bloqueados por políticas corporativas. `reboot` e `shutdown` somente
funcionam no Windows, confirmam o resultado ao servidor antes de chamar
`shutdown.exe` e usam atraso de cinco segundos. Restrinja o acesso de
administradores/técnicos no servidor e trate os logs como trilha de auditoria.

## Coleta

- A cada 1 s: CPU, RAM, volumes, uptime, contadores de rede e conectividade.
- A cada 15 s: snapshot completo confirmado por ACK e armazenado em fila WAL.
- A cada 6 h: SO, BIOS, placa-mãe, CPU, módulos RAM, discos e GPU via CIM/WMI.
- A cada 1 h: atualizações pendentes via Windows Update COM.
- Heartbeat a cada 15 s (Socket.IO + reforço HTTP em `/api/remote-monitor/heartbeat`).
- Status "Conectado" só após o evento `ready` do servidor (auth confirmada).

Temperaturas dependem do suporte exposto por `psutil`/firmware. Muitos
equipamentos Windows não disponibilizam sensores; nesse caso o campo fica
indisponível (`null`), nunca `0`. WMI, Windows Update, políticas corporativas e
permissões podem limitar inventário e atualização; o payload registra
`unavailable` ou `error`, inclusive timeout.

## Testes

Na pasta do agente:

```bat
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Os testes não acessam servidor real e também rodam fora do Windows.

## Build e publicação

Execute `build.bat`. O PyInstaller gera um executável onefile/windowed em:

`dist/ComputicketMonitorAgent.exe`

O ícone da bandeja é desenhado em tempo de execução, portanto o build não
depende de arquivo `.ico`. Publique somente o `.exe` por canal autenticado,
idealmente assinado com certificado de code signing. O `agent.db` permanece ao
lado do executável e não deve ser copiado entre usuários/máquinas, pois o DPAPI
vincula o token ao usuário Windows que realizou a ativação.

## Operação

A bandeja permite abrir a UI, reiniciar o agente e sair. A página de
configuração mostra versão, UUID, conexão e tamanho da fila; a página de logs
mascara credenciais. A fila remove snapshots apenas após ACK, é drenada após
reconexão e possui limite de quantidade e retenção de sete dias.

## Ações remotas e arquivos

Administradores e técnicos autorizados podem reiniciar ou desligar a máquina
e gerenciar arquivos pelo detalhe do agente. Toda solicitação recebe um ID,
fica auditada no servidor e só aparece como concluída após a resposta do
agente. Reinício, desligamento e exclusão exigem confirmação explícita.

O gerenciador permite listar unidades e diretórios, criar pastas, renomear,
mover, copiar, excluir, enviar e baixar arquivos. Caminhos UNC, namespaces de
dispositivo, raízes de volume e reparse points são bloqueados nas operações
destrutivas. Transferências são limitadas a 50 MiB, usam arquivos temporários
e não sobrescrevem destinos existentes.

O executável precisa ter as permissões do usuário Windows que o iniciou.
Pastas protegidas e os comandos `shutdown.exe` podem exigir execução elevada
ou uma política corporativa apropriada. O módulo não oferece execução de
shell ou scripts remotos.
