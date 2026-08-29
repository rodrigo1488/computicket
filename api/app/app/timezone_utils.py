"""
Utilitários para gerenciamento de fuso horário
"""
import pytz
from datetime import datetime
from flask import current_app

def get_brasilia_tz():
    """Retorna o fuso horário configurado no sistema ou Brasília por padrão"""
    try:
        from .models import SystemConfig
        # Try to safely get the configured timezone, fallback to America/Sao_Paulo
        if current_app:
            with current_app.app_context():
                tz_name = SystemConfig.get('system_timezone', 'America/Sao_Paulo')
                return pytz.timezone(tz_name)
    except Exception:
        pass
    
    return pytz.timezone('America/Sao_Paulo')

def get_brasilia_now():
    """Retorna a data/hora atual no fuso horário configurado no sistema"""
    return datetime.now(get_brasilia_tz())

def get_brasilia_today():
    """Retorna a data atual no fuso horário do sistema com hora 00:00:00"""
    now = datetime.now(get_brasilia_tz())
    return now.replace(hour=0, minute=0, second=0, microsecond=0)

def utc_to_brasilia(utc_dt):
    """Converte datetime UTC para fuso horário configurado no sistema"""
    if utc_dt is None:
        return None
    
    # Se não tem timezone info, assume UTC
    if utc_dt.tzinfo is None:
        utc_dt = pytz.utc.localize(utc_dt)
    
    return utc_dt.astimezone(get_brasilia_tz())

def brasilia_to_utc(brasilia_dt):
    """Converte datetime do fuso horário do sistema para UTC"""
    if brasilia_dt is None:
        return None
    
    # Se não tem timezone info, assume o fuso do sistema
    if brasilia_dt.tzinfo is None:
        brasilia_dt = get_brasilia_tz().localize(brasilia_dt)
    
    return brasilia_dt.astimezone(pytz.utc)

def format_datetime_brasilia(dt, format_str='%d/%m/%Y %H:%M'):
    """Formata datetime para exibição no fuso horário de Brasília"""
    if dt is None:
        return '—'
    
    brasilia_dt = utc_to_brasilia(dt)
    return brasilia_dt.strftime(format_str)

def format_time_brasilia(dt, format_str='%H:%M'):
    """Formata apenas a hora para exibição no fuso horário de Brasília"""
    if dt is None:
        return '—'
    
    brasilia_dt = utc_to_brasilia(dt)
    return brasilia_dt.strftime(format_str)