# Análise de impacto do fuso horário na aplicação

Este documento lista onde o fuso horário (UTC vs Brasília) pode impactar o comportamento da aplicação e o que já foi ajustado.

## Configuração atual

- **Banco (config/database.ts):** `timezone: "-03:00"` — sessão MySQL usa horário de Brasília para funções de data.
- **Backend Node:** Se o servidor rodar em UTC (ex.: cloud), `new Date()` e limites de "dia" são em UTC, a menos que se use o helper de Brasília.
- **Helper:** `src/helpers/BrazilTimezone.ts` — funções para início/fim do dia no fuso de Brasília.

---

## Já corrigido (uso de Brasília)

| Área | Arquivo | O que foi feito |
|------|---------|------------------|
| Protocolo do pedido | ProcessFormResponseService | Contagem do dia e `PED-YYYYMMDD` usam `getBrazilDayBounds` e `getBrazilDateString`. |
| Vendas do dia (pedidos) | OrdersStatsService | "Pedidos hoje" usa `getBrazilDayBounds`. |
| Vendas do dia/mês (financeiro) | LanchonetesStatsService | `todayStr`, `startOfMonth` e evolução (30 dias) usam `getBrazilISODateString` / `getBrazilMonthStartString`. |
| Registro de venda | RegisterGourmetVendaService | Campo `dataVenda` gravado com `getBrazilISODateString`. |
| Estatísticas de agendamento | AgendamentoStatsService | "Agendamentos hoje" e "concluídos hoje" usam `getBrazilDayBounds`; `todayStr` em Brasil. |
| Impressão (data/hora) | receipt_formatter.py (agente) | Data/hora do cupom convertida para America/Sao_Paulo. |

---

## Pontos que ainda podem ser afetados

### 1. Filtro de pedidos/respostas por data (FormResponseController)

- **Arquivo:** `controllers/FormResponseController.ts`
- **Comportamento:** `dateFrom` e `dateTo` vêm do frontend (ex.: `"2026-03-07"`). Hoje são usados como `new Date(String(dateFrom))` e `new Date(String(dateTo))`, ou seja, interpretados no fuso do servidor (ou UTC).
- **Risco:** Usuário em Brasília que filtra "07/03" pode ver pedidos de 06/03 21h a 07/03 20h59 UTC.
- **Sugestão:** Quando `dateFrom`/`dateTo` forem apenas data (YYYY-MM-DD), converter para limites do dia em Brasília com `getBrazilDayBoundsForDateString(isoDate)` e usar `startOfDay`/`endOfDay` no filtro de `submittedAt`.

### 2. Listagem de tickets por data (ListTicketsService / ListTicketsServiceKanban)

- **Arquivos:** `services/TicketServices/ListTicketsService.ts`, `ListTicketsServiceKanban.ts`
- **Comportamento:** Filtro por `date`/`updatedAt` usa `startOfDay(parseISO(date))` e `endOfDay(parseISO(date))` do date-fns, no fuso local do servidor.
- **Risco:** Em servidor UTC, "07/03" vira 07/03 00:00–23:59 UTC, não 07/03 em Brasília.
- **Sugestão:** Para filtro por data única, usar `getBrazilDayBoundsForDateString(date)` e filtrar com esses limites (em UTC) em `createdAt`/`updatedAt`.

### 3. Dashboard estendido (DashboardExtendedService)

- **Arquivo:** `services/ReportService/DashboardExtendedService.ts`
- **Comportamento:** "Tickets criados hoje" usa `today.setHours(0, 0, 0, 0)` (meia-noite no fuso do servidor). Período `dateFrom`/`dateTo` também em horário do servidor.
- **Risco:** Em servidor UTC, "hoje" e períodos não batem com o dia em Brasília.
- **Sugestão:** Para "hoje", usar `getBrazilDayBounds(now)` e, quando os parâmetros forem só data (YYYY-MM-DD), usar `getBrazilDayBoundsForDateString` para montar o intervalo.

### 4. Relatório por dia (TicketsDayService)

- **Arquivo:** `services/ReportService/TicketsDayService.ts`
- **Comportamento:** SQL usa `DATE(tick."createdAt")` e compara com `initialDate`/`finalDate` como string (ex.: `'${initialDate} 00:00:00'`).
- **Risco:** Depende de como o PostgreSQL interpreta `DATE()` (timezone da sessão). Com `timezone` do Sequelize em `-03:00` (se aplicável ao PG), pode já estar correto.
- **Sugestão:** Garantir que a conexão ao PostgreSQL use `timezone = 'America/Sao_Paulo'` (ou equivalente) ou converter explicitamente no SQL (ex.: `createdAt AT TIME ZONE 'America/Sao_Paulo'`) antes de aplicar `DATE()`.

