"""
Sistema de controle automático de horas de suporte
Integra com o sistema de tickets para controlar uso de planos
"""

from app import create_app, db
from app.models import Ticket, PlanUsage, ClientPlan, Client
from app.timezone_utils import get_brasilia_now
from datetime import datetime, timedelta

def update_plan_usage_from_ticket(ticket_id):
    """Atualizar uso de plano baseado em um ticket"""
    app = create_app()
    
    with app.app_context():
        try:
            ticket = Ticket.query.get(ticket_id)
            if not ticket:
                print(f"❌ Ticket {ticket_id} não encontrado")
                return False
            
            # Verificar se o ticket tem cliente associado
            if not ticket.client_id:
                print(f"⚠️ Ticket {ticket_id} não tem cliente associado")
                return False
            
            # Buscar planos ativos do cliente
            client_plans = ClientPlan.query.filter(
                ClientPlan.client_id == ticket.client_id,
                ClientPlan.is_active == True,
                ClientPlan.start_date <= get_brasilia_now(),
                ClientPlan.end_date >= get_brasilia_now()
            ).all()
            
            if not client_plans:
                print(f"⚠️ Cliente {ticket.client_id} não tem planos ativos")
                return False
            
            # Calcular horas do ticket
            ticket_hours = ticket.total_hours()
            if ticket_hours <= 0:
                print(f"⚠️ Ticket {ticket_id} não tem horas apontadas")
                return False
            
            # Determinar mês/ano do ticket
            ticket_month_year = ticket.created_at.strftime('%Y-%m')
            
            updated_plans = []
            
            for client_plan in client_plans:
                # Verificar se o ticket está dentro do período do plano
                if ticket.created_at < client_plan.start_date or ticket.created_at > client_plan.end_date:
                    continue
                
                # Buscar ou criar registro de uso
                usage_record = PlanUsage.query.filter(
                    PlanUsage.client_plan_id == client_plan.id,
                    PlanUsage.month_year == ticket_month_year
                ).first()
                
                if usage_record:
                    # Atualizar registro existente
                    usage_record.hours_used += ticket_hours
                    if not usage_record.ticket_id:
                        usage_record.ticket_id = ticket_id
                else:
                    # Criar novo registro
                    usage_record = PlanUsage(
                        client_plan_id=client_plan.id,
                        ticket_id=ticket_id,
                        hours_used=ticket_hours,
                        month_year=ticket_month_year
                    )
                    db.session.add(usage_record)
                
                updated_plans.append({
                    'plan_name': client_plan.plan.name,
                    'system_name': client_plan.plan.system.name,
                    'hours_added': ticket_hours,
                    'total_hours': usage_record.hours_used
                })
            
            db.session.commit()
            
            print(f"✅ Uso atualizado para ticket {ticket_id}:")
            for plan_info in updated_plans:
                print(f"   📋 {plan_info['plan_name']} ({plan_info['system_name']}): +{plan_info['hours_added']}h = {plan_info['total_hours']}h total")
            
            return True
            
        except Exception as e:
            db.session.rollback()
            print(f"❌ Erro ao atualizar uso do plano: {e}")
            return False

def get_client_plan_status(client_id, month_year=None):
    """Obter status dos planos de um cliente para um mês específico"""
    app = create_app()
    
    with app.app_context():
        try:
            if not month_year:
                month_year = get_brasilia_now().strftime('%Y-%m')
            
            # Buscar planos ativos do cliente
            client_plans = ClientPlan.query.filter(
                ClientPlan.client_id == client_id,
                ClientPlan.is_active == True
            ).all()
            
            status_list = []
            
            for client_plan in client_plans:
                # Verificar se o plano está ativo no período
                plan_start = client_plan.start_date.strftime('%Y-%m')
                plan_end = client_plan.end_date.strftime('%Y-%m')
                
                if month_year < plan_start or month_year > plan_end:
                    continue
                
                # Buscar uso do mês
                usage_record = PlanUsage.query.filter(
                    PlanUsage.client_plan_id == client_plan.id,
                    PlanUsage.month_year == month_year
                ).first()
                
                hours_used = usage_record.hours_used if usage_record else 0
                monthly_hours = client_plan.get_effective_monthly_hours()
                additional_hours = max(0, hours_used - monthly_hours)
                additional_cost = additional_hours * client_plan.get_effective_hour_rate()
                
                status = {
                    'client_plan_id': client_plan.id,
                    'plan_name': client_plan.plan.name,
                    'system_name': client_plan.plan.system.name,
                    'monthly_hours': monthly_hours,
                    'hours_used': hours_used,
                    'additional_hours': additional_hours,
                    'additional_cost': additional_cost,
                    'hour_rate': client_plan.get_effective_hour_rate(),
                    'is_over_limit': hours_used > monthly_hours,
                    'utilization_percentage': (hours_used / monthly_hours * 100) if monthly_hours > 0 else 0
                }
                
                status_list.append(status)
            
            return status_list
            
        except Exception as e:
            print(f"❌ Erro ao obter status dos planos: {e}")
            return []

