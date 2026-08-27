@echo off
REM Confront this Windows machine before follow / guardian / lab.
setlocal
cd /d "%~dp0\..\.."
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
REM --use-system-ca: read the Windows CA store so the writer-reachability probe does not falsely report
REM "did not answer" on Node 24 (UNABLE_TO_VERIFY_LEAF_SIGNATURE). NEVER NODE_TLS_REJECT_UNAUTHORIZED=0.
"%NODE%" --use-system-ca scripts\follow\preflight.mjs %*