### 5. Resumo por período (AgentSummaryGeminiService)

- **Arquivo:** `services/ReportService/AgentSummaryGeminiService.ts`
- **Comportamento:** Filtro por `dateStart`/`dateEnd` com `new Date(\`${dateStart} 00:00:00\`)` e `new Date(\`${dateEnd} 23:59:59\`)`.
- **Risco:** Interpretação de "00:00:00" e "23:59:59" no fuso do servidor (ou local do Node).
- **Sugestão:** Se as datas forem "dia no Brasil", usar `getBrazilDayBoundsForDateString` para obter os timestamps corretos em UTC e aplicar no filtro.

### 6. Agendamentos (Appointment AI / CheckAvailabilityService, etc.)

- **Arquivos:** `AppointmentAIService/ParseAppointmentCommand.ts`, `ExecuteAppointmentFunction.ts`, `CheckAvailabilityService.ts`
- **Comportamento:** `startOfDay`/`endOfDay` para uma data são construídos com `new Date(year, month - 1, day, 0, 0, 0)` (e 23:59:59), ou seja, no fuso local do servidor.
- **Risco:** Em servidor UTC, "7 de março" vira 07/03 em UTC, não em Brasília.
- **Sugestão:** Para "dia do agendamento" no fuso da empresa (Brasil), usar `getBrazilDayBoundsForDateString(isoDate)` e comparar `startTime`/`endTime` com esses limites.

### 7. Cron jobs (server.ts)

- **Arquivo:** `server.ts`
- **Comportamento:** Crons como `"0 0 * * *"` (meia-noite), `"0 3 * * *"` (3h), `"0 9 * * *"` (9h) rodam no fuso **local do processo Node** (onde o app está hospedado).
- **Risco:** Em servidor UTC, "0 0 * * *" = meia-noite UTC = 21h do dia anterior em Brasília; "0 3 * * *" = 00h em Brasília.
- **Sugestão:** Documentar em qual fuso os crons foram pensados (ex.: "3h = 00h Brasília"). Se quiser "meia-noite em Brasília", usar `node-cron` com timezone (ex.: opção `timezone: 'America/Sao_Paulo'`) ou agendar em UTC (ex.: "0 3 * * *" para 00h BRT).

### 8. Frontend (exibição de datas)

- **Onde:** Qualquer tela que mostra `submittedAt`, `createdAt`, `updatedAt`, etc.
- **Risco:** Se o backend enviar datas em UTC (ISO) e o frontend não converter para o fuso do usuário, a "data/hora" exibida pode estar em UTC.
- **Sugestão:** No frontend, exibir sempre com `toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })` ou equivalente, ou garantir que a API devolva já formatada no fuso da empresa.

### 9. Cutoff “últimas 24 horas” (OrdersStatsService, getResponsesCutoff, server.ts)

- **Comportamento:** `getCutoff = () => new Date(Date.now() - 24 * 60 * 60 * 1000)` — intervalo relativo ("últimas 24h").
- **Risco:** Nenhum; não depende de "dia civil".
- **Ação:** Nenhuma alteração necessária por fuso.

---

## Helper disponível (BrazilTimezone.ts)

- `getBrazilDayBounds(now?)` — início e fim do **dia atual** em Brasília (em UTC).
- `getBrazilDateString(now?)` — `YYYYMMDD` do dia atual em Brasília (para protocolo).
- `getBrazilISODateString(now?)` — `YYYY-MM-DD` do dia atual em Brasília.
- `getBrazilMonthStartString(now?)` — `YYYY-MM-01` do mês atual em Brasília.
- `getBrazilDayBoundsForDateString(isoDate)` — dado `"YYYY-MM-DD"`, retorna início e fim **desse dia em Brasília** (em UTC), para usar em filtros.

---

## Resumo

- **Já tratado:** pedidos (protocolo, vendas do dia, stats), vendas do mês/evolução, registro de venda (dataVenda), agendamentos (stats “hoje”), impressão (data/hora no cupom).
- **Ainda sensíveis ao fuso:** filtros de data em FormResponse e Tickets, dashboard “hoje”, relatórios por dia, resumos por período, lógica de agendamentos (startOfDay/endOfDay) e crons. Recomenda-se ir aplicando o helper de Brasília nesses pontos conforme a prioridade do negócio.
