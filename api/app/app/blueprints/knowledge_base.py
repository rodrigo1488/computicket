from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, send_file, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from app import db
from app.models import KnowledgeCategory, KnowledgeArticle, KnowledgeAttachment
import os
import uuid
from datetime import datetime

knowledge_base = Blueprint('knowledge_base', __name__)

# Configurações para upload de arquivos
ALLOWED_EXTENSIONS = {
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar',
    'jpg', 'jpeg', 'png', 'gif', 'mp4', 'avi', 'mp3', 'wav'
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

def allowed_file(filename):
    """Verifica se o arquivo tem extensão permitida"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_upload_folder():
    """Retorna o diretório de upload"""
    upload_folder = os.path.join(current_app.instance_path, 'knowledge_uploads')
    if not os.path.exists(upload_folder):
        os.makedirs(upload_folder)
    return upload_folder

@knowledge_base.route('/knowledge-base')
@login_required
def index():
    """Página principal do banco de conhecimentos"""
    # Buscar categorias com contagem de artigos
    categories = KnowledgeCategory.query.all()
    
    # Buscar artigos em destaque
    featured_articles = KnowledgeArticle.query.filter_by(
        status='published', 
        is_featured=True
    ).order_by(KnowledgeArticle.views_count.desc()).limit(6).all()
    
    # Buscar artigos recentes
    recent_articles = KnowledgeArticle.query.filter_by(
        status='published'
    ).order_by(KnowledgeArticle.created_at.desc()).limit(10).all()
    
    # Estatísticas gerais
    total_categories = KnowledgeCategory.query.count()
    total_articles = KnowledgeArticle.query.filter_by(status='published').count()
    total_views = db.session.query(db.func.sum(KnowledgeArticle.views_count)).scalar() or 0
    
    return render_template('knowledge_base/index.html',
                         categories=categories,
                         featured_articles=featured_articles,
                         recent_articles=recent_articles,
                         total_categories=total_categories,
                         total_articles=total_articles,
                         total_views=total_views)

@knowledge_base.route('/knowledge-base/category/<int:category_id>')
@login_required
def category_view(category_id):
    """Visualizar artigos de uma categoria"""
    category = KnowledgeCategory.query.get_or_404(category_id)
    
    # Parâmetros de busca e filtro
    search_term = request.args.get('q', '').strip()
    status_filter = request.args.get('status', 'published')
    sort_by = request.args.get('sort', 'created_at')
    sort_order = request.args.get('order', 'desc')
    
    # Query base
    query = KnowledgeArticle.query.filter_by(category_id=category_id)
    
    # Filtro por status
    if status_filter != 'all':
        query = query.filter_by(status=status_filter)
    
    # Busca por termo
    if search_term:
        query = query.filter(
            db.or_(
                KnowledgeArticle.title.ilike(f'%{search_term}%'),
                KnowledgeArticle.content.ilike(f'%{search_term}%'),
                KnowledgeArticle.tags.ilike(f'%{search_term}%')
            )
        )
    
    # Ordenação
    if sort_by == 'title':
        order_column = KnowledgeArticle.title
    elif sort_by == 'views':
        order_column = KnowledgeArticle.views_count
    elif sort_by == 'updated':
        order_column = KnowledgeArticle.updated_at
    else:  # created_at
        order_column = KnowledgeArticle.created_at
    
    if sort_order == 'asc':
        query = query.order_by(order_column.asc())
    else:
        query = query.order_by(order_column.desc())
    
    articles = query.all()
    
    return render_template('knowledge_base/category.html',
                         category=category,
                         articles=articles,
                         search_term=search_term,
                         status_filter=status_filter,
                         sort_by=sort_by,
                         sort_order=sort_order)

@knowledge_base.route('/knowledge-base/article/<int:article_id>')
@login_required
def article_view(article_id):
    """Visualizar um artigo específico"""
    article = KnowledgeArticle.query.get_or_404(article_id)
    
    # Incrementar contador de visualizações
    article.increment_views()
    
    # Buscar artigos relacionados (mesma categoria)
    related_articles = KnowledgeArticle.query.filter(
        KnowledgeArticle.category_id == article.category_id,
        KnowledgeArticle.id != article.id,
        KnowledgeArticle.status == 'published'
    ).order_by(KnowledgeArticle.views_count.desc()).limit(5).all()
    
    return render_template('knowledge_base/article.html',
                         article=article,
                         related_articles=related_articles)

@knowledge_base.route('/knowledge-base/category/new', methods=['GET', 'POST'])
@login_required
def new_category():
    """Criar nova categoria"""
    print(f"DEBUG: new_category chamada - método: {request.method}")
    
    if request.method == 'POST':
        print(f"DEBUG: POST recebido para nova categoria")
        print(f"DEBUG: Dados do formulário: {dict(request.form)}")
        name = request.form.get('name', '').strip()
        description = request.form.get('description', '').strip()
        icon = request.form.get('icon', 'fas fa-folder').strip()
        color = request.form.get('color', '#3B82F6').strip()
        
        if not name:
            flash('Nome da categoria é obrigatório!', 'error')
            return render_template('knowledge_base/new_category.html')
        
        # Verificar se já existe categoria com esse nome
        existing = KnowledgeCategory.query.filter_by(name=name).first()
        if existing:
            flash('Já existe uma categoria com esse nome!', 'error')
            return render_template('knowledge_base/new_category.html')
        
        try:
            print(f"DEBUG: Criando categoria: name='{name}', description='{description}', icon='{icon}', color='{color}'")
            
            category = KnowledgeCategory(
                name=name,
                description=description,
                icon=icon,
                color=color,
                created_by_id=current_user.id
            )
            
            print(f"DEBUG: Categoria criada: {category}")
            
            db.session.add(category)
            db.session.commit()
            
            print(f"DEBUG: Categoria salva no banco de dados com sucesso")
            flash(f'Categoria "{name}" criada com sucesso!', 'success')
            return redirect(url_for('knowledge_base.index'))
            
        except Exception as e:
            db.session.rollback()
            print(f"DEBUG: Erro ao criar categoria: {e}")
            import traceback
            traceback.print_exc()
            flash('Erro ao criar categoria. Tente novamente.', 'error')
            return render_template('knowledge_base/new_category.html')
    
    return render_template('knowledge_base/new_category.html')

@knowledge_base.route('/knowledge-base/category/<int:category_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_category(category_id):
    """Editar categoria"""
    category = KnowledgeCategory.query.get_or_404(category_id)
    
    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        description = request.form.get('description', '').strip()
        icon = request.form.get('icon', 'fas fa-folder').strip()
        color = request.form.get('color', '#3B82F6').strip()
        
        if not name:
            flash('Nome da categoria é obrigatório!', 'error')
            return render_template('knowledge_base/edit_category.html', category=category)
        
        # Verificar se já existe categoria com esse nome (exceto a atual)
        existing = KnowledgeCategory.query.filter(
            KnowledgeCategory.name == name,
            KnowledgeCategory.id != category_id
        ).first()
        if existing:
            flash('Já existe uma categoria com esse nome!', 'error')
            return render_template('knowledge_base/edit_category.html', category=category)
        
        try:
            category.name = name
            category.description = description
            category.icon = icon
            category.color = color
            
            db.session.commit()
            
            flash(f'Categoria "{name}" atualizada com sucesso!', 'success')
            return redirect(url_for('knowledge_base.index'))
            
        except Exception as e:
            db.session.rollback()
            flash('Erro ao atualizar categoria. Tente novamente.', 'error')
            return render_template('knowledge_base/edit_category.html', category=category)
    
    return render_template('knowledge_base/edit_category.html', category=category)

@knowledge_base.route('/knowledge-base/category/<int:category_id>/delete', methods=['POST'])
@login_required
def delete_category(category_id):
    """Deletar categoria"""
    category = KnowledgeCategory.query.get_or_404(category_id)
    
    try:
        # Deletar categoria (artigos e anexos serão deletados em cascata)
        db.session.delete(category)
        db.session.commit()
        
        flash(f'Categoria "{category.name}" deletada com sucesso!', 'success')
        return redirect(url_for('knowledge_base.index'))
        
    except Exception as e:
        db.session.rollback()
        flash('Erro ao deletar categoria. Tente novamente.', 'error')
        return redirect(url_for('knowledge_base.index'))

@knowledge_base.route('/knowledge-base/category/<int:category_id>/article/new', methods=['GET', 'POST'])
@login_required
def new_article(category_id):
    """Criar novo artigo"""
    category = KnowledgeCategory.query.get_or_404(category_id)
    
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '').strip()
        summary = request.form.get('summary', '').strip()
        tags = request.form.get('tags', '').strip()
        status = request.form.get('status', 'published')
        is_featured = 'is_featured' in request.form
        
        if not title or not content:
            flash('Título e conteúdo são obrigatórios!', 'error')
            return render_template('knowledge_base/new_article.html', category=category)
        
        try:
            article = KnowledgeArticle(
                title=title,
                content=content,
                summary=summary,
                tags=tags,
                category_id=category_id,
                status=status,
                is_featured=is_featured,
                created_by_id=current_user.id
            )
            
            db.session.add(article)
            db.session.commit()
            
            # Processar upload de arquivos
            if 'attachments' in request.files:
                files = request.files.getlist('attachments')
                for file in files:
                    if file and file.filename and allowed_file(file.filename):
                        # Gerar nome único para o arquivo
                        filename = secure_filename(file.filename)
                        unique_filename = f"{uuid.uuid4()}_{filename}"
                        file_path = os.path.join(get_upload_folder(), unique_filename)
                        
                        # Salvar arquivo
                        file.save(file_path)
                        
                        # Criar registro do anexo
                        attachment = KnowledgeAttachment(
                            article_id=article.id,
                            filename=unique_filename,
                            original_filename=filename,
                            file_path=file_path,
                            file_size=os.path.getsize(file_path),
                            file_type=file.content_type or 'application/octet-stream',
                            created_by_id=current_user.id
                        )
                        
                        db.session.add(attachment)
            
            db.session.commit()
            
            flash(f'Artigo "{title}" criado com sucesso!', 'success')
            return redirect(url_for('knowledge_base.article_view', article_id=article.id))
            
        except Exception as e:
            db.session.rollback()
            flash('Erro ao criar artigo. Tente novamente.', 'error')
            return render_template('knowledge_base/new_article.html', category=category)
    
    return render_template('knowledge_base/new_article.html', category=category)

@knowledge_base.route('/knowledge-base/article/<int:article_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_article(article_id):
    """Editar artigo"""
    article = KnowledgeArticle.query.get_or_404(article_id)
    
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '').strip()
        summary = request.form.get('summary', '').strip()
        tags = request.form.get('tags', '').strip()
        status = request.form.get('status', 'published')
        is_featured = 'is_featured' in request.form
        
        if not title or not content:
            flash('Título e conteúdo são obrigatórios!', 'error')
            return render_template('knowledge_base/edit_article.html', article=article)
        
        try:
            article.title = title
            article.content = content
            article.summary = summary
            article.tags = tags
            article.status = status
            article.is_featured = is_featured
            article.updated_by_id = current_user.id
            
            # Processar upload de novos arquivos
            if 'attachments' in request.files:
                files = request.files.getlist('attachments')
                for file in files:
                    if file and file.filename and allowed_file(file.filename):
                        # Gerar nome único para o arquivo
                        filename = secure_filename(file.filename)
                        unique_filename = f"{uuid.uuid4()}_{filename}"
                        file_path = os.path.join(get_upload_folder(), unique_filename)
                        
                        # Salvar arquivo
                        file.save(file_path)
                        
                        # Criar registro do anexo
                        attachment = KnowledgeAttachment(
                            article_id=article.id,
                            filename=unique_filename,
                            original_filename=filename,
                            file_path=file_path,
                            file_size=os.path.getsize(file_path),
                            file_type=file.content_type or 'application/octet-stream',
                            created_by_id=current_user.id
                        )
                        
                        db.session.add(attachment)
            
            db.session.commit()
            
            flash(f'Artigo "{title}" atualizado com sucesso!', 'success')
            return redirect(url_for('knowledge_base.article_view', article_id=article.id))
            
        except Exception as e:
            db.session.rollback()
            flash('Erro ao atualizar artigo. Tente novamente.', 'error')
            return render_template('knowledge_base/edit_article.html', article=article)
    
    return render_template('knowledge_base/edit_article.html', article=article)

@knowledge_base.route('/knowledge-base/article/<int:article_id>/delete', methods=['POST'])
@login_required
def delete_article(article_id):
    """Deletar artigo"""
    article = KnowledgeArticle.query.get_or_404(article_id)
    
    try:
        # Deletar arquivos físicos
        for attachment in article.attachments:
            if os.path.exists(attachment.file_path):
                os.remove(attachment.file_path)
        
        # Deletar artigo (anexos serão deletados em cascata)
        db.session.delete(article)
        db.session.commit()
        
        flash(f'Artigo "{article.title}" deletado com sucesso!', 'success')
        return redirect(url_for('knowledge_base.category_view', category_id=article.category_id))
        
    except Exception as e:
        db.session.rollback()
        flash('Erro ao deletar artigo. Tente novamente.', 'error')
        return redirect(url_for('knowledge_base.article_view', article_id=article_id))

@knowledge_base.route('/knowledge-base/attachment/<int:attachment_id>/download')
@login_required
def download_attachment(attachment_id):
    """Download de anexo"""
    attachment = KnowledgeAttachment.query.get_or_404(attachment_id)
    
    if not os.path.exists(attachment.file_path):
        flash('Arquivo não encontrado!', 'error')
        return redirect(url_for('knowledge_base.article_view', article_id=attachment.article_id))
    
    # Incrementar contador de downloads
    attachment.increment_downloads()
    
    return send_file(
        attachment.file_path,
        as_attachment=True,
        download_name=attachment.original_filename,
        mimetype=attachment.file_type
    )

@knowledge_base.route('/knowledge-base/attachment/<int:attachment_id>/delete', methods=['POST'])
@login_required
def delete_attachment(attachment_id):
    """Deletar anexo"""
    attachment = KnowledgeAttachment.query.get_or_404(attachment_id)
    article_id = attachment.article_id
    
    try:
        # Deletar arquivo físico
        if os.path.exists(attachment.file_path):
            os.remove(attachment.file_path)
        
        # Deletar registro do anexo
        db.session.delete(attachment)
        db.session.commit()
        
        flash('Anexo deletado com sucesso!', 'success')
        return redirect(url_for('knowledge_base.article_view', article_id=article_id))
        
    except Exception as e:
        db.session.rollback()
        flash('Erro ao deletar anexo. Tente novamente.', 'error')
        return redirect(url_for('knowledge_base.article_view', article_id=article_id))

@knowledge_base.route('/knowledge-base/search')
@login_required
def search():
    """Busca global no banco de conhecimentos"""
    search_term = request.args.get('q', '').strip()
    category_id = request.args.get('category', type=int)
    
    if not search_term:
        return render_template('knowledge_base/search.html', 
                             results=[], 
                             search_term='',
                             category_id=None)
    
    # Query base
    query = KnowledgeArticle.query.filter_by(status='published')
    
    # Filtro por categoria
    if category_id:
        query = query.filter_by(category_id=category_id)
    
    # Busca por termo
    query = query.filter(
        db.or_(
            KnowledgeArticle.title.ilike(f'%{search_term}%'),
            KnowledgeArticle.content.ilike(f'%{search_term}%'),
            KnowledgeArticle.tags.ilike(f'%{search_term}%'),
            KnowledgeArticle.summary.ilike(f'%{search_term}%')
        )
    )
    
    results = query.order_by(KnowledgeArticle.views_count.desc()).all()
    
    # Buscar categorias para o filtro
    categories = KnowledgeCategory.query.all()
    
    return render_template('knowledge_base/search.html',
                         results=results,
                         search_term=search_term,
                         category_id=category_id,
                         categories=categories)
