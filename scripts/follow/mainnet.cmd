@echo off
REM Door 2 on Windows — FULL NODE of Bitcoin MAINNET KRAY (www.kray.network).
REM Separate folder/port from Signet. Never a second writer. Never the pot key.
setlocal
cd /d "%~dp0\..\.."
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
REM Libraries, once — so "download and run this" just works, no separate npm step to remember.
if not exist "apps\kray-core\node_modules" (
  echo Installing libraries once ^(apps\kray-core^) - this happens only the first time...
  pushd apps\kray-core
  call npm ci
  popd
)
REM --use-system-ca: read the Windows CA store (Node 24 rejects the cert otherwise). Never disable TLS.
echo Following mainnet - the explorer opens at http://127.0.0.1:4481/ once it verifies. This clone is a mirror, never the writer.
"%NODE%" --use-system-ca scripts\follow\kray-follow.mjs --from https://www.kray.network --dir "%cd%\follower-main" --watch --serve 4481
