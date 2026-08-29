// ===== SISTEMA DE GEOLOCALIZAÇÃO =====
class GeolocationManager {
    constructor() {
        this.currentLocation = null;
        this.isLocationEnabled = false;
        this.init();
    }

    init() {
        this.checkGeolocationSupport();
        this.bindEvents();
    }

    checkGeolocationSupport() {
        if (!navigator.geolocation) {
            console.warn('Geolocalização não é suportada neste navegador');
            return false;
        }
        return true;
    }

    async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!this.checkGeolocationSupport()) {
                reject(new Error('Geolocalização não suportada'));
                return;
            }

            // Verificar se estamos em uma origem segura
            const isSecureOrigin = window.location.protocol === 'https:' ||
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

            if (!isSecureOrigin) {
                console.warn('⚠️ Origem não segura detectada (HTTP). Geolocalização não disponível.');
                reject(new Error('Geolocalização requer HTTPS ou localhost para funcionar. Use HTTPS ou acesse via localhost.'));
                return;
            }

            // Configurações otimizadas para máxima precisão
            const options = {
                enableHighAccuracy: true,    // Usar GPS quando disponível
                timeout: 30000,              // Timeout maior para permitir GPS
                maximumAge: 0                // Sempre obter nova localização para máxima precisão
            };

            console.log('🌍 Solicitando permissão de localização...');

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    console.log('✅ Localização obtida com sucesso!');

                    const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;

                    // Validar coordenadas
                    if (!this.isValidCoordinates(latitude, longitude)) {
                        reject(new Error('Coordenadas inválidas obtidas'));
                        return;
                    }

                    // Log de precisão
                    console.log(`📍 Coordenadas: Lat=${latitude}, Lng=${longitude}, Accuracy=${accuracy}m`);

                    // Verificar precisão e tentar melhorar se necessário
                    if (accuracy > 100) {
                        console.warn(`⚠️ Precisão baixa: ${accuracy}m. Tentando obter maior precisão...`);

                        // Tentar novamente com configurações mais restritivas
                        const retryOptions = {
                            enableHighAccuracy: true,
                            timeout: 45000,              // Ainda mais tempo para GPS
                            maximumAge: 0
                        };

                        navigator.geolocation.getCurrentPosition(
                            async (retryPosition) => {
                                const {
                                    latitude: retryLat,
                                    longitude: retryLng,
                                    accuracy: retryAccuracy,
                                    altitude: retryAltitude,
                                    heading: retryHeading,
                                    speed: retrySpeed
                                } = retryPosition.coords;

                                console.log(`📍 Segunda tentativa: Lat=${retryLat}, Lng=${retryLng}, Accuracy=${retryAccuracy}m`);

                                const location = {
                                    latitude: retryLat,
                                    longitude: retryLng,
                                    accuracy: retryAccuracy,
                                    altitude: retryAltitude,
                                    heading: retryHeading,
                                    speed: retrySpeed,
                                    timestamp: retryPosition.timestamp
                                };

                                // Obter endereço
                                try {
                                    console.log('🏠 Obtendo endereço...');
                                    const address = await this.reverseGeocode(retryLat, retryLng);
                                    location.address = address;
                                    console.log('✅ Endereço obtido:', address);
                                } catch (error) {
                                    console.warn('⚠️ Erro ao obter endereço:', error);
                                    location.address = '';
                                }

                                this.currentLocation = location;
                                this.isLocationEnabled = true;
                                resolve(location);
                            },
                            async (retryError) => {
                                console.warn('⚠️ Segunda tentativa falhou, usando primeira localização...');

                                const location = {
                                    latitude,
                                    longitude,
                                    accuracy,
                                    altitude,
                                    heading,
                                    speed,
                                    timestamp: position.timestamp
                                };

                                // Obter endereço
                                try {
                                    console.log('🏠 Obtendo endereço...');
                                    const address = await this.reverseGeocode(latitude, longitude);
                                    location.address = address;
                                    console.log('✅ Endereço obtido:', address);
                                } catch (error) {
                                    console.warn('⚠️ Erro ao obter endereço:', error);
                                    location.address = '';
                                }

                                this.currentLocation = location;
                                this.isLocationEnabled = true;
                                resolve(location);
                            },
                            retryOptions
                        );
                        return;
                    }

                    const location = {
                        latitude,
                        longitude,
                        accuracy,
                        altitude,
                        heading,
                        speed,
                        timestamp: position.timestamp
                    };

                    // Tentar obter endereço usando reverse geocoding
                    try {
                        console.log('🏠 Obtendo endereço...');
                        const address = await this.reverseGeocode(latitude, longitude);
                        location.address = address;
                        console.log('✅ Endereço obtido:', address);
                    } catch (error) {
                        console.warn('⚠️ Erro ao obter endereço:', error);
                        location.address = '';
                    }

                    this.currentLocation = location;
                    this.isLocationEnabled = true;
                    resolve(location);
                },
                (error) => {
                    console.error('❌ Erro ao obter localização:', error);
                    this.isLocationEnabled = false;

                    // Tratar diferentes tipos de erro
                    let errorMessage = 'Erro ao obter localização';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Permissão de localização negada. Clique no ícone de localização na barra de endereços para permitir.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Localização indisponível. Verifique se o GPS está ativado.';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Tempo limite excedido. Verifique se permitiu o acesso à localização.';
                            break;
                        default:
                            // Verificar se é erro de origem não segura
                            if (error.message.includes('Only secure origins are allowed') ||
                                error.message.includes('HTTPS ou localhost')) {
                                errorMessage = 'Geolocalização requer HTTPS ou localhost. Use HTTPS ou acesse via localhost para capturar localização.';
                            }
                            break;
                    }

                    reject(new Error(errorMessage));
                },
                options
            );
        });
    }

    isValidCoordinates(latitude, longitude) {
        // Validar se as coordenadas estão dentro de limites válidos
        return (
            latitude >= -90 && latitude <= 90 &&
            longitude >= -180 && longitude <= 180 &&
            latitude !== 0 && longitude !== 0  // Evitar coordenadas 0,0
        );
    }

    async reverseGeocode(lat, lng) {
        try {
            console.log(`🌍 Fazendo reverse geocoding para: ${lat}, ${lng}`);

            // Tentar múltiplas APIs para maior precisão
            const apis = [
                // API 1: BigDataCloud (gratuita, boa precisão)
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=pt`,
                // API 2: Nominatim (OpenStreetMap - gratuita, boa para endereços)
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=pt-BR,pt,en`
            ];

            // Tentar primeira API (BigDataCloud)
            try {
                const response = await fetch(apis[0], {
                    headers: {
                        'Accept': 'application/json',
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const address = this.formatBigDataCloudAddress(data);
                    if (address && address !== `${lat.toFixed(6)}, ${lng.toFixed(6)}`) {
                        console.log(`✅ Endereço obtido via BigDataCloud: ${address}`);
                        return address;
                    }
                }
            } catch (error) {
                console.warn('⚠️ BigDataCloud falhou:', error);
            }

            // Tentar segunda API (Nominatim)
            try {
                const response = await fetch(apis[1], {
                    headers: {
                        'User-Agent': 'TicketSystem/1.0',
                        'Accept': 'application/json',
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const address = this.formatNominatimAddress(data);
                    if (address && address !== `${lat.toFixed(6)}, ${lng.toFixed(6)}`) {
                        console.log(`✅ Endereço obtido via Nominatim: ${address}`);
                        return address;
                    }
                }
            } catch (error) {
                console.warn('⚠️ Nominatim falhou:', error);
            }

            // Fallback: coordenadas simples
            console.log('⚠️ Todas as APIs falharam, usando coordenadas');
            return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        } catch (error) {
            console.error('❌ Erro no reverse geocoding:', error);
            return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
    }

    formatBigDataCloudAddress(data) {
        if (!data || !data.localityInfo) return null;

        const parts = [];

        // Informações mais específicas primeiro
        if (data.city) parts.push(data.city);
        if (data.principalSubdivision) parts.push(data.principalSubdivision);
        if (data.countryName) parts.push(data.countryName);

        // Fallback para estrutura administrativa
        if (parts.length === 0 && data.localityInfo.administrative) {
            const admin = data.localityInfo.administrative;
            if (admin[1]) parts.push(admin[1].name); // Cidade
            if (admin[2]) parts.push(admin[2].name); // Estado
            if (admin[3]) parts.push(admin[3].name); // País
        }

        return parts.length > 0 ? parts.join(', ') : null;
    }

    formatNominatimAddress(data) {
        if (!data || !data.address) return null;

        const addr = data.address;
        const parts = [];

        // Construir endereço hierárquico
        if (addr.house_number && addr.road) {
            parts.push(`${addr.road}, ${addr.house_number}`);
        } else if (addr.road) {
            parts.push(addr.road);
        }

        if (addr.suburb) parts.push(addr.suburb);
        if (addr.city || addr.town || addr.village) {
            parts.push(addr.city || addr.town || addr.village);
        }
        if (addr.state) parts.push(addr.state);
        if (addr.country) parts.push(addr.country);

        return parts.length > 0 ? parts.join(', ') : null;
    }

    addLocationToForm(formElement) {
        if (!this.currentLocation) {
            console.warn('Nenhuma localização disponível');
            return;
        }

        // Adicionar campos hidden com os dados de localização
        const fields = [
            { name: 'latitude', value: this.currentLocation.latitude },
            { name: 'longitude', value: this.currentLocation.longitude },
            { name: 'address', value: this.currentLocation.address || '' },
            { name: 'accuracy', value: this.currentLocation.accuracy }
        ];

        fields.forEach(field => {
            let input = formElement.querySelector(`input[name="${field.name}"]`);
            if (!input) {
                input = document.createElement('input');
                input.type = 'hidden';
                input.name = field.name;
                formElement.appendChild(input);
            }
            input.value = field.value;
        });
    }

    showLocationStatus(element) {
        if (!element) return;

        if (this.isLocationEnabled && this.currentLocation) {
            element.innerHTML = `
                <i class="fas fa-map-marker-alt text-success"></i>
                <span class="text-success">Localização capturada</span>
                <small class="text-muted d-block">${this.currentLocation.address || 'Coordenadas obtidas'}</small>
            `;
        } else {
            element.innerHTML = `
                <i class="fas fa-map-marker-alt text-warning"></i>
                <span class="text-warning">Localização não disponível</span>
            `;
        }
    }

    bindEvents() {
        // Adicionar eventos para botões de captura de localização
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-capture-location]')) {
                e.preventDefault();
                this.captureLocationForElement(e.target);
            }
        });
    }

    async captureLocationForElement(button) {
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obtendo localização...';
        button.disabled = true;

        try {
            await this.getCurrentLocation();

            // Encontrar o formulário relacionado
            const form = button.closest('form');
            if (form) {
                this.addLocationToForm(form);
            }

            // Mostrar status de sucesso
            button.innerHTML = '<i class="fas fa-check text-success"></i> Localização capturada';
            button.classList.add('btn-success');
            button.classList.remove('btn-primary');

            // Mostrar informações da localização
            const statusElement = document.querySelector('[data-location-status]');
            if (statusElement) {
                this.showLocationStatus(statusElement);
            }

        } catch (error) {
            console.error('Erro ao capturar localização:', error);

            // Mostrar mensagem de erro específica
            let errorIcon = 'fas fa-exclamation-triangle';
            let errorText = 'Erro na localização';

            if (error.message.includes('Permissão')) {
                errorIcon = 'fas fa-ban';
                errorText = 'Permissão negada';
            } else if (error.message.includes('indisponível')) {
                errorIcon = 'fas fa-map-marker-slash';
                errorText = 'GPS indisponível';
            } else if (error.message.includes('Tempo limite')) {
                errorIcon = 'fas fa-clock';
                errorText = 'Timeout';
            }

            button.innerHTML = `<i class="${errorIcon} text-warning"></i> ${errorText}`;
            button.classList.add('btn-warning');
            button.classList.remove('btn-primary');

            // Mostrar tooltip com mensagem completa
            button.title = error.message;
        } finally {
            setTimeout(() => {
                button.innerHTML = originalText;
                button.disabled = false;
                button.classList.remove('btn-success', 'btn-warning');
                button.classList.add('btn-primary');
            }, 3000);
        }
    }
}

