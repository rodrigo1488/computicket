# 📋 Documentação do Sistema de Tickets

## 📖 Visão Geral

O **Sistema de Tickets** é uma aplicação web desenvolvida em Flask para gestão de chamados técnicos, ordens de serviço e controle de horas trabalhadas. O sistema integra com bancos de dados PostgreSQL e SQL Server para gerenciar clientes, contratos e faturamento.

## 🏗️ Arquitetura

### Tecnologias Utilizadas
- **Backend**: Flask 3.0.3
- **Banco de Dados**: SQLite (local), PostgreSQL (externo), SQL Server (externo)
- **Autenticação**: Flask-Login
- **Email**: Flask-Mail
- **PDF**: ReportLab
- **Timezone**: pytz

### Estrutura do Projeto
```
projeto tickets/
├── app/
│   ├── blueprints/          # Módulos da aplicação
│   ├── models.py           # Modelos de dados
│   ├── external_pg.py      # Conexão PostgreSQL
│   └── timezone_utils.py   # Utilitários de timezone
├── templates/              # Templates HTML
├── static/                 # Arquivos estáticos
├── ps/                     # Arquivos PDF gerados
└── run.py                  # Arquivo principal
```

## 🗄️ Modelos de Dados

### Principais Entidades

#### User (Usuário)
- **Campos**: id, name, email, password_hash, role
- **Roles**: admin, tecnico, viewer
- **Relacionamentos**: tickets abertos, tickets atribuídos, apontamentos

#### Client (Cliente)
- **Campos**: id, name, phone, document, contract_type
- **Relacionamentos**: contratos, tickets

#### Ticket (Chamado)
- **Campos**: id, title, description, status, created_at, closed_at
- **Status**: aberto, em_andamento, fechado, cancelado
- **Relacionamentos**: cliente, contrato, serviço, usuário, apontamentos

#### TimeEntry (Apontamento)
- **Campos**: id, ticket_id, user_id, hours, comment, start_time, end_time
- **Relacionamentos**: ticket, usuário

#### Service (Serviço)
- **Campos**: id, name, description, hourly_rate
- **Relacionamentos**: tickets

#### ServiceOrder (Ordem de Serviço)
- **Campos**: id, codigo, client_id, service_executed, value, status
- **Status**: 3 (sem cobrança), 5 (com cobrança)

## 🛣️ Endpoints da API

### 🔐 Autenticação (`/auth`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET/POST | `/auth/login` | Página de login | email, password |
| GET | `/auth/logout` | Logout do usuário | - |
| GET | `/auth/seed-admin` | Criar admin padrão | - |

### 📊 Dashboard (`/`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/dashboard` | Página principal | - |
| GET | `/api/dashboard/data` | Dados do dashboard | - |
| GET | `/api/dashboard/tickets-dia` | Tickets fechados hoje | - |
| GET | `/api/dashboard/faturamento-dia` | Faturamento do dia | - |
| GET | `/api/dashboard/tickets-pendentes` | Tickets pendentes | - |
| GET | `/api/dashboard/tickets-andamento` | Tickets em andamento | - |
| GET | `/api/dashboard/tickets-fechados` | Tickets fechados | - |
| GET | `/api/dashboard/total-horas` | Total de horas | - |

### 👥 Clientes (`/clientes`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/clientes/` | Lista de clientes | q, page, per_page |
| GET | `/clientes/search` | Busca clientes | q, limit |
| GET/POST | `/clientes/<id>/editar` | Editar cliente | name, document, phone, email, address |
| GET/POST | `/clientes/novo` | Novo cliente | name, phone, document, contract_type |
| GET/POST | `/clientes/importar` | Importar clientes CSV | file, contract_type |

### 👤 Usuários (`/usuarios`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/usuarios/` | Lista de usuários | - |
| GET/POST | `/usuarios/novo` | Novo usuário | name, email, password, role |
| GET/POST | `/usuarios/editar/<id>` | Editar usuário | name, email, password, role |

### ⚙️ Serviços (`/servicos`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/servicos/` | Lista de serviços | - |
| GET/POST | `/servicos/novo` | Novo serviço | name, description, hourly_rate |
| GET/POST | `/servicos/<id>/editar` | Editar serviço | name, description, hourly_rate |

