"""
Sistema de WebSocket para monitoramento de localização dos técnicos em tempo real
"""

import json
import asyncio
from datetime import datetime, timedelta
from flask import current_app, request
from flask_socketio import emit, join_room, leave_room
from app import socketio, db
from app.models import TechnicianLocation, User
from app.timezone_utils import brasilia_to_utc, get_brasilia_now


class LocationMonitoringManager:
    """Gerenciador de monitoramento de localização"""
    
    def __init__(self):
        self.active_connections = {}  # {user_id: session_id}
        self.tracking_tasks = {}      # {user_id: task}
        self.is_running = False
    
    def start_tracking(self, user_id, session_id):
        """Inicia o tracking de localização para um técnico"""
        if user_id in self.active_connections:
            # Técnico já está sendo rastreado, apenas atualizar session_id
            self.active_connections[user_id] = session_id
            print(f"🔄 Session ID atualizado para técnico {user_id}")
            return True
        
        self.active_connections[user_id] = session_id
        
        # Verificar se já existe registro no banco
        location = TechnicianLocation.query.filter_by(user_id=user_id).first()
        if location:
            # Atualizar status existente apenas se já tem localização real
            if location.latitude != 0.0 or location.longitude != 0.0:
                location.is_online = True
                location.is_tracking = True
                location.last_seen = brasilia_to_utc(get_brasilia_now())
                db.session.commit()
                print(f"🔄 Status atualizado para técnico {user_id}")
            else:
                print(f"⚠️ Técnico {user_id} tem registro vazio, aguardando primeira localização")
        else:
            print(f"ℹ️ Técnico {user_id} não tem registro, aguardando primeira localização")
        
        # Criar tarefa de tracking em background
        task = asyncio.create_task(self._track_technician_location(user_id))
        self.tracking_tasks[user_id] = task
        
        print(f"🟢 Tracking iniciado para técnico {user_id}")
        return True
    
    def stop_tracking(self, user_id):
        """Para o tracking de localização para um técnico"""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        
        if user_id in self.tracking_tasks:
            task = self.tracking_tasks[user_id]
            task.cancel()
            del self.tracking_tasks[user_id]
        
        # Marcar como offline no banco
        location = TechnicianLocation.query.filter_by(user_id=user_id).first()
        if location:
            location.is_online = False
            location.last_seen = brasilia_to_utc(get_brasilia_now())
            db.session.commit()
        
        print(f"🔴 Tracking parado para técnico {user_id}")
    
    async def _track_technician_location(self, user_id):
        """Loop de tracking de localização em background"""
        try:
            while user_id in self.active_connections:
                # Solicitar localização via WebSocket
                await self._request_location_update(user_id)
                
                # Aguardar 30 segundos
                await asyncio.sleep(30)
                
        except asyncio.CancelledError:
            print(f"🛑 Tracking cancelado para técnico {user_id}")
        except Exception as e:
            print(f"❌ Erro no tracking do técnico {user_id}: {e}")
            self.stop_tracking(user_id)
    
    async def _request_location_update(self, user_id):
        """Solicita atualização de localização via WebSocket"""
        try:
            session_id = self.active_connections.get(user_id)
            if session_id:
                # Enviar solicitação de localização
                socketio.emit('request_location_update', {
                    'timestamp': datetime.now().isoformat(),
                    'message': 'Atualize sua localização'
                }, room=session_id)
                
        except Exception as e:
            print(f"❌ Erro ao solicitar localização do técnico {user_id}: {e}")
    
    def update_technician_location(self, user_id, latitude, longitude, address=None, accuracy=None):
        """Atualiza a localização de um técnico"""
        try:
            print(f"🔄 LocationMonitoringManager.update_technician_location chamado:")
            print(f"   User ID: {user_id}")
            print(f"   Latitude: {latitude}")
            print(f"   Longitude: {longitude}")
            print(f"   Address: {address}")
            print(f"   Accuracy: {accuracy}")
            
            # Atualizar no banco de dados
            location = TechnicianLocation.update_technician_location(
                user_id, latitude, longitude, address, accuracy
            )
            
            if location:
                print(f"✅ Location retornada do banco: {location.to_dict()}")
                
                # Enviar atualização para todos os monitores conectados
                self._broadcast_location_update(location)
                
                print(f"📍 Localização atualizada para técnico {user_id}: {latitude}, {longitude}")
                return True
            else:
                print(f"❌ Location retornou None para usuário {user_id}")
                return False
            
        except Exception as e:
            print(f"❌ Erro ao atualizar localização do técnico {user_id}: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _broadcast_location_update(self, location):
        """Transmite atualização de localização para todos os monitores"""
        try:
            # Enviar para todos os monitores conectados
            socketio.emit('technician_location_update', location.to_dict(), room='monitors')
            
            # Enviar lista atualizada de técnicos
            active_technicians = self.get_active_technicians()
            socketio.emit('active_technicians', {
                'technicians': [tech.to_dict() for tech in active_technicians]
            }, room='monitors')
            
        except Exception as e:
            print(f"❌ Erro ao transmitir atualização de localização: {e}")
    
    def get_active_technicians(self):
        """Retorna lista de técnicos ativos"""
        return TechnicianLocation.get_all_technicians_with_last_location()
    
    def cleanup_offline_technicians(self):
        """Remove técnicos que estão offline (Desativado)"""
        pass


# Instância global do gerenciador
location_manager = LocationMonitoringManager()


# Eventos WebSocket
@socketio.on('connect')
def handle_connect():
    """Cliente conectou ao WebSocket.

    Aceita conexões gerais (Help Desk, Co-op de orçamentos) via sessão Flask-Login.
    Só ativa GPS/tracking quando vem user_id de admin/técnico na query.
    """
    from flask_login import current_user

    print(f"🔌 Cliente conectado: {request.sid}")
    print(f"🔍 Query args: {request.args}")

    # Sala de notificações do agente (Help Desk) — independente do GPS
    if current_user.is_authenticated:
        agent_room = f"agent_{current_user.id}"
        join_room(agent_room)
        print(f"👤 Agente {current_user.name} (ID: {current_user.id}) na sala {agent_room}")

    user_id = request.args.get('user_id')
    print(f"🔍 User ID recebido: {user_id}")

    if user_id:
        try:
            user_id = int(user_id)
            user = User.query.get(user_id)
            print(f"🔍 Usuário encontrado: {user}")

            if user and user.role in ['admin', 'tecnico']:
                # NÃO chamar start_tracking aqui: asyncio.create_task quebra no
                # async_mode=threading e derruba a conexão do Help Desk / Co-op.
                # O LocationTrackingManager do cliente inicia o GPS sob demanda.
                location_manager.active_connections[user_id] = request.sid
                print(f"✅ Usuário {user.name} ({user_id}) conectado (GPS sob demanda). SID: {request.sid}")
            else:
                print(f"⚠️ user_id {user_id} sem role de tracking — conexão permitida sem GPS")
        except (ValueError, TypeError) as e:
            print(f"⚠️ user_id inválido ({user_id}): {e} — conexão permitida sem GPS")

    # Sempre aceitar a conexão (helpdesk, orçamentos, monitoramento)
    emit('connected', {'message': 'Conectado ao servidor'})

@socketio.on('disconnect')
def handle_disconnect():
    """Cliente desconectou do WebSocket"""
    print(f"🔌 Cliente desconectado: {request.sid}")

    # Parar tracking se era um técnico
    for user_id, session_id in list(location_manager.active_connections.items()):
        if session_id == request.sid:
            location_manager.stop_tracking(user_id)
            break

    # Limpar presença Co-op de orçamentos
    try:
        from app.blueprints.budget_socketio import cleanup_presence_for_sid
        cleanup_presence_for_sid(request.sid)
    except Exception as exc:
        print(f"⚠️ Falha ao limpar presença de orçamento: {exc}")


@socketio.on('start_location_tracking')
def handle_start_tracking(data):
    """Inicia o tracking de localização para um técnico"""
    try:
        user_id = data.get('user_id')
        if not user_id:
            emit('error', {'message': 'user_id é obrigatório'})
            return
        
        # Verificar se o usuário tem permissão
        user = User.query.get(user_id)
        if not user or user.role not in ['admin', 'tecnico']:
            emit('error', {'message': 'Usuário não autorizado para tracking'})
            return
        
        # Iniciar tracking
        success = location_manager.start_tracking(user_id, request.sid)
        
        if success:
            emit('tracking_started', {
                'message': 'Tracking de localização iniciado',
                'user_id': user_id
            })
        else:
            emit('error', {'message': 'Tracking já está ativo para este usuário'})
            
    except Exception as e:
        print(f"❌ Erro ao iniciar tracking: {e}")
        emit('error', {'message': 'Erro interno do servidor'})


@socketio.on('stop_location_tracking')
def handle_stop_tracking(data):
    """Para o tracking de localização para um técnico"""
    try:
        user_id = data.get('user_id')
        if not user_id:
            emit('error', {'message': 'user_id é obrigatório'})
            return
        
        location_manager.stop_tracking(user_id)
        
        emit('tracking_stopped', {
            'message': 'Tracking de localização parado',
            'user_id': user_id
        })
        
    except Exception as e:
        print(f"❌ Erro ao parar tracking: {e}")
        emit('error', {'message': 'Erro interno do servidor'})


@socketio.on('location_update')
def handle_location_update(data):
    """Recebe atualização de localização de um técnico"""
    try:
        print(f"📡 Recebido location_update: {data}")
        
        user_id = data.get('user_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        address = data.get('address')
        accuracy = data.get('accuracy')
        
        print(f"📍 Dados processados - User: {user_id}, Lat: {latitude}, Lng: {longitude}, Address: {address}")
        
        if not all([user_id, latitude, longitude]):
            print(f"❌ Dados incompletos - User: {user_id}, Lat: {latitude}, Lng: {longitude}")
            emit('error', {'message': 'Dados de localização incompletos'})
            return
        
        # Atualizar localização
        print(f"🔄 Atualizando localização no banco para usuário {user_id}...")
        success = location_manager.update_technician_location(
            user_id, latitude, longitude, address, accuracy
        )
        
        if success:
            print(f"✅ Localização atualizada com sucesso para usuário {user_id}")
            emit('location_updated', {
                'message': 'Localização atualizada com sucesso',
                'user_id': user_id
            })
        else:
            print(f"❌ Falha ao atualizar localização para usuário {user_id}")
            emit('error', {'message': 'Erro ao atualizar localização'})
            
    except Exception as e:
        print(f"❌ Erro ao atualizar localização: {e}")
        import traceback
        traceback.print_exc()
        emit('error', {'message': 'Erro interno do servidor'})


@socketio.on('join_monitoring_room')
def handle_join_monitoring():
    """Cliente entra na sala de monitoramento"""
    try:
        join_room('monitors')
        
        # Enviar lista de técnicos com última localização
        technicians = location_manager.get_active_technicians()
        emit('active_technicians', {
            'technicians': [tech.to_dict() for tech in technicians]
        })
        
        print(f"👁️ Cliente {request.sid} entrou na sala de monitoramento")
        
    except Exception as e:
        print(f"❌ Erro ao entrar na sala de monitoramento: {e}")
        emit('error', {'message': 'Erro interno do servidor'})


@socketio.on('leave_monitoring_room')
def handle_leave_monitoring():
    """Cliente sai da sala de monitoramento"""
    try:
        leave_room('monitors')
        print(f"👁️ Cliente {request.sid} saiu da sala de monitoramento")
        
    except Exception as e:
        print(f"❌ Erro ao sair da sala de monitoramento: {e}")


# Tarefa de limpeza em background
@socketio.on('cleanup_offline_technicians')
def handle_cleanup():
    """Limpa técnicos offline"""
    location_manager.cleanup_offline_technicians()


# Função para inicializar o sistema
def init_location_monitoring():
    """Inicializa o sistema de monitoramento"""
    print("🚀 Sistema de monitoramento de localização inicializado")
    print("✅ Sistema de monitoramento configurado com sucesso")
