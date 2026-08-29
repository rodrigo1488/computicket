"""
Blueprint para monitoramento de localização dos técnicos
"""

from flask import Blueprint, render_template, request, jsonify, current_app
from flask_login import login_required, current_user
from app.models import TechnicianLocation, User
from app.timezone_utils import get_brasilia_now, brasilia_to_utc

bp = Blueprint('monitoring', __name__, url_prefix='/monitoring')


def _can_monitor(user) -> bool:
    """Admin (incl. administrador) e técnico podem ver o monitoramento."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if hasattr(user, "has_role"):
        return user.has_role("admin") or user.has_role("tecnico")
    role = (getattr(user, "role", "") or "").strip().lower()
    if role in {"administrador", "administrator"}:
        role = "admin"
    return role in {"admin", "tecnico"}


@bp.route('/')
@login_required
def index():
    """Página principal de monitoramento"""
    if not _can_monitor(current_user):
        return render_template('errors/403.html'), 403
    
    # Obter técnicos ativos
    active_technicians = TechnicianLocation.get_active_technicians()
    
    return render_template('monitoring/index.html', 
                         active_technicians=active_technicians,
                         current_user=current_user)


@bp.route('/api/technicians')
@login_required
def get_technicians():
    """API para obter lista de técnicos com última localização"""
    if not _can_monitor(current_user):
        return jsonify({'error': 'Acesso negado'}), 403
    
    try:
        technicians = TechnicianLocation.get_all_technicians_with_last_location()
        active_ids = {row[0] for row in User.query.with_entities(User.id).filter(User.status == "1")}
        payload = [tech.to_dict() for tech in technicians if tech.user_id in active_ids]
        return jsonify({
            'technicians': payload,
            'timestamp': get_brasilia_now().isoformat()
        })
    except Exception as e:
        current_app.logger.error(f"Erro ao obter técnicos: {e}")
        return jsonify({'error': 'Erro interno do servidor', 'technicians': []}), 500


@bp.route('/api/technicians-location')
@login_required
def get_technicians_location():
    """API para obter a localização de todos os técnicos ativos"""
    try:
        locations = TechnicianLocation.query.all()
        data = [loc.to_dict() for loc in locations]
        return jsonify(data)
    except Exception as e:
        current_app.logger.error(f"Erro ao obter localizações: {e}")
        return jsonify({'error': 'Erro interno do servidor'}), 500


@bp.route('/api/start-tracking', methods=['POST'])
@login_required
def start_tracking():
    """API para iniciar tracking de localização"""
    if not _can_monitor(current_user):
        return jsonify({'error': 'Acesso negado'}), 403
    
    try:
        # Verificar se já existe tracking ativo
        existing_location = TechnicianLocation.query.filter_by(
            user_id=current_user.id, 
            is_tracking=True
        ).first()
        
        if existing_location:
            return jsonify({
                'success': True,
                'message': 'Tracking já está ativo',
                'location': existing_location.to_dict()
            })
        
        # Criar novo tracking (será atualizado quando receber primeira localização)
        location = TechnicianLocation(
            user_id=current_user.id,
            latitude=0.0,  # Será atualizado
            longitude=0.0,  # Será atualizado
            is_online=True,
            is_tracking=True
        )
        
        from app import db
        db.session.add(location)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Tracking iniciado com sucesso',
            'location': location.to_dict()
        })
        
    except Exception as e:
        current_app.logger.error(f"Erro ao iniciar tracking: {e}")
        return jsonify({'error': 'Erro interno do servidor'}), 500


@bp.route('/api/stop-tracking', methods=['POST'])
@login_required
def stop_tracking():
    """API para parar tracking de localização"""
    if not _can_monitor(current_user):
        return jsonify({'error': 'Acesso negado'}), 403
    
    try:
        location = TechnicianLocation.query.filter_by(
            user_id=current_user.id,
            is_tracking=True
        ).first()
        
        if location:
            location.is_tracking = False
            location.is_online = False
            location.last_seen = brasilia_to_utc(get_brasilia_now())
            
            from app import db
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Tracking parado com sucesso'
            })
        else:
            return jsonify({
                'success': True,
                'message': 'Nenhum tracking ativo encontrado'
            })
            
    except Exception as e:
        current_app.logger.error(f"Erro ao parar tracking: {e}")
        return jsonify({'error': 'Erro interno do servidor'}), 500


@bp.route('/api/tracking-status')
@login_required
def get_tracking_status():
    """API para obter status do tracking do usuário atual"""
    if not _can_monitor(current_user):
        return jsonify({'error': 'Acesso negado'}), 403
    
    try:
        location = TechnicianLocation.query.filter_by(user_id=current_user.id).first()
        
        if location:
            return jsonify({
                'success': True,
                'is_tracking': location.is_tracking,
                'is_online': location.is_online,
                'last_seen': location.last_seen.isoformat() if location.last_seen else None,
                'location': location.to_dict()
            })
        else:
            return jsonify({
                'success': True,
                'is_tracking': False,
                'is_online': False,
                'last_seen': None,
                'location': None
            })
            
    except Exception as e:
        current_app.logger.error(f"Erro ao obter status do tracking: {e}")
        return jsonify({'error': 'Erro interno do servidor'}), 500


@bp.route('/api/user-location/<int:user_id>')
@login_required
def get_user_location(user_id):
    """API para obter última localização de um usuário específico"""
    if not _can_monitor(current_user):
        return jsonify({'error': 'Acesso negado'}), 403
    
    try:
        location = TechnicianLocation.get_last_location_by_user(user_id)
        if location:
            return jsonify({
                'success': True,
                'location': location.to_dict()
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Nenhuma localização encontrada para este usuário'
            })
    except Exception as e:
        current_app.logger.error(f"Erro ao obter localização do usuário {user_id}: {e}")
        return jsonify({'error': 'Erro interno do servidor'}), 500


@bp.route('/map')
@login_required
def map_view():
    """Visualização do mapa de monitoramento"""
    if not _can_monitor(current_user):
        return render_template('errors/403.html'), 403
    
    return render_template('monitoring/map.html', current_user=current_user)


@bp.route('/map/<int:user_id>')
@login_required
def user_map_view(user_id):
    """Visualização do mapa individual de um usuário"""
    if not _can_monitor(current_user):
        return render_template('errors/403.html'), 403
    
    # Buscar dados do usuário
    from app.models import User
    user = User.query.get(user_id)
    if not user:
        return render_template('errors/404.html'), 404
    
    return render_template('monitoring/user_map.html', 
                         current_user=current_user,
                         target_user=user)
