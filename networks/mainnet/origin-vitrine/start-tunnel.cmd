@echo off
REM Cloudflare tunnel — public name → loopback writer port.
REM Safe while the writer is dark: the hostname answers 502, wallets stay dark.
setlocal
call "%~dp0_house.cmd"
set "CFG=%ROOT%\run\cloudflared.yml"
if not exist "%CFG%" (
  echo missing %CFG%
  echo copy cloudflared.yml.example and point credentials-file at THIS disk's tunnel json
  exit /b 1
)
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not on PATH — install from Cloudflare, then re-run
  exit /b 1
)
echo  tunnel  www.kray.network  →  127.0.0.1:4478
echo  writer still dark until start-writer.cmd
cloudflared tunnel --config "%CFG%" run
