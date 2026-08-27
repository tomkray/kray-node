@echo off
REM Door 2 on Windows — FULL NODE of Signet KRAY (signet.kray.network).
REM Never a second writer. Never the pot key. Mainnet: scripts\follow\mainnet.cmd
REM Assistants: docs\RUN-NODE.md first (quiz + scripts\follow\preflight.cmd).
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
REM --use-system-ca: Node 24 on Windows uses its own Mozilla CA bundle and rejects the writer's cert
REM (UNABLE_TO_VERIFY_LEAF_SIGNATURE) even when PowerShell/the browser trust it. This flag makes Node
REM read the Windows CA store — the official, safe fix. NEVER set NODE_TLS_REJECT_UNAUTHORIZED=0.
REM
REM Optional — RE-PROVE Bitcoin seals from YOUR OWN Signet Core. setlocal does NOT hide inherited vars, so
REM if you run Signet bitcoind, set these in the SAME terminal BEFORE this door (the password never lives
REM in git). The follow then weighs every seal from your node instead of trusting the writer's hints:
REM   set KRAY_BTC_RPC=http://127.0.0.1:38332
REM   set KRAY_BTC_RPC_USER=<your rpc user>
REM   set KRAY_BTC_RPC_PASS=<your rpc pass>
REM Without them the follow still fully verifies journal + atlas; seals just stay unweighed hints (by design).
echo Following Signet - the explorer opens at http://127.0.0.1:4480/ once it verifies. Leave this window open.
"%NODE%" --use-system-ca scripts\follow\kray-follow.mjs --from https://signet.kray.network --dir "%cd%\follower" --watch --serve 4480