// ===== SISTEMA DE TEMAS =====
class ThemeManager {
    constructor() {
        this.currentTheme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    init() {
        this.applyTheme(this.currentTheme);
        this.bindEvents();
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        localStorage.setItem('theme', theme);

        // Atualizar ícones dos toggles
        this.updateToggleIcons();
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
    }

    updateToggleIcons() {
        const toggles = document.querySelectorAll('.theme-toggle');
        toggles.forEach(toggle => {
            const sun = toggle.querySelector('.sun');
            const moon = toggle.querySelector('.moon');

            if (this.currentTheme === 'dark') {
                sun.style.opacity = '0';
                moon.style.opacity = '1';
            } else {
                sun.style.opacity = '1';
                moon.style.opacity = '0';
            }
        });
    }

    bindEvents() {
        const toggles = document.querySelectorAll('.theme-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', () => this.toggleTheme());
        });
    }
}

// ===== GERENCIADOR DO MENU LATERAL =====
class SidebarManager {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.sidebarToggle = document.getElementById('sidebar-toggle');
        this.isOpen = false;
        this.init();
    }

    init() {
        this.bindEvents();
        this.handleResize();
    }

    bindEvents() {
        if (this.sidebarToggle) {
            this.sidebarToggle.addEventListener('click', () => this.toggle());
        }

        // Fechar sidebar ao clicar fora em mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && this.isOpen) {
                if (!this.sidebar.contains(e.target) && !this.sidebarToggle.contains(e.target)) {
                    this.close();
                }
            }
        });

        // Fechar sidebar ao redimensionar para desktop
        window.addEventListener('resize', () => this.handleResize());
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.sidebar.classList.add('active');
        this.isOpen = true;
    }

    close() {
        this.sidebar.classList.remove('active');
        this.isOpen = false;
    }

    handleResize() {
        if (window.innerWidth > 768) {
            this.close();
            if (this.sidebarToggle) {
                this.sidebarToggle.style.display = 'none';
            }
        } else {
            if (this.sidebarToggle) {
                this.sidebarToggle.style.display = 'block';
            }
        }
    }
}