### 📄 Contratos (`/contratos`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/contratos/` | Lista de contratos | - |
| GET | `/contratos/<nome>/services` | Serviços do contrato | - |
| POST | `/contratos/<nome>/link-service` | Vincular serviço | service_id |
| POST | `/contratos/<nome>/unlink-service/<id>` | Desvincular serviço | - |
| POST | `/contratos/<nome>/services` | Atualizar serviços | service_ids[] |
| GET | `/contratos/<nome>/gerenciar` | Gerenciar contrato | - |
| GET/POST | `/contratos/criar` | Criar contrato | contract_name, client_ids[], no_charge |
| GET/POST | `/contratos/<nome>/editar` | Editar contrato | new_name, no_charge |
| POST | `/contratos/<nome>/excluir` | Excluir contrato | - |
| GET | `/contratos/buscar-clientes-para-criacao` | Buscar clientes | q |
| GET | `/contratos/<nome>/buscar-clientes` | Buscar clientes | q |
| POST | `/contratos/<nome>/adicionar-clientes` | Adicionar clientes | client_ids[] |
| POST | `/contratos/<nome>/remover-cliente/<id>` | Remover cliente | - |

### 🎫 Tickets (`/tickets`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/tickets/` | Lista de tickets | status, assigned_to_id, q |
| GET | `/tickets/api/by-users` | Tickets por usuário | status, assigned_to_id, q |
| GET/POST | `/tickets/novo` | Novo ticket | title, description, external_client_id, solicitante, service_id, assigned_to_id |
| GET | `/tickets/<id>` | Visualizar ticket | - |
| POST | `/tickets/<id>/start` | Iniciar ticket | - |
| POST | `/tickets/<id>/assume` | Assumir ticket | - |
| POST | `/tickets/<id>/stop` | Parar ticket | comment |
| POST | `/tickets/<id>/apontar` | Adicionar apontamento | start_time, end_time, comment |
| POST | `/tickets/<id>/fechar` | Fechar ticket | manual_total_cost |
| POST | `/tickets/<id>/cancelar` | Cancelar ticket | cancel_reason |
| GET | `/tickets/<id>/observations` | Observações do ticket | - |
| GET | `/tickets/<id>/client-data` | Dados do cliente | - |
| GET | `/tickets/<id>/can-print` | Verificar se pode imprimir | - |
| GET | `/tickets/api/notifications` | Notificações | - |
| POST | `/tickets/api/mark-as-seen` | Marcar como visto | ticket_ids[] |
| POST | `/tickets/<id>/mark-seen` | Marcar ticket como visto | - |
| GET | `/tickets/pdf/<filename>` | Servir PDF | - |
| GET | `/tickets/<id>/edit` | Editar ticket | - |
| POST | `/tickets/<id>/edit` | Atualizar ticket | title, description, assigned_to_id, service_id, client_id, external_client_id, contract_id |
| GET | `/tickets/<id>/time-entry/<id>/edit` | Editar apontamento | - |
| POST | `/tickets/<id>/time-entry/<id>/edit` | Atualizar apontamento | comment, start_date, start_time, end_date, end_time |
| POST | `/tickets/<id>/time-entry/<id>/delete` | Deletar apontamento | - |
| GET | `/tickets/api/check-service-contract` | Verificar contrato do serviço | client_id, service_id |

### 📋 Ordens de Serviço (`/ordens-servico`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/ordens-servico/` | Lista de ordens | - |
| GET | `/ordens-servico/finalizadas` | Ordens finalizadas | - |
| GET | `/ordens-servico/finalizar` | Finalizar ordem | - |
| GET | `/ordens-servico/search/<codigo>` | Buscar ordem | - |
| POST | `/ordens-servico/processar-finalizacao` | Processar finalização | codigo, servico_executado, valor |
| GET | `/ordens-servico/<id>` | Visualizar ordem | - |
| GET | `/ordens-servico/pdf/<filename>` | Servir PDF | - |

### 📊 Relatórios (`/relatorios`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/relatorios/` | Página de relatórios | - |
| GET | `/relatorios/api/hours-by-client` | Horas por cliente | start, end |
| GET | `/relatorios/api/hours-by-technician` | Horas por técnico | start, end |
| GET | `/relatorios/api/billing-by-technician` | Faturamento por técnico | start, end |
| GET | `/relatorios/api/tickets-by-technician` | Tickets por técnico | start, end |
| GET | `/relatorios/api/productivity-metrics` | Métricas de produtividade | start, end |
| GET | `/relatorios/api/service-performance` | Performance por serviço | start, end |
| GET | `/relatorios/tickets` | Relatório de tickets | start, end, user_id, client_id |
| GET | `/relatorios/horas` | Relatório de horas | start, end, user_id, client_id |