def generate_monthly_report(month_year=None):
    """Gerar relatório mensal de uso de planos"""
    app = create_app()
    
    with app.app_context():
        try:
            if not month_year:
                month_year = get_brasilia_now().strftime('%Y-%m')
            
            # Buscar todos os registros de uso do mês
            usage_records = PlanUsage.query.filter(
                PlanUsage.month_year == month_year
            ).all()
            
            report = {
                'month_year': month_year,
                'total_clients': 0,
                'total_plans': 0,
                'total_hours_used': 0,
                'total_additional_cost': 0,
                'clients_over_limit': 0,
                'details': []
            }
            
            # Agrupar por cliente
            clients_data = {}
            
            for usage_record in usage_records:
                client_id = usage_record.client_plan.client_id
                
                if client_id not in clients_data:
                    clients_data[client_id] = {
                        'client_name': usage_record.client_plan.client.name,
                        'plans': [],
                        'total_hours': 0,
                        'total_cost': 0,
                        'is_over_limit': False
                    }
                
                client_data = clients_data[client_id]
                plan_data = {
                    'plan_name': usage_record.client_plan.plan.name,
                    'system_name': usage_record.client_plan.plan.system.name,
                    'monthly_hours': usage_record.client_plan.get_effective_monthly_hours(),
                    'hours_used': usage_record.hours_used,
                    'additional_hours': max(0, usage_record.hours_used - usage_record.client_plan.get_effective_monthly_hours()),
                    'additional_cost': max(0, usage_record.hours_used - usage_record.client_plan.get_effective_monthly_hours()) * usage_record.client_plan.get_effective_hour_rate()
                }
                
                client_data['plans'].append(plan_data)
                client_data['total_hours'] += usage_record.hours_used
                client_data['total_cost'] += plan_data['additional_cost']
                
                if plan_data['additional_hours'] > 0:
                    client_data['is_over_limit'] = True
            
            # Compilar relatório
            report['total_clients'] = len(clients_data)
            report['details'] = list(clients_data.values())
            
            for client_data in report['details']:
                report['total_plans'] += len(client_data['plans'])
                report['total_hours_used'] += client_data['total_hours']
                report['total_additional_cost'] += client_data['total_cost']
                
                if client_data['is_over_limit']:
                    report['clients_over_limit'] += 1
            
            return report
            
        except Exception as e:
            print(f"❌ Erro ao gerar relatório mensal: {e}")
            return None

def check_expiring_plans(days_ahead=30):
    """Verificar planos que estão expirando"""
    app = create_app()
    
    with app.app_context():
        try:
            expiry_date = get_brasilia_now() + timedelta(days=days_ahead)
            
            expiring_plans = ClientPlan.query.filter(
                ClientPlan.is_active == True,
                ClientPlan.end_date <= expiry_date,
                ClientPlan.end_date > get_brasilia_now()
            ).all()
            
            expiring_list = []
            
            for client_plan in expiring_plans:
                days_until_expiry = client_plan.days_until_expiry()
                
                expiring_info = {
                    'client_plan_id': client_plan.id,
                    'client_name': client_plan.client.name,
                    'plan_name': client_plan.plan.name,
                    'system_name': client_plan.plan.system.name,
                    'end_date': client_plan.end_date,
                    'days_until_expiry': days_until_expiry,
                    'is_auto_renew': client_plan.is_auto_renew
                }
                
                expiring_list.append(expiring_info)
            
            return expiring_list
            
        except Exception as e:
            print(f"❌ Erro ao verificar planos expirando: {e}")
            return []

def sync_all_tickets_usage():
    """Sincronizar uso de todos os tickets com planos"""
    app = create_app()
    
    with app.app_context():
        try:
            print("🔄 Iniciando sincronização de uso de planos...")
            
            # Buscar todos os tickets fechados com horas
            tickets = Ticket.query.filter(
                Ticket.status == 'fechado',
                Ticket.client_id.isnot(None)
            ).all()
            
            synced_count = 0
            error_count = 0
            
            for ticket in tickets:
                if update_plan_usage_from_ticket(ticket.id):
                    synced_count += 1
                else:
                    error_count += 1
            
            print(f"✅ Sincronização concluída:")
            print(f"   📊 {synced_count} tickets sincronizados")
            print(f"   ❌ {error_count} tickets com erro")
            
            return synced_count, error_count
            
        except Exception as e:
            print(f"❌ Erro na sincronização: {e}")
            return 0, 0

if __name__ == "__main__":
    print("🔧 Sistema de Controle de Horas de Suporte")
    print("=" * 50)
    
    # Testar funções
    print("🧪 Testando funções...")
    
    # Gerar relatório do mês atual
    report = generate_monthly_report()
    if report:
        print(f"\n📊 Relatório do mês {report['month_year']}:")
        print(f"   👥 {report['total_clients']} clientes")
        print(f"   📋 {report['total_plans']} planos")
        print(f"   ⏰ {report['total_hours_used']:.1f}h utilizadas")
        print(f"   💰 R$ {report['total_additional_cost']:.2f} em horas extras")
        print(f"   ⚠️ {report['clients_over_limit']} clientes acima do limite")
    
    # Verificar planos expirando
    expiring = check_expiring_plans()
    if expiring:
        print(f"\n⚠️ {len(expiring)} planos expirando em 30 dias:")
        for plan in expiring[:5]:  # Mostrar apenas os primeiros 5
            print(f"   📋 {plan['client_name']} - {plan['plan_name']} ({plan['days_until_expiry']} dias)")
    
    print("\n✨ Sistema de controle de horas funcionando!")