// ===== GERENCIADOR DE MODAIS =====
class ModalManager {
    constructor() {
        this.modals = new Map();
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // Fechar modal ao clicar no overlay
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.close(e.target);
            }
        });

        // Fechar modal ao clicar no botão de fechar
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-close')) {
                const modal = e.target.closest('.modal-overlay');
                this.close(modal);
            }
        });

        // Fechar modal com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal-overlay.active');
                if (openModal) {
                    this.close(openModal);
                }
            }
        });
    }

    open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    close(modal) {
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
}

// ===== GERENCIADOR DE ALERTAS =====
class AlertManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        this.createContainer();
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'alert-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 3000;
            max-width: 400px;
        `;
        document.body.appendChild(this.container);
    }

    show(message, type = 'info', duration = 5000) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} fade-in`;
        alert.style.cssText = `
            margin-bottom: 10px;
            animation: slideInRight 0.3s ease;
        `;

        const icon = this.getIcon(type);
        alert.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="${icon}"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="margin-left: auto; background: none; border: none; color: inherit; cursor: pointer;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        this.container.appendChild(alert);

        // Auto remove
        if (duration > 0) {
            setTimeout(() => {
                if (alert.parentElement) {
                    alert.remove();
                }
            }, duration);
        }

        return alert;
    }

    getIcon(type) {
        const icons = {
            success: 'fas fa-check-circle',
            warning: 'fas fa-exclamation-triangle',
            error: 'fas fa-times-circle',
            info: 'fas fa-info-circle'
        };
        return icons[type] || icons.info;
    }

    success(message, duration = 5000) {
        return this.show(message, 'success', duration);
    }

    warning(message, duration = 5000) {
        return this.show(message, 'warning', duration);
    }

    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    info(message, duration = 5000) {
        return this.show(message, 'info', duration);
    }
}