### 📄 PS (Prestação de Serviço) (`/ps`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/ps/` | Página de PS | - |
| GET | `/ps/api/list` | Listar arquivos | folder |
| GET | `/ps/api/download/<path>` | Baixar arquivo | - |
| GET | `/ps/api/view/<path>` | Visualizar arquivo | - |
| DELETE | `/ps/api/delete/<path>` | Deletar arquivo | - |

### 🖨️ Impressão (`/printers`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| POST | `/printers` | Imprimir PS | body: ticket_number, client_name, description_service, total_amount |
| POST | `/generate-os` | Gerar ordem de serviço | client_name, desk_name, responsible_name, title, description, date_time |

### ⚙️ Configurações (`/configuracoes`)

| Método | Endpoint | Descrição | Parâmetros |
|--------|----------|-----------|------------|
| GET | `/configuracoes/` | Página de configurações | - |
| POST | `/configuracoes/save` | Salvar configurações | configs (JSON) |
| POST | `/configuracoes/test-email` | Testar email | - |
| POST | `/configuracoes/reset` | Resetar configurações | - |
| GET | `/configuracoes/export` | Exportar configurações | - |
| POST | `/configuracoes/import` | Importar configurações | configs (JSON) |

## 🔧 Funcionalidades Principais

### 1. Gestão de Tickets
- **Criação**: Tickets com cliente externo, serviço, técnico responsável
- **Controle de Status**: Aberto → Em Andamento → Fechado/Cancelado
- **Apontamento de Horas**: Sistema de cronômetro e apontamento manual
- **Notificações**: Sistema de notificações em tempo real
- **Controle de Contratos**: Verificação automática de isenção por contrato

### 2. Dashboard Interativo
- **Métricas em Tempo Real**: Atualização automática a cada 30 segundos
- **Ranking de Técnicos**: Por tickets fechados no mês
- **Tickets em Andamento**: Carrossel com status visual por tempo
- **Faturamento**: Controle de receita diária
- **Relógio de Brasília**: Exibição em tempo real

### 3. Gestão de Clientes
- **Integração PostgreSQL**: Clientes externos do banco principal
- **Busca Avançada**: Filtros por nome, documento, telefone, email
- **Contratos**: Sistema de contratos com isenção de cobrança
- **Importação CSV**: Importação em lote de clientes

### 4. Ordens de Serviço
- **Finalização**: Processo completo de finalização
- **Geração de PDFs**: PS e recibo de entrega
- **Integração Bancos**: SQL Server e PostgreSQL
- **Controle de Status**: Com/sem cobrança

### 5. Relatórios Avançados
- **Horas por Cliente/Técnico**: Relatórios detalhados
- **Faturamento**: Por técnico e período
- **Produtividade**: Métricas de performance
- **Performance por Serviço**: Análise de tipos de serviço

### 6. Sistema de Impressão
- **PS (Prestação de Serviço)**: Geração automática de PDFs
- **Recibos de Entrega**: Documentos de entrega
- **Integração Financeira**: Inserção automática nos bancos
- **Controle de Numeração**: Sequencial automático

### 7. Configurações do Sistema
- **Email**: Configuração SMTP para notificações
- **Sistema**: Configurações gerais
- **Backup**: Configurações de backup
- **Importação/Exportação**: Backup de configurações

## 🔐 Sistema de Autenticação

### Roles de Usuário
- **admin**: Acesso total ao sistema
- **tecnico**: Acesso a tickets e funcionalidades operacionais
- **viewer**: Apenas visualização

### Controle de Acesso
- Login obrigatório para todas as rotas
- Verificação de role para funcionalidades administrativas
- Sistema de sessão com Flask-Login

## 📧 Sistema de Notificações

### Email
- **Notificações de Tickets**: Email automático para técnicos
- **Configuração SMTP**: Gmail, Outlook, etc.
- **Templates HTML**: Emails formatados

### Notificações em Tempo Real
- **Sistema de Badge**: Contador de tickets não vistos
- **Pop-ups**: Notificação de novos tickets
- **Atualização Automática**: A cada 30 segundos

