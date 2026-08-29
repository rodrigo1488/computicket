# 🎧 Sistema de Help Desk

## 📋 Visão Geral

O **Sistema de Help Desk** é uma funcionalidade integrada ao sistema de tickets que permite atendimento em tempo real entre clientes e agentes técnicos através de um chat interativo.

## 🚀 Funcionalidades

### Para Clientes
- **Login Simples**: Acesso com email e senha padrão
- **Validação Automática**: Email validado no banco PostgreSQL
- **Criação de Atendimento**: Formulário para descrever o problema
- **Chat em Tempo Real**: Comunicação instantânea com agentes
- **Status em Tempo Real**: Acompanhamento do status do atendimento

### Para Agentes
- **Interface WhatsApp-like**: Duas abas (Aguardando/Atendendo) com lista de conversas
- **Lista de Conversas**: Visualização moderna com avatares e status
- **Chat Inline**: Conversa carregada diretamente na interface principal
- **Assumir Atendimentos**: Sistema de fila com atribuição automática
- **Chat Interativo**: Interface de chat com indicadores de digitação
- **Criação de Tickets**: Conversão automática de chat para ticket técnico
- **Controle de Sessão**: Fechamento e gerenciamento de atendimentos

## 🔧 Tecnologias Utilizadas

- **Backend**: Flask + Flask-SocketIO
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 5
- **WebSockets**: Socket.IO para comunicação em tempo real
- **Banco de Dados**: SQLite (sessões e mensagens) + PostgreSQL (validação de clientes)
- **Autenticação**: Sistema de sessão para clientes

## 📁 Estrutura de Arquivos

```
app/
├── blueprints/
│   ├── helpdesk.py              # Blueprint principal do help desk
│   └── helpdesk_socketio.py     # Eventos WebSocket
├── models.py                    # Modelos HelpDeskSession e HelpDeskMessage
└── external_pg.py              # Função get_client_by_email

templates/helpdesk/
├── client_login.html           # Login para clientes
├── client_new_chat.html        # Formulário de novo atendimento
├── client_chat.html            # Interface de chat do cliente
├── index.html                  # Dashboard principal (WhatsApp-like)
├── agent_chat.html             # Interface de chat do agente (página completa)
└── agent_chat_inline.html      # Chat inline para carregamento via AJAX
```

## 🗄️ Modelos de Dados

### HelpDeskSession
- **session_id**: ID único da sessão (UUID)
- **client_email**: Email do cliente
- **client_name**: Nome do cliente
- **client_id**: ID do cliente no PostgreSQL
- **title**: Título do atendimento
- **description**: Descrição do problema
- **status**: waiting, active, closed
- **assigned_to_id**: Agente responsável
- **ticket_id**: Ticket criado a partir do chat

### HelpDeskMessage
- **session_id**: Referência à sessão
- **message**: Conteúdo da mensagem
- **sender_type**: client, agent, system
- **sender_id**: ID do agente (se aplicável)
- **sender_name**: Nome do remetente
- **created_at**: Timestamp da mensagem

## 🛣️ Endpoints

### Cliente
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/helpdesk/client` | Página de login |
| POST | `/helpdesk/client/login` | Autenticação |
| GET | `/helpdesk/client/new-chat` | Novo atendimento |
| POST | `/helpdesk/client/create-chat` | Criar chat |
| GET | `/helpdesk/client/chat/<session_id>` | Interface de chat |

### Agente
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/helpdesk/` | Dashboard principal |
| GET | `/helpdesk/agent/chat/<id>` | Interface de chat (página completa) |
| GET | `/helpdesk/agent/chat/<id>/inline` | Chat inline (AJAX) |
| GET | `/helpdesk/api/sessions/waiting` | API sessões aguardando |
| GET | `/helpdesk/api/sessions/active` | API sessões ativas |
| GET | `/helpdesk/api/chat/<id>/messages` | API mensagens |
| POST | `/helpdesk/api/chat/<id>/send` | Enviar mensagem |
| POST | `/helpdesk/api/chat/<id>/create-ticket` | Criar ticket |
| POST | `/helpdesk/api/chat/<id>/close` | Fechar sessão |