// ===== UTILITÁRIOS =====
class Utils {
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    static throttle(func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    static formatCurrency(value) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    static formatDate(date) {
        return new Intl.DateTimeFormat('pt-BR').format(new Date(date));
    }

    static formatDateTime(date) {
        return new Intl.DateTimeFormat('pt-BR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    }
}

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', function () {
    // Inicializar gerenciadores
    window.themeManager = new ThemeManager();
    window.sidebarManager = new SidebarManager();
    window.modalManager = new ModalManager();
    window.alertManager = new AlertManager();

    // Funções globais para compatibilidade com scripts inline do dashboard
    window.openModal = (modalId) => window.modalManager.open(modalId);
    window.closeModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) window.modalManager.close(modal);
    };

    // Adicionar animações CSS
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    // Adicionar funcionalidades específicas do sistema
    initializeSystemFeatures();
});

// ===== FUNCIONALIDADES ESPECÍFICAS DO SISTEMA =====
function initializeSystemFeatures() {
    // Auto-focus em campos de busca
    const searchInputs = document.querySelectorAll('input[type="search"], input[placeholder*="buscar"], input[placeholder*="pesquisar"]');
    searchInputs.forEach(input => {
        input.addEventListener('focus', function () {
            this.select();
        });
    });

    // Confirmação para ações destrutivas
    const destructiveButtons = document.querySelectorAll('button[class*="error"], button[class*="danger"], a[class*="error"], a[class*="danger"]');
    destructiveButtons.forEach(button => {
        if (button.textContent.toLowerCase().includes('excluir') ||
            button.textContent.toLowerCase().includes('deletar') ||
            button.textContent.toLowerCase().includes('remover')) {
            button.addEventListener('click', function (e) {
                if (!confirm('Tem certeza que deseja realizar esta ação?')) {
                    e.preventDefault();
                }
            });
        }
    });

    // Melhorar UX de formulários
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function () {
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';

                // Reabilitar após 5 segundos (fallback)
                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = submitBtn.getAttribute('data-original-text') || 'Salvar';
                }, 5000);
            }
        });
    });

    // Salvar texto original dos botões
    const submitButtons = document.querySelectorAll('button[type="submit"], input[type="submit"]');
    submitButtons.forEach(btn => {
        btn.setAttribute('data-original-text', btn.innerHTML);
    });
}