## 🗄️ Integração com Bancos de Dados

### SQLite (Local)
- **Tickets**: Dados principais dos chamados
- **Usuários**: Sistema de autenticação
- **Serviços**: Catálogo de serviços
- **Configurações**: Configurações do sistema

### PostgreSQL (Externo)
- **Clientes**: Base principal de clientes
- **Contratos**: Sistema de contratos
- **Financeiro**: Controle financeiro
- **Ordens de Serviço**: Dados das OS

### SQL Server (Externo)
- **Serviços**: Tabela de serviços para PS
- **Numeração**: Controle sequencial de documentos

## 🎨 Interface do Usuário

### Design Responsivo
- **Mobile First**: Interface adaptável
- **Tema Claro/Escuro**: Alternância de temas
- **Componentes Modernos**: Cards, modais, carrosséis

### Funcionalidades de UX
- **Filtros Persistentes**: Cookies para manter filtros
- **Busca em Tempo Real**: Filtros dinâmicos
- **Modais Interativos**: Pop-ups para detalhes
- **Carrosséis**: Navegação por slides

## 🚀 Como Executar

### Pré-requisitos
```bash
pip install -r requirements.txt
```

### Configuração
1. Configurar conexões de banco em `app/external_pg.py` e `app/blueprints/utils.py`
2. Configurar email em `app/__init__.py`
3. Executar migrações automáticas do SQLite

### Execução
```bash
python run.py
```

### Acesso
- **URL**: http://localhost:5000
- **Admin Padrão**: admin@example.com / admin

## 📝 Notas Técnicas

### Timezone
- **Brasília**: Todas as datas em timezone de Brasília
- **Conversão Automática**: UTC para exibição

### Migrações
- **SQLite**: Migrações automáticas na inicialização
- **Campos Dinâmicos**: Adição de colunas conforme necessário

### Performance
- **Paginação**: Listas com paginação
- **Índices**: Otimização de consultas
- **Cache**: Sistema de notificações com cache

### Segurança
- **Validação**: Validação de dados de entrada
- **Sanitização**: Limpeza de dados
- **Controle de Acesso**: Verificação de permissões

## 🔄 Fluxos Principais

### 1. Criação de Ticket
1. Selecionar cliente externo
2. Definir serviço e técnico
3. Informar solicitante
4. Sistema verifica contratos
5. Envia notificação por email

### 2. Apontamento de Horas
1. Iniciar cronômetro ou apontar manualmente
2. Sistema calcula horas automaticamente
3. Verifica isenção por contrato
4. Registra apontamento com timestamps

### 3. Finalização de Ticket
1. Verificar apontamentos
2. Calcular custo (manual ou automático)
3. Verificar contratos para isenção
4. Fechar ticket com data/hora

### 4. Geração de PS
1. Verificar se ticket pode ser impresso
2. Inserir no SQL Server (numeração)
3. Inserir no PostgreSQL (financeiro)
4. Gerar PDF com dados completos
5. Marcar como impresso

### 5. Finalização de OS
1. Buscar ordem no PostgreSQL
2. Verificar dados do cliente
3. Processar finalização
4. Gerar PS e recibo se necessário
5. Atualizar status da OS

## 🐛 Troubleshooting

### Problemas Comuns
1. **Conexão com Banco**: Verificar credenciais e conectividade
2. **Email não Envia**: Verificar configurações SMTP
3. **PDF não Gera**: Verificar permissões da pasta `ps/`
4. **Timezone Incorreto**: Verificar configuração do servidor

### Logs
- **Console**: Logs de debug no console
- **Arquivos**: Logs de erro em arquivos específicos
- **Database**: Logs de transações no banco

## 📈 Melhorias Futuras

### Funcionalidades Planejadas
- **API REST**: Endpoints para integração externa
- **Mobile App**: Aplicativo móvel
- **Relatórios Avançados**: Dashboards mais detalhados
- **Integração WhatsApp**: Notificações via WhatsApp
- **Backup Automático**: Sistema de backup agendado

### Otimizações
- **Cache Redis**: Cache de consultas frequentes
- **CDN**: Distribuição de arquivos estáticos
- **Load Balancer**: Balanceamento de carga
- **Monitoramento**: Sistema de monitoramento

---

**Desenvolvido com ❤️ para gestão eficiente de tickets e serviços técnicos.**
