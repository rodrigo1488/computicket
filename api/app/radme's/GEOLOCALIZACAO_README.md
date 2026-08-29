# 📍 Sistema de Geolocalização - Tickets

## 📖 Visão Geral

O sistema de tickets agora inclui funcionalidade de **captura automática de geolocalização** durante o apontamento de horas. Esta funcionalidade permite registrar a localização exata onde o trabalho foi realizado, proporcionando maior controle e transparência nos serviços.

## 🚀 Funcionalidades Implementadas

### ✅ **Captura Automática de Localização**
- **Botão "Capturar Localização"** em todos os formulários de apontamento
- **Geolocalização em tempo real** usando GPS do dispositivo
- **Reverse geocoding** para obter endereço formatado
- **Validação de permissões** com mensagens de erro específicas

### ✅ **Armazenamento de Dados**
- **Latitude e Longitude** com precisão de 6 casas decimais
- **Endereço formatado** obtido via API de geocoding reverso
- **Precisão da localização** em metros
- **Timestamp** da captura

### ✅ **Exibição na Interface**
- **Localização nos apontamentos** com link para Google Maps
- **Status visual** da captura (sucesso/erro/pendente)
- **Ícones informativos** para diferentes estados
- **Tooltips** com informações detalhadas

## 🎯 **Onde a Geolocalização é Capturada**

### 1. **Início de Ticket**
- Botão "Capturar Localização" antes de iniciar o trabalho
- Localização salva no momento do início da sessão

### 2. **Apontamento Manual de Horas**
- Captura opcional durante registro manual de horas
- Útil para trabalhos realizados em locais específicos

### 3. **Encerramento de Sessão**
- Captura da localização no momento de encerrar o trabalho
- Registra onde o técnico estava ao finalizar

## 🔧 **Como Usar**

### **Para o Técnico:**

1. **Acesse o ticket** que deseja trabalhar
2. **Clique em "Capturar Localização"** antes de iniciar
3. **Permita o acesso** à localização quando solicitado pelo navegador
4. **Aguarde a confirmação** de que a localização foi capturada
5. **Prossiga** com o início do trabalho normalmente

### **Para Visualizar Localizações:**

1. **Acesse um ticket** com apontamentos
2. **Veja a seção "Apontamentos"** na página do ticket
3. **Clique no link da localização** para abrir no Google Maps
4. **Visualize o endereço** ou coordenadas exatas

## 🛡️ **Segurança e Privacidade**

### **Dados Armazenados:**
- ✅ Apenas coordenadas geográficas
- ✅ Endereço público (rua, cidade, estado)
- ❌ **NÃO** armazena dados pessoais
- ❌ **NÃO** rastreia movimento contínuo

### **Controle de Acesso:**
- Apenas usuários autenticados podem capturar localização
- Dados visíveis apenas para usuários do sistema
- Localização é opcional - não impede o funcionamento sem ela

## 🔍 **Tratamento de Erros**

### **Permissão Negada:**
- Mensagem: "Permissão de localização negada"
- Solução: Permitir acesso nas configurações do navegador

### **GPS Indisponível:**
- Mensagem: "Localização indisponível"
- Solução: Verificar se o GPS está ativado

### **Timeout:**
- Mensagem: "Tempo limite excedido"
- Solução: Tentar novamente em local com melhor sinal

### **Navegador Não Suportado:**
- Mensagem: "Geolocalização não suportada"
- Solução: Usar navegador moderno (Chrome, Firefox, Safari, Edge)

## 📱 **Compatibilidade**

### **Navegadores Suportados:**
- ✅ Chrome 50+
- ✅ Firefox 45+
- ✅ Safari 10+
- ✅ Edge 12+
- ✅ Opera 37+

### **Dispositivos:**
- ✅ **Desktop** (com GPS ou localização por IP)
- ✅ **Mobile** (Android/iOS com GPS)
- ✅ **Tablet** (com GPS integrado)

## 🔧 **Configurações Técnicas**

### **Precisão:**
- **Alta precisão** habilitada por padrão
- **Timeout:** 10 segundos
- **Cache:** 5 minutos (reutiliza localização recente)

### **API de Geocoding:**
- **Serviço:** BigDataCloud (gratuito)
- **Idioma:** Português (pt)
- **Fallback:** Coordenadas se endereço não disponível

## 📊 **Estrutura do Banco de Dados**

### **Tabela `time_entry`:**
```sql
-- Novos campos adicionados
latitude FLOAT           -- Latitude da localização
longitude FLOAT          -- Longitude da localização  
address VARCHAR(500)     -- Endereço formatado
accuracy FLOAT           -- Precisão em metros
```

### **Migração Automática:**
- ✅ Campos adicionados automaticamente na inicialização
- ✅ Compatível com dados existentes
- ✅ Não afeta funcionalidades anteriores

## 🎨 **Interface do Usuário**

### **Estados Visuais:**

#### **🟡 Pendente:**
```
[📍] Localização não capturada
```

#### **🟢 Sucesso:**
```
[✅] Localização capturada
Rua das Flores, 123 - Centro, São Paulo
```

#### **🔴 Erro:**
```
[⚠️] Erro na localização
Permissão negada
```

### **Botões:**
- **Capturar Localização:** Botão outline com ícone de mapa
- **Status:** Texto pequeno abaixo do botão
- **Link Google Maps:** Abre em nova aba

## 🚀 **Benefícios**

### **Para a Empresa:**
- ✅ **Controle de localização** dos serviços
- ✅ **Transparência** para clientes
- ✅ **Relatórios** com dados geográficos
- ✅ **Comprovação** de presença no local

### **Para os Técnicos:**
- ✅ **Registro automático** da localização
- ✅ **Interface simples** e intuitiva
- ✅ **Funciona offline** (GPS local)
- ✅ **Não obrigatório** - pode pular se necessário

### **Para os Clientes:**
- ✅ **Comprovação** de que o técnico esteve no local
- ✅ **Transparência** nos serviços
- ✅ **Histórico** de atendimentos por localização

## 🔮 **Melhorias Futuras**

### **Funcionalidades Planejadas:**
- 📍 **Mapa integrado** na interface
- 📊 **Relatórios geográficos** por região
- 🚨 **Alertas** para localizações suspeitas
- 📱 **App móvel** com GPS nativo
- 🗺️ **Heatmap** de atendimentos

### **Integrações:**
- 🗺️ **Google Maps API** para mapas interativos
- 📍 **OpenStreetMap** como alternativa
- 🚗 **Integração com rotas** de otimização
- 📊 **Dashboard** com métricas geográficas

## 🆘 **Suporte e Troubleshooting**

### **Problemas Comuns:**

#### **"Permissão negada":**
1. Clique no ícone de localização na barra de endereços
2. Selecione "Permitir" para este site
3. Recarregue a página e tente novamente

#### **"Localização indisponível":**
1. Verifique se o GPS está ativado
2. Teste em local aberto (não dentro de prédios)
3. Aguarde alguns segundos para o GPS se conectar

#### **"Timeout":**
1. Verifique a conexão com internet
2. Tente em local com melhor sinal
3. Aguarde e tente novamente

### **Contato:**
- 📧 **Email:** suporte@sistema.com
- 📱 **WhatsApp:** (11) 99999-9999
- 🕒 **Horário:** Segunda a Sexta, 8h às 18h

---

**🎉 A funcionalidade de geolocalização está ativa e pronta para uso!**

*Desenvolvido com ❤️ para melhorar o controle e transparência dos serviços técnicos.*
