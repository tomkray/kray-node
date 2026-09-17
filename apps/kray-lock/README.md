# Kray Lock (app pointer)

**Sovereign kit (edit / GitHub):** [`~/ai-projects/kray-lock`](../../../kray-lock)  
Remote intended: `github.com/tomkray/kray-lock`

This folder under `kray-network` is a **pointer only**. The installable door
agent lives in the sibling repo so you can clone / ship a lock without the
whole node book.

```bash
cd ~/ai-projects/kray-lock
node bin/kray-lock.mjs help
node bin/kray-lock.mjs create --name "Front door" --star 42
./doors/front-door/start.sh
```

Book law: Speak is free · not journaled. See sibling `README.md` + `templates/policy.master.json`.
