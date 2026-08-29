@echo off
REM Atalho na raiz do repo — chama o .bat em infra\postgres\
call "%~dp0infra\postgres\migrate-sqlite-to-postgres.bat" %*
