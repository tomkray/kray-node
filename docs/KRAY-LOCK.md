# Kray Lock — policy doors (1 key · many keys · entry limits)

> **Installable kit (GitHub sibling):** clone / ship from
> [`kray-lock`](https://github.com/tomkray/kray-lock) · local
> `~/ai-projects/kray-lock`.  
> Speak proves **you hold ★N**. The **lock** decides if ★N is welcome and
> how many times. Policy is local — never journaled (A2).

## Install (3 steps)

```bash
cd ~/ai-projects/kray-lock   # or: git clone https://github.com/tomkray/kray-lock.git
node bin/kray-lock.mjs create --name "Front door" --star 42
# edit doors/front-door/policy.json  ← ids · quantities · true/false
./doors/front-door/start.sh
# http://127.0.0.1:8787/door  ·  KrayWallet → Unlock → scan
```

Every knob lives in **one** `policy.json`. Master map:
[`templates/policy.master.json`](https://github.com/tomkray/kray-lock/blob/main/templates/policy.master.json).

## What you configure on each door

| Mode | Config | Who enters |
|---|---|---|
| **One key** | `keys: [{ id: "42" }]` | Only living owner of ★42 |
| **Collection / guest list** | `keys: [{ id: "100" }, { id: "101" }, …]` `mode: "any"` | Anyone who Speaks for **any** listed star |
| **Event quotas** | `maxEntries` per id + optional `maxEntriesTotal` | Same keys, limited unlocks (VIP once, guest ×2, …) |

Stars = ready today (BIP-340 Speak).  
L1 ordinal inscription ids = same policy shape (`kind: "ordinal"`) — proof path comes later; list them already if you want the schema frozen.

Copy a template from the kit (`one-star` · `guest-list` · `event`).
## Transport — Wallet-class (atemporal)

**Law:** the bounce bytes (`kraylock:1?…`) are eternal. Radios are adapters.
A new PHY must never rewrite Speak, policy, or the Key sheet.

| Gesture (human) | Status | Why (Apple / Google Wallet) |
|---|---|---|
| **NFC tap** | Next (native) | Apple Pay / Google Wallet / Car Key — zero thought |
| **BLE proximity** | Next (native) | Wallet passes wake · digital key in pocket |
| **UWB** | Later | Precision ranging where silicon exists |
| **QR / camera** | **Ready now** | Universal on every iPhone & Android PWA |
| Wi‑Fi HTTP | Ready (door) | Lock agent `GET /challenge` · `POST /unlock` — not the thumb |
| IR | Optional | Dead on modern phones — kits only |
| Mesh | Later | Only if NFC/BLE/Wi‑Fi cannot reach |

**User path today:** Unlock → hold phone at door code → sign → success shows the door’s name.  
**User path elite:** Unlock / Express → tap or walk up → same bytes → same success.

Phone / PWA: **Unlock** button → bounce in → Key signs (no door tabs, no fee chrome) → door name.  
Lock: allowlist? quota left? speakId fresh? → `UNLOCKED` → `onUnlock` relay.

## Flow (any configured door)

```
Lock (policy)          Wallet (Key)              Book
   |                        |                      |
   |-- challenge(star) ---->|                      |
   |                        |-- GET /speak ------->|
   |                        |<-- message ----------|
   |                        | BIP-340 sign         |
   |<-- proof --------------|                      |
   |-- POST /speak verify --------------------- >|
   | allowlist + quota + anti-replay               |
   |-- UNLOCK / relay                              |
```

## Event example

```json
{
  "id": "rooftop-night",
  "audience": "event",
  "mode": "any",
  "keys": [
    { "kind": "star", "id": "500", "maxEntries": null, "label": "staff" },
    { "kind": "star", "id": "501", "maxEntries": 1, "label": "VIP" },
    { "kind": "star", "id": "502", "maxEntries": 2, "label": "guest+" }
  ],
  "maxEntriesTotal": 200,
  "expiresAt": "2026-12-31T06:00:00Z",
  "onUnlock": "curl -X POST http://127.0.0.1:9000/gate/open"
}
```

Staff unlimited · VIP once · guest twice · door dies after 200 or after expiry.

## Not this (yet)

- Parent-collection auto-expand (`mode: collection`) — phase 2 (explicit `keys[]` is safer).  
- Ordinal L1 Speak — schema ready; verifier later.  
- Native NFC / BLE Express Mode — same bounce bytes; entitlements + firmware.  
- Mesh firmware — same policy, new wire.
