@echo off
REM Shared house root. Every run\*.cmd calls this first.
REM Override: set KRAY_VITRINE_ROOT, or put KRAY_VITRINE_ROOT= in hot\machine.env
if defined KRAY_VITRINE_ROOT goto :have_root
set "ROOT=C:\kray-network-vitrine"
if exist "%~dp0..\hot\machine.env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b "KRAY_VITRINE_ROOT=" "%~dp0..\hot\machine.env"`) do set "ROOT=%%B"
)
goto :node
:have_root
set "ROOT=%KRAY_VITRINE_ROOT%"
:node
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