## 🔌 Eventos WebSocket

### Cliente → Servidor
- `join_chat`: Entrar na sala do chat
- `leave_chat`: Sair da sala do chat
- `send_message`: Enviar mensagem
- `typing`: Indicar que está digitando

### Servidor → Cliente
- `new_message`: Nova mensagem recebida
- `user_typing`: Usuário está digitando
- `user_joined`: Usuário entrou no chat
- `user_left`: Usuário saiu do chat
- `session_assumed`: Sessão foi assumida
- `session_closed`: Sessão foi fechada
- `ticket_created`: Ticket foi criado

## 🔐 Autenticação

### Clientes
- **Senha Padrão**: `23` (configurável)
- **Validação**: Email deve existir no banco PostgreSQL
- **Sessão**: Armazenada em cookies do navegador

### Agentes
- **Login**: Sistema de autenticação existente
- **Permissões**: Apenas usuários logados podem acessar
- **Controle de Acesso**: Agente só pode assumir sessões disponíveis

## 📋 Regras de Negócio

### Criação de Tickets
- ✅ **Sessão Ativa**: Ticket só pode ser criado quando a sessão está "active"
- ✅ **Conversa Iniciada**: Agente deve ter assumido a sessão e iniciado conversa
- ✅ **Um Ticket por Sessão**: Cada sessão pode gerar apenas um ticket
- ✅ **Serviço Obrigatório**: Agente deve selecionar um serviço antes de criar
- ✅ **Início Automático**: Ticket é criado já em status "em_andamento"

### Estados da Sessão
- **waiting**: Aguardando agente assumir
- **active**: Agente assumiu e conversa em andamento
- **closed**: Sessão finalizada

### Botões e Ações
- **"Assumir"**: Aparece apenas em sessões "waiting"
- **"Criar Ticket"**: Aparece apenas em sessões "active" sem ticket
- **"Ver Ticket"**: Aparece quando ticket já foi criado
- **"Fechar"**: Disponível em qualquer momento para o agente responsável

## 🎯 Fluxo de Atendimento

### 1. Cliente Inicia Atendimento
1. Acessa `/helpdesk/client`
2. Faz login com email e senha padrão
3. Preenche formulário com título e descrição
4. Sistema cria sessão e coloca em "aguardando"

### 2. Agente Assume Atendimento
1. Visualiza sessões aguardando no dashboard
2. Clica em "Assumir" para assumir a sessão
3. Sistema atribui automaticamente ao agente
4. Envia mensagem automática de boas-vindas

### 3. Conversa em Tempo Real
1. Cliente e agente trocam mensagens via WebSocket
2. Sistema salva todas as mensagens no banco
3. Indicadores de digitação em tempo real
4. Notificações de eventos (entrada/saída)

### 4. Criação de Ticket (Opcional)
1. **Pré-requisito**: Agente deve estar em uma conversa ativa com o cliente
2. Agente clica em "Criar Ticket" (botão só aparece quando sessão está ativa)
3. Seleciona o serviço apropriado
4. Sistema cria ticket automaticamente com:
   - Título e descrição do chat
   - Cliente e solicitante
   - Agente responsável
   - Status "em_andamento"
5. Notifica cliente sobre criação do ticket
6. Botão "Criar Ticket" é substituído por "Ver Ticket #X"

### 5. Fechamento da Sessão
1. Agente clica em "Fechar"
2. Sistema envia mensagem de despedida
3. Sessão é marcada como "fechada"
4. Histórico fica disponível para consulta

## ⚙️ Configuração

### 1. Instalar Dependências
```bash
pip install Flask-SocketIO==5.3.6
```

### 2. Configurar Banco de Dados
- As tabelas são criadas automaticamente na inicialização
- Migrações SQLite são executadas automaticamente

### 3. Configurar Senha Padrão
```python
# Em app/blueprints/helpdesk.py
DEFAULT_CLIENT_PASSWORD = "sua_senha_personalizada"
```