// ===== FUNÇÕES GLOBAIS =====
window.openModal = function (modalId) {
    window.modalManager.open(modalId);
};

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    window.modalManager.close(modal);
};

window.showAlert = function (message, type = 'info', duration = 5000) {
    return window.alertManager.show(message, type, duration);
};

window.showSuccess = function (message, duration = 5000) {
    return window.alertManager.success(message, duration);
};

window.showError = function (message, duration = 5000) {
    return window.alertManager.error(message, duration);
};

window.showWarning = function (message, duration = 5000) {
    return window.alertManager.warning(message, duration);
};

// ===== COMPATIBILIDADE COM CÓDIGO EXISTENTE =====
// Manter compatibilidade com funções existentes
if (typeof showAlert === 'undefined') {
    window.showAlert = window.showAlert;
}

// Adicionar suporte para modais existentes
document.addEventListener('click', function (e) {
    // Botões que abrem modais
    if (e.target.matches('[data-modal]')) {
        const modalId = e.target.getAttribute('data-modal');
        window.openModal(modalId);
    }

    // Botões que fecham modais
    if (e.target.matches('[data-close-modal]')) {
        const modalId = e.target.getAttribute('data-close-modal');
        window.closeModal(modalId);
    }
});

// ===== SISTEMA DE MONITORAMENTO DE LOCALIZAÇÃO =====
class LocationTrackingManager {
    constructor() {
        this.isTracking = false;
        this.trackingInterval = null;
        this.userId = null;
        this.socket = null;
        this.isPageVisible = true;
        this.lastLocation = null;
        this.init();
    }

