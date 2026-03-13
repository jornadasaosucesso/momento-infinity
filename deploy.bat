@echo off
echo ===========================================
echo 🚀 Deploy automático Render - versão definitiva 🚀
echo ===========================================

REM ====================================================
REM 0. Garante que o Git vai aceitar a pasta como segura
git config --global --add safe.directory "%CD%"
echo ✅ Diretório seguro configurado para Git

REM ====================================================
REM 1. Detecta alterações não adicionadas e cria commit de backup
git diff --quiet
if %ERRORLEVEL% NEQ 0 (
    echo 🔹 Alterações não adicionadas detectadas, criando commit de backup...
    git add .
    git commit -m "Backup automatico antes do pull - %DATE% %TIME%"
    echo ✅ Commit de backup criado
) else (
    echo 🔹 Nenhuma alteração local pendente
)

REM ====================================================
REM 2. Atualiza o repositório local com rebase
echo.
echo 🔄 Sincronizando com 'main' remoto...
git pull --rebase origin main

IF %ERRORLEVEL% NEQ 0 (
    REM ====================================================
    REM Conflitos detectados
    echo ⚠️ Conflito detectado! Tentando resolver arquivos binários automaticamente...
    
    REM Lista arquivos em conflito e mantém versão local
    for /f "delims=" %%f in ('git diff --name-only --diff-filter=U') do (
        git checkout --ours "%%f"
        git add "%%f"
        echo 🔹 Arquivo binário %%f resolvido mantendo versão local
    )

    REM Continua o rebase
    git rebase --continue
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ Rebase ainda não finalizado, resolva conflitos restantes manualmente.
        pause
        exit /b
    )
)
echo ✅ Repositório sincronizado

REM ====================================================
REM 3. Adiciona todas as alterações
git add .
echo ✅ Arquivos adicionados

REM ====================================================
REM 4. Verifica se há mudanças para commit
git diff --cached --quiet
if %ERRORLEVEL% EQU 0 (
    REM Nenhuma alteração: cria commit vazio para forçar deploy
    echo 🔹 Nenhuma alteração detectada, criando commit vazio...
    git commit --allow-empty -m "DEPLOY automatico em %DATE% %TIME%"
) else (
    REM Alterações encontradas: commit normal
    echo 🔹 Alterações detectadas, criando commit...
    set commit_message="DEPLOY automatico em %DATE% %TIME%"
    git commit -m %commit_message%
)
echo ✅ Commit preparado

REM 5. Envia para o GitHub
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo ⚠️ Push falhou! Verifique conflitos
)

REM ====================================================
REM 6. Sinalizador de parada
echo ===========================================
echo 🚩 Processo finalizado. Pressione qualquer tecla para sair...
pause