### 4. Executar Aplicação
```bash
python run.py
```

## 🎨 Interface do Usuário

### Design Responsivo
- **Interface WhatsApp-like**: Layout moderno similar ao WhatsApp Web
- **Duas Abas**: Aguardando e Atendendo para organização clara
- **Lista de Conversas**: Avatares, nomes, previews e status visuais
- **Chat Inline**: Conversa carregada diretamente na interface principal
- **Mobile First**: Interface adaptável para dispositivos móveis
- **Bootstrap 5**: Componentes modernos e responsivos
- **Tema Consistente**: Integrado com o design do sistema principal

### Funcionalidades de UX
- **Auto-scroll**: Chat rola automaticamente para novas mensagens
- **Indicadores Visuais**: Status coloridos e badges informativos
- **Modais Interativos**: Pop-ups para criação de tickets
- **Notificações**: Alertas e confirmações para ações importantes

## 🔄 Integração com Sistema Principal

### Criação de Tickets
- **API Reutilizada**: Usa a mesma API de criação de tickets
- **Dados Automáticos**: Preenche automaticamente campos do ticket
- **Status Inicial**: Ticket criado já em "em_andamento"
- **Vinculação**: Sessão de chat vinculada ao ticket criado

### Navegação
- **Menu Lateral**: Item "Help Desk" adicionado ao menu principal
- **Permissões**: Acesso baseado no sistema de roles existente
- **Breadcrumbs**: Navegação consistente com o resto do sistema

## 📊 Monitoramento e Logs

### Logs de Sistema
- **Criação de Tickets**: Log detalhado quando ticket é criado via help desk
- **Sessões**: Registro de início, atribuição e fechamento
- **Mensagens**: Todas as mensagens são salvas com timestamp

### Métricas Disponíveis
- **Sessões Aguardando**: Contador em tempo real
- **Sessões Ativas**: Lista de atendimentos em andamento
- **Tempo de Resposta**: Tempo entre criação e atribuição
- **Taxa de Conversão**: Percentual de chats convertidos em tickets

## 🚀 Melhorias Futuras

### Funcionalidades Planejadas
- **Notificações Push**: Notificações em tempo real para agentes
- **Transferência de Sessão**: Transferir atendimento entre agentes
- **Arquivos**: Upload de imagens e documentos no chat
- **Templates**: Mensagens pré-definidas para agentes
- **Relatórios**: Relatórios específicos do help desk

### Otimizações
- **Cache Redis**: Cache de sessões ativas
- **Load Balancing**: Distribuição de carga para WebSockets
- **Compressão**: Compressão de mensagens para melhor performance
- **Backup**: Backup automático de conversas importantes

## 🐛 Troubleshooting

### Problemas Comuns

#### WebSocket não conecta
- Verificar se Flask-SocketIO está instalado
- Verificar se o servidor está rodando com `socketio.run()`
- Verificar console do navegador para erros JavaScript

#### Cliente não consegue fazer login
- Verificar se o email existe no PostgreSQL
- Verificar senha padrão configurada
- Verificar logs do servidor para erros de conexão

#### Mensagens não aparecem em tempo real
- Verificar conexão WebSocket no console do navegador
- Verificar se os eventos estão sendo emitidos corretamente
- Verificar logs do servidor para erros de WebSocket

### Logs Úteis
```bash
# Logs de conexão WebSocket
tail -f logs/socketio.log

# Logs de criação de tickets
grep "TICKET CRIADO VIA HELP DESK" logs/app.log

# Logs de sessões
grep "HELPDESK" logs/app.log
```

## 📞 Suporte

Para dúvidas ou problemas com o sistema de Help Desk:

1. **Verificar Logs**: Sempre verificar logs primeiro
2. **Testar Conexão**: Testar WebSocket em navegador
3. **Validar Dados**: Verificar se dados estão sendo salvos corretamente
4. **Contato**: Entrar em contato com a equipe de desenvolvimento

---

**Sistema de Help Desk - Atendimento em Tempo Real** 🎧✨