    init() {
        // Detectar se a página está visível
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
            console.log('📱 Página visível:', this.isPageVisible);
        });

        // Verificar se deve iniciar tracking automaticamente
        const userId = document.body.getAttribute('data-user-id');
        const userRole = document.body.getAttribute('data-user-role');

        console.log('🛰️ LocationTrackingManager inicializado');
        console.log('👤 User ID:', userId);
        console.log('👤 User Role:', userRole);

        if (userId && userRole && (userRole === 'tecnico' || userRole === 'admin')) {
            console.log('✅ Usuário autorizado para tracking automático');
            // Iniciar tracking automaticamente
            this.startTracking(parseInt(userId));
        } else {
            console.log('❌ Usuário não autorizado para tracking automático');
        }

        // Conectar ao WebSocket
        this.connectWebSocket();
    }

    connectWebSocket() {
        try {
            // Criar nova conexão WebSocket para tracking
            if (typeof io !== 'undefined') {
                const userId = document.body.getAttribute('data-user-id');
                if (userId) {
                    console.log(`🔌 Conectando WebSocket para tracking do usuário ${userId}`);
                    this.socket = io({
                        query: {
                            user_id: userId
                        }
                    });

                    // Aguardar conexão antes de configurar eventos
                    this.socket.on('connect', () => {
                        console.log('✅ WebSocket conectado para tracking');
                        this.setupSocketEvents();

                        // Iniciar tracking automaticamente se o usuário for técnico/admin
                        const userRole = document.body.getAttribute('data-user-role');
                        if (userRole && (userRole === 'tecnico' || userRole === 'admin')) {
                            console.log(`🚀 Iniciando tracking automático para usuário ${userId} (${userRole})`);
                            this.startTracking(parseInt(userId));
                        }
                    });

                    this.socket.on('connect_error', (error) => {
                        console.error('❌ Erro ao conectar WebSocket:', error);
                    });
                } else {
                    console.warn('⚠️ user_id não encontrado para conectar WebSocket');
                }
            } else {
                console.warn('⚠️ Socket.IO não disponível para tracking');
            }
        } catch (error) {
            console.error('❌ Erro ao conectar WebSocket:', error);
        }
    }

    setupSocketEvents() {
        if (!this.socket) return;

        // Eventos do sistema de monitoramento
        this.socket.on('request_location_update', (data) => {
            console.log('📍 Solicitação de atualização de localização:', data);
            this.updateLocation();
        });

        this.socket.on('tracking_started', (data) => {
            console.log('✅ Tracking iniciado:', data);
            this.isTracking = true;
        });

        this.socket.on('tracking_stopped', (data) => {
            console.log('🛑 Tracking parado:', data);
            this.stopTracking();
        });

        this.socket.on('location_updated', (data) => {
            console.log('✅ Localização atualizada:', data);
        });

        this.socket.on('error', (data) => {
            console.error('❌ Erro no tracking:', data);
        });
    }

    startTracking(userId) {
        console.log(`🚀 Iniciando tracking para usuário ${userId}...`);

        if (this.isTracking) {
            console.log('⚠️ Tracking já está ativo');
            return;
        }

        this.userId = userId;
        this.isTracking = true;

        console.log('✅ Status de tracking definido como ativo');

        // Solicitar permissão de localização
        this.requestLocationPermission().then(() => {
            console.log('✅ Permissão de localização concedida');

            // Iniciar tracking via WebSocket
            if (this.socket) {
                console.log('📡 Enviando evento start_location_tracking...');
                this.socket.emit('start_location_tracking', {
                    user_id: userId
                });
            } else {
                console.warn('⚠️ WebSocket não disponível para enviar evento');
            }

            // Iniciar tracking em background
            this.startBackgroundTracking();

            console.log('🟢 Tracking iniciado com sucesso para usuário:', userId);
        }).catch((error) => {
            console.error('❌ Erro ao iniciar tracking:', error);

            // Se for erro de permissão, não parar completamente o tracking
            if (error.code === 1) {
                console.log('⚠️ Tracking pausado devido a permissão negada');
                console.log('💡 O tracking será retomado automaticamente quando a permissão for concedida');
                this.isTracking = false;

                // Tentar novamente após 30 segundos
                setTimeout(() => {
                    if (!this.isTracking && this.userId) {
                        console.log('🔄 Tentando reconectar tracking...');
                        this.startTracking(this.userId);
                    }
                }, 30000);
            } else {
                console.log('❌ Erro não relacionado a permissão, parando tracking');
                this.isTracking = false;
            }
        });
    }

    stopTracking() {
        if (!this.isTracking) return;

        this.isTracking = false;

        // Parar tracking em background
        if (this.trackingInterval) {
            clearInterval(this.trackingInterval);
            this.trackingInterval = null;
        }

        // Parar tracking via WebSocket
        if (this.socket && this.userId) {
            this.socket.emit('stop_location_tracking', {
                user_id: this.userId
            });
        }

        console.log('🔴 Tracking parado');
    }

    startBackgroundTracking() {
        console.log('⏰ Iniciando background tracking...');

        // Atualizar localização imediatamente
        console.log('📍 Primeira atualização de localização...');
        this.updateLocation();

        // Configurar intervalo de 30 segundos
        this.trackingInterval = setInterval(() => {
            if (this.isTracking) {
                console.log('⏰ Atualização automática de localização (30s)...');
                this.updateLocation();
            } else {
                console.log('⚠️ Tracking não está ativo, pulando atualização');
            }
        }, 30000); // 30 segundos

        console.log('✅ Background tracking iniciado (intervalo: 30s)');
    }

    async updateLocation() {
        if (!this.isTracking || !this.userId) {
            console.log('⚠️ Tracking não ativo ou userId não definido:', {
                isTracking: this.isTracking,
                userId: this.userId
            });
            return;
        }

        try {
            console.log(`📍 Atualizando localização para usuário ${this.userId}...`);

            // Obter localização atual
            const location = await window.geolocationManager.getCurrentLocation();
            console.log(`📍 Localização obtida: Lat=${location.latitude}, Lng=${location.longitude}, Acc=${location.accuracy}m`);

            // Verificar se a localização mudou significativamente
            if (this.hasLocationChanged(location)) {
                this.lastLocation = location;

                // Enviar via WebSocket
                if (this.socket) {
                    console.log(`📡 Enviando localização via WebSocket para usuário ${this.userId}:`, {
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address
                    });

                    this.socket.emit('location_update', {
                        user_id: this.userId,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        address: location.address,
                        accuracy: location.accuracy
                    });
                } else {
                    console.error('❌ WebSocket não disponível para envio de localização');
                }

                console.log('✅ Localização enviada com sucesso');
            } else {
                console.log('📍 Localização não mudou significativamente (distância < 50m)');
            }

        } catch (error) {
            console.error('❌ Erro ao atualizar localização:', error);

            // Se for erro de permissão, parar tracking
            if (error.message.includes('Permissão') || error.message.includes('denied')) {
                console.log('🛑 Parando tracking devido a erro de permissão');
                this.stopTracking();
            }
        }
    }

    hasLocationChanged(newLocation) {
        if (!this.lastLocation) return true;

        // Calcular distância entre localizações
        const distance = this.calculateDistance(
            this.lastLocation.latitude, this.lastLocation.longitude,
            newLocation.latitude, newLocation.longitude
        );

        // Verificar se a precisão melhorou significativamente
        const accuracyImproved = newLocation.accuracy < this.lastLocation.accuracy * 0.7;

        // Verificar tempo desde última atualização
        const timeDiff = new Date().getTime() - new Date(this.lastLocation.timestamp).getTime();
        const timeThreshold = 30 * 1000; // 30 segundos (conforme solicitado)

        // Considerar mudança se:
        // 1. Distância > 1 metro (quase sempre para garantir atualização)
        // 2. Precisão melhorou significativamente
        // 3. O tempo solicitado passou (30 segundos)
        return distance > 1 || accuracyImproved || timeDiff >= timeThreshold;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Raio da Terra em metros
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distância em metros
    }

    async requestLocationPermission() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocalização não suportada'));
                return;
            }

            // Verificar se estamos em uma origem segura
            const isSecureOrigin = window.location.protocol === 'https:' ||
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

            if (!isSecureOrigin) {
                console.warn('⚠️ Origem não segura detectada (HTTP). Geolocalização não disponível.');
                reject(new Error('Geolocalização requer HTTPS ou localhost para funcionar. Use HTTPS ou acesse via localhost.'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('✅ Permissão de localização concedida');
                    resolve(position);
                },
                (error) => {
                    console.error('❌ Permissão de localização negada:', error);

                    // Mostrar instruções detalhadas para o usuário
                    if (error.code === 1) {
                        console.error('🚨 PERMISSÃO NEGADA: O usuário negou o acesso à localização');
                        console.error('💡 SOLUÇÃO:');
                        console.error('   1. Clique no ícone de localização na barra de endereços');
                        console.error('   2. Selecione "Permitir" para este site');
                        console.error('   3. Ou vá em Configurações > Privacidade > Localização');
                        console.error('   4. Recarregue a página após permitir');

                        // Mostrar alerta visual para o usuário
                        setTimeout(() => {
                            alert('📍 PERMISSÃO DE LOCALIZAÇÃO NEGADA\n\n' +
                                'Para usar o sistema de monitoramento:\n\n' +
                                '1. Clique no ícone de localização na barra de endereços\n' +
                                '2. Selecione "Permitir" para este site\n' +
                                '3. Recarregue a página\n\n' +
                                'Ou vá em Configurações > Privacidade > Localização');
                        }, 1000);
                    }

                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }

    getTrackingStatus() {
        return {
            isTracking: this.isTracking,
            userId: this.userId,
            isPageVisible: this.isPageVisible,
            lastLocation: this.lastLocation
        };
    }
}

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', function () {
    console.log('=== INICIALIZANDO SISTEMA ===');

    // Inicializar gerenciadores
    try {
        window.themeManager = new ThemeManager();
        console.log('✅ ThemeManager inicializado');
    } catch (error) {
        console.error('❌ Erro ao inicializar ThemeManager:', error);
    }

    try {
        window.geolocationManager = new GeolocationManager();
        console.log('✅ GeolocationManager inicializado');
    } catch (error) {
        console.error('❌ Erro ao inicializar GeolocationManager:', error);
    }

    try {
        window.locationTrackingManager = new LocationTrackingManager();
        console.log('✅ LocationTrackingManager inicializado');
    } catch (error) {
        console.error('❌ Erro ao inicializar LocationTrackingManager:', error);
    }

    console.log('=== SISTEMA INICIALIZADO COM SUCESSO ===');
});

// =====================================================================
// COMPONENTES REUTILIZÁVEIS — Barra de filtros (dc-filter-bar)
// =====================================================================
// Inicializa automaticamente qualquer barra de filtros criada com a
// macro `filter_bar` (templates/macros/ui.html): toggle de expandir/
// recolher, contagem de filtros ativos e seleção de pílulas de status.
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-dc-filter-bar]').forEach(function (bar) {
        const toggle = bar.querySelector('[data-dc-filter-toggle]');
        const countEl = bar.querySelector('[data-dc-filter-count]');
        const form = bar.querySelector('[data-dc-filter-form]');

        function countActiveFilters() {
            if (!form) return 0;
            let count = 0;
            form.querySelectorAll('[data-dc-filter-field]').forEach(function (field) {
                if (field.type === 'checkbox') {
                    if (field.checked) count++;
                } else if (field.value && String(field.value).trim() !== '') {
                    count++;
                }
            });
            return count;
        }

        function updateCount() {
            if (!countEl) return;
            const n = countActiveFilters();
            countEl.textContent = n > 0 ? n : '';
        }

        if (toggle) {
            toggle.addEventListener('click', function () {
                bar.classList.toggle('expanded');
            });
        }

        if (form) {
            form.querySelectorAll('[data-dc-filter-field]').forEach(function (field) {
                field.addEventListener('change', updateCount);
                field.addEventListener('input', updateCount);
            });
        }

        // Pílulas de status: atualizam o input escondido e o estado visual
        bar.querySelectorAll('[data-dc-status-value]').forEach(function (pill) {
            pill.addEventListener('click', function () {
                const row = pill.closest('.dc-filter-bar__row') || bar;
                const hiddenInput = row.querySelector('[data-dc-status-input]');
                row.querySelectorAll('[data-dc-status-value]').forEach(function (p) {
                    p.classList.remove('active');
                });
                pill.classList.add('active');
                if (hiddenInput) {
                    hiddenInput.value = pill.getAttribute('data-dc-status-value');
                }
                updateCount();
            });
        });

        // Se a barra já expandir automaticamente (data-dc-expanded="1"),
        // ou se houver filtros ativos vindos da URL, expandir de início.
        if (bar.getAttribute('data-dc-expanded') === '1') {
            bar.classList.add('expanded');
        }

        updateCount();
    });
});