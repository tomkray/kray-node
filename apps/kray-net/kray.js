/* ============================================================================
   KRAY.NETWORK — shell. ONE script every page includes: injects the original
   KRAY glyph sheet (the identity), the header (brand + nav + wallet + theme) and
   the footer, wires KrayWallet connect, the theme toggle, and exposes helpers on
   window.KRAY. Zero dependencies. The look lives in /kray.css.
   A page opts in with <body data-page="inscribe"> (highlights the nav link) and,
   optionally, window.KRAY_NAV = false to suppress the auto-header.
   ========================================================================== */
(function () {
  'use strict';

  /* ── KRAY glyphs — brand mark (black disc + K) and the family ── */
  var GLYPHS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<symbol id="g-kray" viewBox="0 0 4096 4096"><circle cx="2048" cy="2048" r="1950" fill="#000000"/><g transform="translate(2210 2068) rotate(10) scale(1.6509042196918957 -1.6509042196918957) translate(-742 -746.5)"><path d="M170 864V1493H500V948L977 1493H1360L811 864H1191V712H807L1424 0H1010L500 588V0H170V712H60V864Z" fill="#FFFFFF"/></g></symbol>' +
    '<symbol id="g-nyx" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="square"><path d="M4.6 12h14.8"/><path d="M7.1 7.1l9.8 9.8"/><path d="M16.9 7.1L7.1 16.9"/></g></symbol>' +
    '<symbol id="g-star" viewBox="0 0 24 24"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></symbol>' +
    '<symbol id="g-starline" viewBox="0 0 24 24"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-darkstar" viewBox="0 0 24 24"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/></symbol>' +
    '<symbol id="g-block" viewBox="0 0 24 24"><path d="M12 2.5l8 4.5v9L12 21l-8-5V7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 7l8 4.5L20 7M12 11.5V21" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/></symbol>' +
    '<symbol id="g-anchor" viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 8.4V21M12 21c-3.6 0-6-2.4-6-6M12 21c3.6 0 6-2.4 6-6M4 13h4M16 13h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>' +
    '<symbol id="g-glow" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></symbol>' +
    '<symbol id="g-inscribe" viewBox="0 0 24 24"><path d="M4 20l3.5-1L18 8.5 15.5 6 5 16.5 4 20z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 7.5L16.5 10" stroke="currentColor" stroke-width="1.3"/></symbol>' +
    '<symbol id="g-music" viewBox="0 0 24 24"><path d="M9 18.5a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8zM17 16.6a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.4 16.1V6.1l8-1.5v9.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-play" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 8.6v6.8l6.4-3.4z" fill="currentColor"/></symbol>' +
    '<symbol id="g-pause" viewBox="0 0 24 24"><path d="M8 7h2.8v10H8zm5.2 0H16v10h-2.8z" fill="currentColor"/></symbol>' +
    /* ── SHELF marks — the protocol categories (library.ts). Pencil is the ACT.
       The generic WORK fallback is g-cat-file (◇), never g-inscribe. ── */
    '<symbol id="g-cat-image" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 16l4.2-4.2 3 3 3.4-4.6L20 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9" cy="9.2" r="1.2" fill="currentColor"/></symbol>' +
    '<symbol id="g-cat-vector" viewBox="0 0 24 24"><path d="M12 3.4 20.6 12 12 20.6 3.4 12Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-cat-video" viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9.4v5.2l5-2.6z" fill="currentColor"/></symbol>' +
    '<symbol id="g-cat-code" viewBox="0 0 24 24"><path d="M9 7.5 4.8 12 9 16.5M15 7.5 19.2 12 15 16.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-cat-markup" viewBox="0 0 24 24"><path d="M8 5.5 3.6 12 8 18.5M16 5.5 20.4 12 16 18.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-cat-document" viewBox="0 0 24 24"><path d="M7 3.8h7.2L19 8.6V20.2H7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14.2 3.8V8.6H19M9.4 12h5.2M9.4 15.2h5.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>' +
    '<symbol id="g-cat-data" viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="7" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7v10c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V7" fill="none" stroke="currentColor" stroke-width="1.5"/></symbol>' +
    '<symbol id="g-cat-text" viewBox="0 0 24 24"><path d="M7 6.5h10M7 11h10M7 15.5h6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>' +
    '<symbol id="g-cat-model" viewBox="0 0 24 24"><path d="M12 3.6 20 8v8l-8 4.4L4 16V8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 3.6V12l8 4M12 12 4 16" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/></symbol>' +
    '<symbol id="g-cat-font" viewBox="0 0 24 24"><path d="M6.5 18.2 12 5.8l5.5 12.4M8.4 14.2h7.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-cat-archive" viewBox="0 0 24 24"><path d="M5 7h14v3H5zM6 10h12v9H6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 13.4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></symbol>' +
    '<symbol id="g-cat-file" viewBox="0 0 24 24"><path d="M12 3.8 20.2 12 12 20.2 3.8 12Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-name" viewBox="0 0 24 24"><path d="M4 4h9l7 7-9 9-7-7V4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/></symbol>' +
    '<symbol id="g-send" viewBox="0 0 24 24"><path d="M4 12h13M11 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-like" viewBox="0 0 24 24"><path d="M12 20s-7-4.3-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.7-7 9-7 9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-vote" viewBox="0 0 24 24"><path d="M12 2l8 4.6v9.2L12 22l-8-4.6V6.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.5 12l2.4 2.4L16 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    '<symbol id="g-bridge" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.4 12h9.2" stroke="currentColor" stroke-width="1.5"/></symbol>' +
    '<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>' +
    '<symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></symbol>' +
    '<symbol id="i-sound" viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>' +
    /* ── the RARITY glyphs — the KRAY sparkle star, earning light as it grows rarer.
       currentColor, so each tier is coloured by CSS. Ordinals ladder, KRAY-original. ── */
    '<symbol id="g-r-common" viewBox="0 0 24 24"><g transform="translate(4.56 4.87) scale(.62)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-uncommon" viewBox="0 0 24 24"><g transform="translate(3.76 7.52) scale(.52)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g><g transform="translate(13.9 3.55) scale(.3)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-rare" viewBox="0 0 24 24"><path d="M12 2.3 21.7 12 12 21.7 2.3 12Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><g transform="translate(6.48 6.71) scale(.46)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-epic" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="10.5" ry="4" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(-27 12 12)"/><circle cx="21.36" cy="7.23" r="1.4" fill="currentColor"/><g transform="translate(6 6.25) scale(.5)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-legendary" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M12 3.4V.9M12 20.6v2.5M20.6 12h2.5M3.4 12H.9M17.66 6.34 19.5 4.5M6.34 6.34 4.5 4.5M17.66 17.66 19.5 19.5M6.34 17.66 4.5 19.5"/></g><g transform="translate(6.48 6.71) scale(.46)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-mythic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/><g transform="rotate(45 12 12) translate(6.96 7.17) scale(.42)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor" opacity=".62"/></g><g transform="translate(4.8 5.1) scale(.6)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-r-dark" viewBox="0 0 24 24"><g transform="translate(4.56 4.87) scale(.62)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="3 3" stroke-linejoin="round"/></g></symbol>' +
    /* ── the TRAIT glyphs — collectible number-patterns, orthogonal to rarity ── */
    '<symbol id="g-t-solid" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4" transform="rotate(45 12 12)" fill="currentColor" opacity=".16"/><g transform="translate(4.8 5.1) scale(.6)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-t-mirror" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" stroke-width="1.1" opacity=".45"/><g transform="translate(2.2 7.4) scale(.4)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g><g transform="translate(12.2 7.4) scale(.4)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor" opacity=".55"/></g></symbol>' +
    '<symbol id="g-t-ladder" viewBox="0 0 24 24"><g transform="translate(2.4 13.55) scale(.3)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor" opacity=".5"/></g><g transform="translate(7.92 8.09) scale(.34)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor" opacity=".76"/></g><g transform="translate(13.44 2.63) scale(.38)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-t-zenith" viewBox="0 0 24 24"><g transform="translate(6.72 2.94) scale(.44)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g><g fill="currentColor"><circle cx="4.8" cy="19.6" r="1.4"/><circle cx="9.6" cy="19.6" r="1.4"/><circle cx="14.4" cy="19.6" r="1.4"/><circle cx="19.2" cy="19.6" r="1.4" opacity=".5"/></g></symbol>' +
    '<symbol id="g-t-prime" viewBox="0 0 24 24"><path d="M12 2.5 20 7 20 17 12 21.5 4 17 4 7Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><g transform="translate(6.96 7.17) scale(.42)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-t-binary" viewBox="0 0 24 24"><g transform="translate(9.22 6.94) scale(.44)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor" opacity=".48"/></g><g transform="translate(4.22 6.94) scale(.44)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    /* ── the COLLECTION glyphs — the low-number clubs (First 100 … First 100K) ── */
    '<symbol id="g-c-100k" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><g transform="translate(6.24 6.48) scale(.48)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-c-10k" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".6"/><circle cx="12" cy="1.6" r="1.6" fill="currentColor"/><g transform="translate(6.24 6.48) scale(.48)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-c-1k" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".68"/><g fill="currentColor"><circle cx="12" cy="1.6" r="1.7"/><circle cx="3.7" cy="18.2" r="1.4"/><circle cx="20.3" cy="18.2" r="1.4"/></g><g transform="translate(6.24 6.48) scale(.48)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-c-100" viewBox="0 0 24 24"><path d="M7 4a10 10 0 0 0 0 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 4a10 10 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="2.6" r="1.8" fill="currentColor"/><g transform="translate(6.6 7.2) scale(.45)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    /* ── the SACRED glyphs — numbers with mathematical / geometric energy ── */
    '<symbol id="g-t-fib" viewBox="0 0 24 24"><path d="M13 11a1 1 0 0 0-1-1 2 2 0 0 0-2 2 3 3 0 0 0 3 3 5 5 0 0 0 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="10.5" r="1" fill="currentColor"/></symbol>' +
    '<symbol id="g-t-tri" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="8.8" cy="11" r="1.5"/><circle cx="15.2" cy="11" r="1.5"/><circle cx="5.6" cy="17" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="18.4" cy="17" r="1.5"/></g></symbol>' +
    '<symbol id="g-t-perfect" viewBox="0 0 24 24"><path d="M12 2.5 20.2 17 3.8 17Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 21.5 3.8 7 20.2 7Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><g transform="translate(7.8 7.95) scale(.35)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    '<symbol id="g-t-tesla" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/><path d="M12 3.5 19.4 16.5 4.6 16.5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><g fill="currentColor"><circle cx="12" cy="3.5" r="1.7"/><circle cx="19.4" cy="16.5" r="1.7"/><circle cx="4.6" cy="16.5" r="1.7"/></g></symbol>' +
    '<symbol id="g-t-square" viewBox="0 0 24 24"><g fill="currentColor"><circle cx="7" cy="7" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="7" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="12" r="1.5"/><circle cx="7" cy="17" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/></g></symbol>' +
    '<symbol id="g-t-master" viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4.5 4.5v15M19.5 4.5v15"/></g><g transform="translate(6.6 7.2) scale(.45)"><path d="M12 2.6c.5 4.9 4 8.4 8.9 8.9-4.9.5-8.4 4-8.9 8.9-.5-4.9-4-8.4-8.9-8.9C8 11 11.5 7.5 12 2.6z" fill="currentColor"/></g></symbol>' +
    /* ── expansion: Archimedes, Euler, Mersenne, twin primes, sacred frequency ── */
    '<symbol id="g-t-pi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7.5 9h9M9.8 9v6M14.2 9v6"/></g></symbol>' +
    '<symbol id="g-t-euler" viewBox="0 0 24 24"><path d="M4 19C9 19 12 15 13.5 10 15 5 17 3.5 20 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="3.5" r="1.6" fill="currentColor"/></symbol>' +
    '<symbol id="g-t-mersenne" viewBox="0 0 24 24"><path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12 7 17 12 12 17 7 12Z" fill="currentColor"/></symbol>' +
    '<symbol id="g-t-twin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M7 7.5 10.9 9.75 10.9 14.25 7 16.5 3.1 14.25 3.1 9.75Z"/><path d="M17 7.5 20.9 9.75 20.9 14.25 17 16.5 13.1 14.25 13.1 9.75Z"/></g></symbol>' +
    '<symbol id="g-t-resonance" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.3" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M6.5 12a5.5 5.5 0 0 1 11 0" stroke-width="1.4" opacity=".85"/><path d="M3 12a9 9 0 0 1 18 0" stroke-width="1.3" opacity=".5"/></g></symbol>' +
    /* ── GLOW LADDER — rank marks (replaces emoji). Apex → sky → orbit → lit. ── */
    '<symbol id="g-rank-apex" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 19.2c2.2-1.1 4.1-3.4 5.2-6.2" stroke-width="1.5" opacity=".55"/><path d="M5.6 20.2c2.8-1.2 5.4-4.1 6.8-7.6" stroke-width="1.3" opacity=".35"/><path d="M12.2 3.2c.35 3.2 2.7 5.5 5.9 5.9-3.2.35-5.55 2.7-5.9 5.9-.35-3.2-2.7-5.55-5.9-5.9 3.2-.35 5.55-2.7 5.9-5.9z" fill="currentColor" stroke="none"/></g><circle cx="18.4" cy="5.2" r="1.15" fill="currentColor"/></symbol>' +
    '<symbol id="g-rank-sky" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M6.2 16.8 12 7.4 17.8 16.8"/><path d="M8.4 13.2h7.2" opacity=".55"/></g><g fill="currentColor"><circle cx="6.2" cy="16.8" r="1.35"/><circle cx="12" cy="7.4" r="1.55"/><circle cx="17.8" cy="16.8" r="1.35"/></g></symbol>' +
    '<symbol id="g-rank-orbit" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9.2" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.25" transform="rotate(-28 12 12)" opacity=".7"/><path d="M12 7.2c.3 2.4 2.1 4.1 4.5 4.4-2.4.3-4.2 2.1-4.5 4.5-.3-2.4-2.1-4.2-4.5-4.5 2.4-.3 4.2-2.1 4.5-4.4z" fill="currentColor"/><circle cx="19.1" cy="7.6" r="1.2" fill="currentColor"/></symbol>' +
    '<symbol id="g-rank-lit" viewBox="0 0 24 24"><path d="M12 4.2c.28 3.4 2.9 6 6.3 6.3-3.4.28-6 2.9-6.3 6.3-.28-3.4-2.9-6-6.3-6.3 3.4-.28 6-2.9 6.3-6.3z" fill="currentColor" opacity=".92"/><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".55"><path d="M12 2.4v1.5M12 20.1v1.5M2.4 12h1.5M20.1 12h1.5"/></g></symbol>' +
    '</defs></svg>';

  /* Header = the book, left to right as the story reads.
     See the rooms → birth of ₭ → write a star → earn honor → the void → the law.
     DeFi / runes live in the footer (apps on the book, not the node). */
  var NAV = [
    { p: 'home', href: '/', label: 'Explorer' },
    { p: 'blocks', href: '/blocks', label: 'Chain' },
    { p: 'network', href: '/network', label: 'Network' },
    { p: 'land', href: '/land', label: 'Land' },
    { p: 'city', href: '/city', label: 'City' },
    { p: 'library', href: '/library', label: 'Library' },
    { p: 'mind', href: '/mind', label: 'Mind' },
    { p: 'dashboard', href: '/dashboard', label: 'Dashboard' },
    { p: 'mine', href: '/mine', label: 'Donate' },
    { p: 'inscribe', href: '/inscribe', label: 'Inscribe' },
    { p: 'validate', href: '/validate', label: 'Validate' },
    { p: 'rank', href: '/rank', label: 'Rank' },
    { p: 'market', href: '/market', label: 'Market' },
    { p: 'blackhole', href: '/blackhole', label: 'Black hole' },
    { p: 'treasury', href: '/address/KRAY_TREASURY', label: 'Treasury' },
    { p: 'docs', href: '/docs', label: 'Docs' }
  ];

  /* ── helpers on window.KRAY ── */
  var KRAY = window.KRAY = window.KRAY || {};
  KRAY.short = function (a) { a = String(a || ''); return a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-5) : a; };
  KRAY.pairCall = function (name) {
    name = String(name || '').trim();
    return name;
  };
  KRAY.isAmmPot = function (a) { return typeof a === 'string' && a.indexOf('KRAY_AMM_') === 0; };
  KRAY.addrHref = function (a) {
    a = String(a || '');
    if (KRAY.isAmmPot(a)) return '/pool/' + encodeURIComponent(a);
    return '/address/' + encodeURIComponent(a);
  };
  /* A Bitcoin L1 inscription lives on ordinals.com — that is the public L1 door
     (a KRAY tattoo opens /star/<id>, never a second inscription page). Invalid ids return null. */
  KRAY.ordinalsInscriptionUrl = function (id) {
    id = String(id || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}i\d+$/.test(id)) return null;
    return 'https://ordinals.com/inscription/' + encodeURIComponent(id);
  };
  KRAY.poolHref = function (aName, bName, runeId, otherRuneId) {
    if (otherRuneId) {
      return '/pool/' + encodeURIComponent(KRAY.pairCall(aName || runeId)) + '/' + encodeURIComponent(KRAY.pairCall(bName || otherRuneId));
    }
    return '/pool/' + encodeURIComponent(KRAY.pairCall(aName || runeId || ''));
  };
  KRAY.poolTitle = function (aName, bName, rr) {
    if (rr) return KRAY.pairCall(aName) + ' / ' + KRAY.pairCall(bName);
    return '₭ / ' + KRAY.pairCall(aName);
  };
  KRAY.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* ── ACT HUES — /chain constellation + block receipts. One color per kind so
     DeFi, market, runes, Ӿ and ₭ read as different doors. Family is the
     neighborhood; the kind is the exact street. ── */
  KRAY.ACT_FAMILY = {
    'rune-deposit': 'rune', 'rune-send': 'rune', 'rune-exit': 'rune', 'rune-cancel': 'rune',
    'rune-lodge': 'rune', 'rune-settle': 'rune', 'rune-rehome': 'rune',
    'amm-add': 'defi', 'amm-remove': 'defi', 'amm-swap': 'defi',
    'amm-rr-add': 'defi', 'amm-rr-remove': 'defi', 'amm-rr-swap': 'defi',
    'transfer': 'money', 'reward': 'money', 'donate': 'money', 'burn': 'money',
    'x-send': 'fenyx', 'lane-enter': 'fenyx', 'lane-exit': 'fenyx', 'fold-seal': 'fenyx',
    'contract': 'law', 'contract-call': 'law',
    'quantum-commit': 'quantum', 'quantum-migrate': 'quantum',
    'set-face': 'identity', 'clear-face': 'identity', 'set-profile': 'identity', 'set-kray-plate': 'identity',
    'star-like': 'social',
    'transfer-star': 'starmove',
    'star-list': 'market', 'star-delist': 'market', 'star-buy': 'market',
    'star-offer': 'market', 'star-offer-cancel': 'market', 'star-offer-accept': 'market',
  };
  KRAY.ACT_HUE = {
    'amm-add': 0x2dd4bf, 'amm-remove': 0x0f766e, 'amm-swap': 0x5eead4,
    'amm-rr-add': 0x34d399, 'amm-rr-remove': 0x047857, 'amm-rr-swap': 0xa3e635,
    'create-pool': 0xfbbf24,
    'star-list': 0xff6ea8, 'star-delist': 0xa78a96, 'star-buy': 0xff2d8a,
    'star-offer': 0xc4b5fd, 'star-offer-cancel': 0x7c6f8a, 'star-offer-accept': 0xa78bfa,
    'rune-deposit': 0xa78bfa, 'rune-send': 0x8b5cf6, 'rune-exit': 0x6d28d9,
    'rune-cancel': 0x4c1d95, 'rune-lodge': 0xc4b5fd, 'rune-settle': 0x5b21b6, 'rune-rehome': 0x818cf8,
    'transfer': 0x54e0a0, 'donate': 0x86efac, 'reward': 0x4ade80, 'burn': 0xf59e0b,
    'x-send': 0xff3b3b, 'lane-enter': 0xff6b4a, 'lane-exit': 0xff8a7a, 'fold-seal': 0xff5050,
    'contract': 0x5b8def, 'contract-call': 0x93c5fd,
    'quantum-commit': 0xd946ef, 'quantum-migrate': 0xe879f9,
    'transfer-star': 0xe8cd93, 'fire': 0xf5776b,
    'star-like': 0xf472b6,
    'set-face': 0x94a3b8, 'clear-face': 0x64748b, 'set-profile': 0xcbd5e1, 'set-kray-plate': 0xe2e8f0,
  };
  KRAY.actHue = function (kind, opts) {
    opts = opts || {};
    if (opts.family === 'fire') return KRAY.ACT_HUE.fire;
    if (opts.createPool) return KRAY.ACT_HUE['create-pool'];
    if (kind && KRAY.ACT_HUE[kind] != null) return KRAY.ACT_HUE[kind];
    var fam = opts.family || (kind && KRAY.ACT_FAMILY[kind]);
    if (fam === 'defi') return 0x2dd4bf;
    if (fam === 'market') return 0xff6ea8;
    if (fam === 'rune') return 0x8b5cf6;
    if (fam === 'money') return 0x54e0a0;
    if (fam === 'fenyx') return 0xff3b3b;
    if (fam === 'law') return 0x5b8def;
    if (fam === 'quantum') return 0xd946ef;
    if (fam === 'starmove') return 0xe8cd93;
    if (fam === 'social' || fam === 'identity') return 0xf472b6;
    return 0x8b5cf6;
  };
  KRAY.actCss = function (kind, opts) {
    return '#' + ('000000' + KRAY.actHue(kind, opts).toString(16)).slice(-6);
  };
  /* Sink stamps — BURNED 🔥 / FREEZE ❄. A status layer, never the ₭ money symbol (A0).
     Word + emoji live inside one tag so the fire and the ice cannot be mistaken for a token. */
  KRAY.sink = function (kind, word) {
    var burn = kind === 'burn' || kind === 'burned' || kind === 'fire';
    var label = word || (burn ? 'BURNED' : 'FREEZE');
    var emo = burn ? '🔥' : '❄';
    var title = burn
      ? 'Fungible ₭ destroyed in the fire — not a frozen star'
      : 'Star frozen in the black hole — visible, beyond reach';
    return '<span class="sink sink-' + (burn ? 'burn' : 'freeze') + '" title="' + KRAY.esc(title) + '">'
      + KRAY.esc(label) + ' <i aria-hidden="true">' + emo + '</i></span>';
  };
  KRAY.el = function (html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
  KRAY.getJSON = function (url, opts) { return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
  /* kNum / kSuffix — COUNTS (stars, leaves), never a ₭ pile. 1.50K invents a
     decimal ₭ does not have. Money uses kWhole: 1500 → "1,500". */
  KRAY.kSuffix = function (n) { n = Number(n) || 0; var a = Math.abs(n); if (a >= 1e15) return [n / 1e15, 'Q']; if (a >= 1e12) return [n / 1e12, 'T']; if (a >= 1e9) return [n / 1e9, 'B']; if (a >= 1e6) return [n / 1e6, 'M']; if (a >= 1e3) return [n / 1e3, 'K']; return [n, '']; };
  KRAY.kNum = function (v) { var p = KRAY.kSuffix(v), x = p[0], u = p[1]; if (!u) return (Number(v) || 0).toLocaleString(); return (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) + u; };
  KRAY.kWhole = function (v) {
    try { return BigInt(String(v == null ? '0' : v).replace(/[^0-9]/g, '') || '0').toLocaleString(); }
    catch (_) { return String(v); }
  };
  KRAY.age = function (ms) { if (!ms) return ''; var s = Math.max(0, (Date.now() - Number(ms)) / 1000); if (s < 60) return Math.floor(s) + 's'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; };
  /* mempool.space clock: exact UTC second the act was validated, plus a spoken relative. */
  KRAY.clock = function (ms) {
    var n = Number(ms), d = new Date(n);
    if (!n || isNaN(d.getTime())) return '';
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' '
      + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' UTC';
  };
  KRAY.ago = function (ms) {
    var n = Number(ms);
    if (!n || isNaN(n)) return '';
    var s = Math.max(0, Math.floor((Date.now() - n) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + (s === 1 ? ' second ago' : ' seconds ago');
    var m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24);
    if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
    var y = Math.floor(d / 365);
    return y + (y === 1 ? ' year ago' : ' years ago');
  };
  KRAY.whenExact = function (ms) {
    var clock = KRAY.clock(ms), ago = KRAY.ago(ms);
    if (!clock) return '';
    return ago ? (clock + ' · ' + ago) : clock;
  };
  KRAY.addr = function () { return window.__krayAddr || null; };
  /* THE SIGNING GATE — EVERY signed act opens the KrayWallet confirmation popup so the
     person approves the exact message in the extension. The mathematical proof (BIP-340)
     is the STANDARD: there is no silent path here. Falls back to signMessage only if the
     installed wallet lacks the confirm UI. */
  KRAY.sign = async function (message) {
    var w = window.krayWallet;
    if (!w || !w.signMessage) throw new Error('KrayWallet not found — install the extension to sign.');
    var fn = typeof w.signMessageWithConfirmation === 'function' ? w.signMessageWithConfirmation : w.signMessage;
    var raw = await fn.call(w, message);
    return (raw && raw.signature) || raw;
  };

  /* THE ONE SIGNED-ACTION PATH — prepare (node builds the exact message) → sign
     (KrayWallet popup, the key never leaves it) → submit (BIP-340 verified). Every
     action page calls this; the flow is byte-identical to the original inscribe. */
  KRAY.act = async function (action, fields, opts) {
    opts = opts || {};
    var me = window.__krayAddr;
    // the page may have loaded before the wallet restored — try a silent re-read
    // of the connected account before giving up, so signing never falsely fails.
    if (!me && window.krayWallet && window.krayWallet.getAccounts) {
      try { await KRAY.netReady; var a = await window.krayWallet.getAccounts(); var list = Array.isArray(a) ? a : (a && a.accounts) || []; if (list.length) { me = toNodeAddr(list[0]); window.__krayAddr = me; paintWallet(me); } } catch (_) {}
    }
    if (!me) throw new Error('Connect your KrayWallet first — click “Connect KrayWallet” in the header.');
    if (!(window.krayWallet && window.krayWallet.signMessage)) throw new Error('KrayWallet not found — install the extension to sign.');
    var body = Object.assign({ action: action, from: me }, fields || {});
    if (opts.onstep) opts.onstep('preparing — the node builds the exact message to sign…');
    var pr = await fetch('/api/kraynet/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    var prep = await pr.json(); if (!pr.ok || prep.error) throw new Error(prep.error || 'prepare refused');
    if (opts.onstep) opts.onstep('approve in your KrayWallet — confirm the exact message in the popup…');
    var sig = await KRAY.sign(prep.message); // confirmation popup, never a silent sign
    var pub = window.__krayPub;
    if (!pub) { var p = await window.krayWallet.getPublicKey(); pub = (p && p.publicKey) || p; window.__krayPub = pub; }
    var sub = Object.assign({}, body, { nonce: prep.nonce, publicKey: pub, signature: (sig && sig.signature) || sig });
    if (prep.clock != null) sub.clock = prep.clock;
    // Echo the star ONLY when the caller targeted an EXISTING star (sendstar, or adding name/content to a star
    // you own). For a NEW creation prep.star is merely the PREVIEW of the next birth number — echoing it back
    // is read as onstar=<n>, so the node rebuilds a different message than the one signed (…|onstar=n vs none)
    // and the BIP-340 check refuses it. body.star present == a specific star was meant; absent == a fresh birth.
    if (prep.star != null && body.star != null) sub.star = prep.star;
    if (opts.onstep) opts.onstep('sealing into the next fast block…');
    var sr = await fetch('/api/kraynet/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
    var res = await sr.json(); if (!sr.ok || res.error) throw new Error(res.error || 'refused');
    return res;
  };

  /* KRAY Social like — journal kind star-like (β′). Fee 1 → Treasury always.
     tipAsset: none | kray | x | rune. tipAmount required when tip ≠ none.
     Never mints Ӿ. Living owner resolved at prepare/apply. */
  KRAY.likeStar = async function (star, tipAmount, opts) {
    opts = opts || {}
    var n = String(star == null ? '' : star).trim()
    if (!/^\d+$/.test(n)) throw new Error('star must be a whole number')
    var tip = opts.tipAsset != null ? String(opts.tipAsset) : null
    if (tip == null) {
      // Legacy: second arg as tip ₭ (positive) or 0 / empty ⇒ fee-only.
      var legacy = tipAmount == null ? '0' : String(tipAmount).trim().replace(/[,\s]/g, '')
      if (legacy === '' || legacy === '0') tip = 'none'
      else tip = 'kray'
      tipAmount = legacy === '' ? '0' : legacy
    }
    if (tip !== 'none' && tip !== 'kray' && tip !== 'x' && tip !== 'rune') {
      throw new Error('tipAsset must be none, kray, x, or rune')
    }
    var fields = { star: n }
    if (tip === 'none') {
      fields.tipAsset = 'none'
    } else {
      var amt = String(tipAmount == null ? '' : tipAmount).trim().replace(/[,\s]/g, '')
      if (!/^\d+$/.test(amt) || BigInt(amt) < 1n) throw new Error('tip must be a whole amount ≥ 1')
      fields.tipAsset = tip
      fields.amount = amt
      if (tip === 'rune') {
        var rid = opts.runeId != null ? String(opts.runeId).trim() : ''
        if (!rid) throw new Error('rune tip needs runeId')
        fields.runeId = rid
      }
    }
    if (opts.onstep) opts.onstep('preparing star-like…')
    return KRAY.act('star-like', fields, opts)
  };

  /** Outline heart — filled red by CSS when .is-liked. */
  KRAY.HEART_SVG = '<svg class="sl-heart" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12.1 21.35l-1.1-1C5.14 14.24 2 11.39 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.89-3.14 6.74-8.9 12.85l-1 1z"/>'
    + '</svg>';
  /** Journal face for the social space. Counts from the derived book; ₭ never invented. */
  KRAY.socialFace = function (soc, history) {
    soc = soc || {};
    var likes = Number(soc.count) || 0;
    var fees = String(soc.fees || '0');
    var tipKray = String(soc.tipKray || '0');
    var tipX = String(soc.tipX || '0');
    var tipCount = soc.tipCount != null ? Number(soc.tipCount) : null;
    var feeOnly = soc.feeOnly != null ? Number(soc.feeOnly) : null;
    if ((tipCount == null || feeOnly == null) && Array.isArray(history)) {
      var ev = history.filter(function (e) { return e && e.kind === 'star-like'; });
      var tagged = ev.some(function (e) { return e.tipAsset != null; });
      var noTipMoney = tipKray === '0' && tipX === '0';
      if ((tagged || noTipMoney) && (ev.length === likes || likes === 0)) {
        var tips = 0;
        var feesN = 0;
        ev.forEach(function (e) {
          if (e.tipAsset && e.tipAsset !== 'none') tips++;
          else feesN++;
        });
        if (tipCount == null) tipCount = tips;
        if (feeOnly == null) feeOnly = feesN;
      }
    }
    if (feeOnly == null) feeOnly = likes;
    var energyKray = '0';
    try { energyKray = (BigInt(fees) + BigInt(tipKray)).toString(); } catch (_) { energyKray = fees; }
    return {
      likes: likes, fees: fees, tipKray: tipKray, tipX: tipX,
      tipCount: tipCount, feeOnly: feeOnly, energyKray: energyKray,
      tipRunes: soc.tipRunes || {},
    };
  };
  KRAY.kraySatsToUsd = function (kray, btcUsd) {
    var n = Number(kray);
    var px = Number(btcUsd);
    if (!(n >= 0) || !(px > 0) || !isFinite(n) || !isFinite(px)) return '';
    var usd = (n * px) / 1e8;
    if (usd === 0) return '$0';
    if (usd < 0.01) return '<$0.01';
    if (usd < 1000) return '$' + usd.toFixed(2);
    return '$' + usd.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  KRAY.fetchBtcUsd = function () {
    if (KRAY._btcUsd > 0 && (Date.now() - (KRAY._btcUsdAt || 0) < 60000)) {
      return Promise.resolve(KRAY._btcUsd);
    }
    return fetch('/api/kraynet/btc-price').then(function (r) { return r.json(); }).then(function (j) {
      var u = Number(j && j.usd) || 0;
      KRAY._btcUsd = u;
      KRAY._btcUsdAt = Date.now();
      return u;
    }).catch(function () { return 0; });
  };

  /* ── MARKUP STARS (HTML + Markdown) ────────────────────────────────────────
     Bytes stay sealed as inscribed. Presentation only: source is textContent
     (never parsed as markup). HTML runs in the existing /render cage. Markdown
     is escaped first, then formatted into a srcdoc iframe with sandbox="" —
     no scripts, no raw HTML passthrough (a <script> in a .md file stays text).
     RECURSION (the ordinals way, inside KRAY): ![...](/content/<hash>) embeds
     ANOTHER star's sealed bytes — image, gif, video or audio — and
     ![...](/l1content/<id>iN) embeds a Bitcoin L1 ordinal through this node's
     own ord. The element follows the star's REAL content type, resolved from
     this node before rendering. Protocol / CSP / /render door are unchanged. */
  KRAY.isHtml = function (ct) { return /^text\/html/i.test(String(ct || '')); };
  KRAY.isMarkdown = function (ct) {
    ct = String(ct || '').toLowerCase();
    return /markdown/.test(ct) || /^text\/(x-)?md\b/.test(ct);
  };
  KRAY.isMarkup = function (ct) { return KRAY.isHtml(ct) || KRAY.isMarkdown(ct); };

  function mdSafeHref(href) {
    href = String(href || '').trim();
    if (/^(https?:\/\/|\/)/i.test(href) && !/[\s"'<>]/.test(href) && !/^javascript:/i.test(href)) return href;
    return '';
  }
  function mdInline(escaped, typeOf) {
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, href) {
      var u = mdSafeHref(href); if (!u) return alt;
      // the embed's element follows the star's REAL content type (typeOf is built from
      // this node's own headers) — a video star gets a player, not a broken <img>
      var kind = typeOf ? typeOf(u) : '';
      if (kind === 'video') return '<video controls playsinline preload="metadata" src="' + u + '"></video>';
      if (kind === 'audio') return '<audio controls preload="metadata" src="' + u + '"></audio>';
      return '<img alt="' + alt + '" src="' + u + '">';
    });
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      var u = mdSafeHref(href); return u ? '<a href="' + u + '" rel="noopener noreferrer">' + label + '</a>' : label;
    });
    return escaped;
  }
  KRAY.mdToSafeHtml = function (src, typeOf) {
    var raw = String(src || '').replace(/\r\n/g, '\n');
    var fences = [];
    raw = raw.replace(/```[^\n]*\n([\s\S]*?)```/g, function (_, code) {
      fences.push('<pre><code>' + KRAY.esc(code.replace(/\n$/, '')) + '</code></pre>');
      return '\n%%FENCE' + (fences.length - 1) + '%%\n';
    });
    var lines = raw.split('\n'), out = [], p = [], i = 0;
    function flushP() { if (p.length) { out.push('<p>' + mdInline(KRAY.esc(p.join(' ')), typeOf) + '</p>'); p = []; } }
    while (i < lines.length) {
      var line = lines[i], fm = line.match(/^%%FENCE(\d+)%%$/);
      // guard: a LITERAL %%FENCEn%% line in user text (no captured fence) must not print "undefined"
      if (fm && fences[Number(fm[1])] != null) { flushP(); out.push(fences[Number(fm[1])]); i++; continue; }
      if (/^\s*$/.test(line)) { flushP(); i++; continue; }
      var hm = line.match(/^(#{1,6})\s+(.+)$/);
      if (hm) { flushP(); out.push('<h' + hm[1].length + '>' + mdInline(KRAY.esc(hm[2]), typeOf) + '</h' + hm[1].length + '>'); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushP(); out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(line)) {
        flushP();
        var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + mdInline(KRAY.esc(q.join(' ')), typeOf) + '</blockquote>');
        continue;
      }
      var ul = /^[-*+]\s+/.test(line), ol = /^\d+\.\s+/.test(line);
      if (ul || ol) {
        flushP();
        var re = ol ? /^\d+\.\s+/ : /^[-*+]\s+/, items = [];
        while (i < lines.length && re.test(lines[i])) { items.push('<li>' + mdInline(KRAY.esc(lines[i].replace(re, '')), typeOf) + '</li>'); i++; }
        out.push((ol ? '<ol>' : '<ul>') + items.join('') + (ol ? '</ol>' : '</ul>'));
        continue;
      }
      p.push(line); i++;
    }
    flushP();
    return out.join('');
  };
  /* resolve the REAL content type of every recursive embed before rendering, so the
     stage can host any star. Only this node's two content doors are ever probed
     (/content/<sha256> and /l1content/<id>iN) — an external URL is never fetched here.
     The doors are GET-only, so we read the headers and cancel the body stream. */
  KRAY.mdMediaTypes = function (src) {
    var re = /!\[[^\]]*\]\(\s*(\/(?:content\/[0-9a-f]{64}|l1content\/[0-9a-f]{64}i\d+))\s*\)/g;
    var refs = [], m;
    while ((m = re.exec(String(src || ''))) !== null) { if (refs.indexOf(m[1]) < 0 && refs.length < 32) refs.push(m[1]); }
    return Promise.all(refs.map(function (u) {
      return fetch(u).then(function (r) {
        try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { /* stream already closed — headers are all we need */ }
        var ct = String(r.headers.get('content-type') || '');
        return /^video\//i.test(ct) ? [u, 'video'] : /^audio\//i.test(ct) ? [u, 'audio'] : null;
      }).catch(function () { return null; });  // unreachable ref → default <img>, honest broken tile
    })).then(function (pairs) {
      var map = {};
      pairs.forEach(function (pr) { if (pr) map[pr[0]] = pr[1]; });
      return function (u) { return map[u] || ''; };
    });
  };
  // the reading room — same dark tokens as the explorer (an iframe cannot reach the
  // parent's CSS variables, so the values are inlined), typography on the 8pt scale.
  // ONE style, two mounts: the srcdoc iframe on the star page and the /render full page.
  var MD_STYLE = 'html{background:#08090a}body{margin:0 auto;max-width:72ch;padding:32px 24px 48px;background:#08090a;color:#c9ccd6;'
      + 'font:16px/1.7 -apple-system,"SF Pro Text","Inter",system-ui,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}'
      + 'h1,h2,h3,h4,h5,h6{color:#f4f5fa;line-height:1.25;letter-spacing:-.02em;margin:32px 0 12px}'
      + 'h1{font-size:32px;margin-top:8px}h2{font-size:24px}h3{font-size:19px}'
      + 'h1+p,h2+p{margin-top:0}p,ul,ol,blockquote,pre{margin:0 0 16px}li{margin:0 0 4px}'
      + 'strong{color:#f4f5fa}em{color:#e2e4ec}'
      + 'pre,code{font-family:"SF Mono","IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:13px}'
      + 'code{background:#141518;border:1px solid rgba(255,255,255,.075);border-radius:4px;padding:1px 5px}'
      + 'pre{padding:16px;background:#0e0f11;border:1px solid rgba(255,255,255,.075);overflow:auto;border-radius:10px;line-height:1.55}'
      + 'pre code{background:none;border:0;padding:0}'
      + 'blockquote{border-left:3px solid #f7931a;padding:4px 20px;margin-left:0;color:#e2e4ec;background:rgba(247,147,26,.05);border-radius:0 10px 10px 0}'
      + 'a{color:#ffb454;text-decoration:none;border-bottom:1px solid rgba(247,147,26,.35)}a:hover{color:#f7931a}'
      + 'hr{border:0;height:1px;background:rgba(255,255,255,.13);margin:32px auto;max-width:200px}'
      + 'img,video{max-width:100%;height:auto;display:block;margin:24px auto;border-radius:10px}'
      + 'audio{display:block;width:100%;margin:24px auto}';
  KRAY.mdDoc = function (inner) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>' + MD_STYLE + '</style></head><body>' + inner + '</body></html>';
  };
  /* the /render/<hash> READING ROOM — a bare shell (server-injected data-mdview) whose only
     job is: fetch the SEALED bytes from /content, sanitize them to inert markup, mount.
     The star's bytes never execute: the only script on the page is this file, and the
     shell's CSP (script-src 'self', no inline/eval) is the second bar of that cage. */
  function mountMdView(hash) {
    fetch('/content/' + hash)
      .then(function (r) { if (!r.ok) throw new Error('not held'); return r.text(); })
      .then(function (t) {
        return KRAY.mdMediaTypes(t).then(function (typeOf) {
          var st = document.createElement('style'); st.textContent = MD_STYLE; document.head.appendChild(st);
          document.body.innerHTML = KRAY.mdToSafeHtml(t, typeOf);
        });
      })
      .catch(function () { document.body.textContent = '(content not held by this node)'; });
  }
  KRAY.wireMarkupStage = function (box, url, ct, opts) {
    opts = opts || {};
    var html = KRAY.isHtml(ct);
    if (opts.mini) {
      box.innerHTML = html ? '<span class="ptag">❰❱ html</span>' : '<span class="ptag">¶ md</span>';
      return;
    }
    var runbtn = null, running = false;
    function showSource() {
      running = false; box.innerHTML = '';
      var srcpre = document.createElement('pre'); srcpre.className = 'psource'; srcpre.textContent = '…';
      box.appendChild(srcpre);
      fetch(url).then(function (r) { return r.text(); }).then(function (t) { srcpre.textContent = t; })
        .catch(function () { srcpre.textContent = '(content not held by this node)'; });
      if (runbtn) runbtn.textContent = html ? 'Run HTML' : 'Render Markdown';
    }
    function showRender() {
      running = true; box.innerHTML = '';
      var fr = document.createElement('iframe');
      if (html) {
        fr.setAttribute('sandbox', 'allow-scripts');
        fr.src = String(url).replace('/content/', '/render/');
        fr.title = 'sandboxed HTML star';
      } else {
        fr.setAttribute('sandbox', '');
        fr.title = 'rendered Markdown star';
        fetch(url).then(function (r) { return r.text(); })
          .then(function (t) { return KRAY.mdMediaTypes(t).then(function (typeOf) { fr.srcdoc = KRAY.mdDoc(KRAY.mdToSafeHtml(t, typeOf)); }); })
          .catch(function () { fr.srcdoc = '<p>(content not held by this node)</p>'; });
      }
      box.appendChild(fr);
      if (runbtn) runbtn.textContent = 'View source';
    }
    var bar = document.getElementById(opts.barId || 'html-bar');
    if (bar) {
      // rebuilt on EVERY call — adopting an existing button would keep the PREVIOUS star's
      // closures alive (stale showSource/showRender), the classic re-wire trap
      bar.innerHTML = '';
      runbtn = document.createElement('button');
      runbtn.className = 'btn'; runbtn.type = 'button'; runbtn.id = 'html-run';
      runbtn.textContent = html ? 'Run HTML' : 'Render Markdown';
      var note = document.createElement('span');
      note.className = 'html-bar-note';
      note.textContent = html ? 'sandboxed · this node only' : 'formatted · scripts stripped';
      runbtn.addEventListener('click', function () { if (running) showSource(); else showRender(); });
      var openfull = document.createElement('a');
      openfull.className = 'html-bar-note'; openfull.target = '_blank'; openfull.rel = 'noopener noreferrer';
      openfull.href = String(url).replace('/content/', '/render/');
      openfull.textContent = 'open full page ↗';
      bar.appendChild(runbtn); bar.appendChild(note); bar.appendChild(openfull);
    }
    showSource();
  };

  /* ── THE FROZEN PORTRAIT — one law for every content thumbnail on the site ──
     Every tile / hero / mini shows a LOCKED, inert postcard of the star's real
     bytes: markdown as a rendered miniature (escape-first, never scripts),
     html / code / text as a source page (textContent, never parsed), pdf as its
     frozen first page through the /render door, images and video as themselves.
     pointer-events:none — the click belongs to the tile underneath. Styles live
     in kray.css (.kv-*). Full-size stages stay each page's richer own. */
  KRAY.previewKindOf = function (ct) {
    ct = String(ct || '');
    if (/^image\//i.test(ct)) return 'image';
    if (/^video\//i.test(ct)) return 'video';
    if (/^audio\//i.test(ct)) return 'audio';
    if (KRAY.isMarkdown(ct)) return 'md';
    if (/^application\/pdf\b/i.test(ct)) return 'pdf';
    if (/^text\/plain\b/i.test(ct)) return 'txt';       // a written post — the LETTER template
    if (KRAY.isHtml(ct) || /^text\//i.test(ct) || /json|javascript|ecmascript|typescript|xml|csv|yaml|x-(sh|python|java|c|perl|ruby|php|go|rust)\b/i.test(ct)) return 'src';
    return null;
  };
  // the editor-chrome label a source page wears (⌘ javascript, { } json, ❰❱ html…)
  function kvCodeLabel(ct) {
    ct = String(ct || '');
    if (/json/i.test(ct)) return '{ } json';
    if (/javascript|ecmascript/i.test(ct)) return '⌘ javascript';
    if (/typescript/i.test(ct)) return '⌘ typescript';
    if (KRAY.isHtml(ct)) return '❰❱ html · source';
    if (/xml/i.test(ct)) return '❰❱ xml';
    if (/python/i.test(ct)) return '⌘ python';
    if (/csv/i.test(ct)) return '⛁ csv';
    if (/yaml/i.test(ct)) return '⛁ yaml';
    return '⌘ ' + (ct.split('/')[1] || 'code').replace(/^x-/, '');
  }
  KRAY.coverUrlOf = function (contentUrl) {
    var m = String(contentUrl || '').match(/\/content\/([0-9a-f]{64})$/);
    return m ? '/cover/' + m[1] : null;
  };

  /* ── SHELVES — mirror of protocol/library.ts categoryOf. Presentation only.
     Unknown type → file (◇). The pencil is the ACT, never the work's fallback. ── */
  KRAY.CATEGORIES = [
    { id: 'image', label: 'Image', glyph: '▣', symbol: 'g-cat-image' },
    { id: 'vector', label: 'Vector', glyph: '◈', symbol: 'g-cat-vector' },
    { id: 'video', label: 'Video', glyph: '▶', symbol: 'g-cat-video' },
    { id: 'audio', label: 'Audio', glyph: '♪', symbol: 'g-music' },
    { id: 'code', label: 'Code', glyph: '⌘', symbol: 'g-cat-code' },
    { id: 'markup', label: 'Markup', glyph: '❰', symbol: 'g-cat-markup' },
    { id: 'document', label: 'Document', glyph: '▤', symbol: 'g-cat-document' },
    { id: 'data', label: 'Data', glyph: '⛁', symbol: 'g-cat-data' },
    { id: 'text', label: 'Text', glyph: '¶', symbol: 'g-cat-text' },
    { id: 'model', label: '3D', glyph: '◉', symbol: 'g-cat-model' },
    { id: 'font', label: 'Font', glyph: 'A', symbol: 'g-cat-font' },
    { id: 'archive', label: 'Archive', glyph: '▦', symbol: 'g-cat-archive' },
    { id: 'file', label: 'File', glyph: '◇', symbol: 'g-cat-file' }
  ];
  KRAY.SHELF = { law: '⚖', name: '✦' };
  KRAY.CATEGORIES.forEach(function (c) { KRAY.SHELF[c.id] = c.glyph; });
  var _CODE = { 'application/javascript': 1, 'text/javascript': 1, 'application/typescript': 1, 'text/typescript': 1, 'application/x-python-code': 1, 'text/x-python': 1, 'text/x-c': 1, 'text/x-c++': 1, 'text/x-rust': 1, 'text/x-go': 1, 'text/x-java': 1, 'text/x-sh': 1, 'application/x-sh': 1, 'text/x-lua': 1, 'application/wasm': 1, 'text/x-solidity': 1, 'application/x-ruby': 1, 'text/x-sql': 1 };
  var _DATA = { 'application/json': 1, 'application/ld+json': 1, 'text/csv': 1, 'application/x-ndjson': 1, 'application/cbor': 1, 'application/toml': 1, 'text/yaml': 1, 'application/yaml': 1, 'text/tab-separated-values': 1 };
  var _MARK = { 'text/html': 1, 'text/css': 1, 'application/xml': 1, 'text/xml': 1, 'image/svg+xml': 1 };
  var _DOC = { 'application/pdf': 1, 'application/epub+zip': 1, 'application/rtf': 1, 'application/msword': 1 };
  var _ARC = { 'application/zip': 1, 'application/gzip': 1, 'application/x-tar': 1, 'application/x-7z-compressed': 1 };
  var _MOD = { 'model/gltf+json': 1, 'model/gltf-binary': 1, 'model/obj': 1, 'model/stl': 1, 'application/sla': 1 };
  KRAY.categoryOf = function (ct) {
    var t = String(ct || '').trim().toLowerCase().split(';')[0];
    if (!t) return 'file';
    if (t === 'image/svg+xml') return 'vector';
    if (t.indexOf('image/') === 0) return 'image';
    if (t.indexOf('video/') === 0) return 'video';
    if (t.indexOf('audio/') === 0) return 'audio';
    if (t.indexOf('font/') === 0 || t === 'application/font-woff' || t === 'application/vnd.ms-fontobject') return 'font';
    if (t.indexOf('model/') === 0 || _MOD[t]) return 'model';
    if (_CODE[t]) return 'code';
    if (_DATA[t]) return 'data';
    if (_MARK[t]) return 'markup';
    if (_DOC[t]) return 'document';
    if (_ARC[t]) return 'archive';
    if (t === 'text/markdown' || t === 'text/plain' || t.indexOf('text/') === 0) return 'text';
    return 'file';
  };
  KRAY.categorySpec = function (id) {
    for (var i = 0; i < KRAY.CATEGORIES.length; i++) if (KRAY.CATEGORIES[i].id === id) return KRAY.CATEGORIES[i];
    return KRAY.CATEGORIES[KRAY.CATEGORIES.length - 1];
  };
  KRAY.shelfGlyph = function (cat) { return KRAY.categorySpec(cat).symbol; };
  /* Face of a sealed work in a list. Bytes when we have them; else the shelf mark.
     file / ◇ is the last floor. Never the pencil. No players in lists. */
  KRAY.workFace = function (t) {
    t = t || {};
    var spec = KRAY.categorySpec(KRAY.categoryOf(t.contentType));
    var face = { category: spec.id, label: spec.label, mark: spec.glyph, glyph: spec.symbol, src: null, href: '/tx/' + (t.hash || ''), play: false };
    var hash = t.contentHash;
    if (!hash) return face;
    if (spec.id === 'audio') { face.src = '/cover/' + hash; face.href = '/render/' + hash; face.play = true; return face; }
    if (spec.id === 'image' || spec.id === 'vector') { face.src = '/content/' + hash; return face; }
    if (spec.id === 'video') { face.play = true; return face; }
    return face;
  };
  /* The star's number, written as itself — ★ 23, never #23.
     That number IS the inscription number when the star is written:
     birth order, how old it is. Baptism never hides it. */
  KRAY.starMark = function (n) {
    var v = Number(n);
    return '★ ' + (Number.isFinite(v) ? v.toLocaleString() : String(n == null ? '' : n));
  };
  /* Glow ladder glyph id — apex (#1) · sky (≤3) · orbit (≤10) · lit (rest). */
  KRAY.glowRankGlyphId = function (rank) {
    rank = Number(rank);
    if (rank === 1) return 'g-rank-apex';
    if (rank > 0 && rank <= 3) return 'g-rank-sky';
    if (rank > 0 && rank <= 10) return 'g-rank-orbit';
    return 'g-rank-lit';
  };
  KRAY.glowRankGlyphHtml = function (rank, px) {
    px = px || 16;
    var id = KRAY.glowRankGlyphId(rank);
    return '<svg class="rank-ico" width="' + px + '" height="' + px + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  };
  /* Title on a card: ★ N always, name beside it when baptised. Plain text. */
  KRAY.starTitle = function (t) {
    t = t || {};
    var star = t.star != null ? t.star : t.no;
    var name = String(t.name || (t.baptism && t.baptism.name) || '').trim();
    var mark = KRAY.starMark(star);
    return name ? mark + ' · ' + name : mark;
  };
  /* What the star actually holds — name, content, both, or neither.
     Buy/sell reads this: a baptism is not an inscription. */
  KRAY.starKindOf = function (t) {
    t = t || {};
    var name = String(t.name || (t.baptism && t.baptism.name) || '').trim();
    var hasContent = !!(t.contentHash || t.media || t.url
      || (t.inscription && (t.inscription.url || t.inscription.contentHash)));
    if (name && !hasContent) return 'named';
    if (!name && hasContent) return 'inscribed';
    if (name && hasContent) return 'whole';
    return 'bare';
  };
  KRAY.kindLabel = function (kind) {
    return ({
      named: 'name only · no content',
      inscribed: 'unnamed · has content',
      whole: 'named · has content',
      bare: 'star only'
    })[kind] || '';
  };
  KRAY.kindChipHtml = function (t) {
    var kind = KRAY.starKindOf(t);
    var lab = KRAY.kindLabel(kind);
    if (!lab) return '';
    return '<span class="skind skind--' + kind + '" title="' + KRAY.esc(lab) + '">' + KRAY.esc(lab) + '</span>';
  };
  /* ★ N centered — only when the square has no sealed bytes. */
  KRAY.starMarkPlate = function (t) {
    t = t || {};
    var star = t.star != null ? t.star : t.no;
    var mark = KRAY.starMark(star);
    return '<span class="kv-mark">' + KRAY.esc(mark) + '</span>';
  };

  /* ── CITIZEN SIGIL — sacred-geometry constellation fallback ───────────────
     Deterministic portrait from any address/seed. Da Vinci echo (Vitruvian
     rings + golden ratio) over deep space + constellation unique to the seed.
     Replaces DiceBear-style blocks. CSP-safe data URI (img-src 'self' data:). */
  KRAY.citizenSigilSrc = function (seed, size) {
    seed = String(seed == null ? '' : seed);
    size = size || 512;
    var h = 2166136261 >>> 0;
    for (var i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var rnd = (function (a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(h || 1);

    var PHI = 1.6180339887;
    var TAU = Math.PI * 2;
    var hue = Math.floor(rnd() * 360);
    var hue2 = (hue + 28 + Math.floor(rnd() * 50)) % 360;
    var accent = 'hsl(' + hue + ',62%,62%)';
    var accent2 = 'hsl(' + hue2 + ',48%,72%)';
    var ink = 'rgba(244,245,250,0.88)';
    var dim = 'rgba(244,245,250,0.18)';
    var faint = 'rgba(244,245,250,0.08)';
    var S = size, cx = S / 2, cy = S / 2;
    var rMax = S * 0.42;
    var parts = [];
    var uid = 'cs' + (h >>> 0).toString(16);

    parts.push('<defs>');
    parts.push('<radialGradient id="' + uid + 'g" cx="38%" cy="32%" r="72%">'
      + '<stop offset="0%" stop-color="hsl(' + hue + ',40%,18%)"/>'
      + '<stop offset="55%" stop-color="hsl(' + ((hue + 200) % 360) + ',28%,7%)"/>'
      + '<stop offset="100%" stop-color="#020308"/>'
      + '</radialGradient>');
    parts.push('<radialGradient id="' + uid + 'core" cx="50%" cy="50%" r="50%">'
      + '<stop offset="0%" stop-color="' + accent2 + '" stop-opacity=".55"/>'
      + '<stop offset="100%" stop-color="' + accent + '" stop-opacity="0"/>'
      + '</radialGradient>');
    parts.push('<filter id="' + uid + 'glow" x="-40%" y="-40%" width="180%" height="180%">'
      + '<feGaussianBlur stdDeviation="' + (S * 0.012).toFixed(2) + '" result="b"/>'
      + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
      + '</filter>');
    parts.push('</defs>');

    // Deep space canvas
    parts.push('<rect width="' + S + '" height="' + S + '" fill="#020308"/>');
    parts.push('<rect width="' + S + '" height="' + S + '" fill="url(#' + uid + 'g)"/>');

    // Soft nebula blobs
    var blobs = 2 + Math.floor(rnd() * 2);
    for (var b = 0; b < blobs; b++) {
      var bx = S * (0.2 + rnd() * 0.6), by = S * (0.2 + rnd() * 0.6);
      var br = S * (0.12 + rnd() * 0.18);
      parts.push('<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="' + br.toFixed(1)
        + '" fill="hsl(' + ((hue + b * 40) % 360) + ',45%,40%)" opacity="' + (0.06 + rnd() * 0.08).toFixed(3) + '"/>');
    }

    // Field stars
    var field = 28 + Math.floor(rnd() * 24);
    for (var s = 0; s < field; s++) {
      var sx = rnd() * S, sy = rnd() * S;
      var sr = (0.4 + rnd() * 1.6) * (S / 512);
      var so = 0.25 + rnd() * 0.7;
      parts.push('<circle cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + sr.toFixed(2)
        + '" fill="' + ink + '" opacity="' + so.toFixed(3) + '"/>');
    }

    // Vitruvian / sacred rings (golden ratio radii)
    var rings = [rMax / (PHI * PHI), rMax / PHI, rMax, rMax * PHI * 0.72];
    for (var ri = 0; ri < rings.length; ri++) {
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + rings[ri].toFixed(2)
        + '" fill="none" stroke="' + (ri === 2 ? dim : faint) + '" stroke-width="'
        + (S * (ri === 2 ? 0.0035 : 0.002)).toFixed(2) + '"/>');
    }

    // Rotated polygon — sides 5..8 (pentagon → octagon)
    var sides = 5 + Math.floor(rnd() * 4);
    var rot = rnd() * TAU;
    var polyR = rMax * (0.72 + rnd() * 0.18);
    var poly = [];
    for (var p = 0; p < sides; p++) {
      var a = rot + (TAU * p) / sides - Math.PI / 2;
      poly.push([(cx + Math.cos(a) * polyR).toFixed(2), (cy + Math.sin(a) * polyR).toFixed(2)]);
    }
    parts.push('<polygon points="' + poly.map(function (pt) { return pt.join(','); }).join(' ')
      + '" fill="none" stroke="' + accent + '" stroke-opacity=".42" stroke-width="'
      + (S * 0.003).toFixed(2) + '"/>');
    // Inner dual (rotated half-step) — vesica echo
    var poly2 = [];
    for (var p2 = 0; p2 < sides; p2++) {
      var a2 = rot + TAU / (sides * 2) + (TAU * p2) / sides - Math.PI / 2;
      var r2 = polyR / PHI;
      poly2.push([(cx + Math.cos(a2) * r2).toFixed(2), (cy + Math.sin(a2) * r2).toFixed(2)]);
    }
    parts.push('<polygon points="' + poly2.map(function (pt) { return pt.join(','); }).join(' ')
      + '" fill="none" stroke="' + accent2 + '" stroke-opacity=".28" stroke-width="'
      + (S * 0.0022).toFixed(2) + '"/>');

    // Flower-of-life arcs (6 petals around center)
    var petalR = rMax / PHI;
    var petalN = 6;
    var petalRot = rot * 0.5;
    for (var pet = 0; pet < petalN; pet++) {
      var pa = petalRot + (TAU * pet) / petalN;
      var px = cx + Math.cos(pa) * (petalR * 0.55);
      var py = cy + Math.sin(pa) * (petalR * 0.55);
      parts.push('<circle cx="' + px.toFixed(2) + '" cy="' + py.toFixed(2) + '" r="' + (petalR * 0.55).toFixed(2)
        + '" fill="none" stroke="' + dim + '" stroke-width="' + (S * 0.0018).toFixed(2) + '"/>');
    }

    // Constellation — bright nodes on a ring, unique edges
    var nodes = 5 + Math.floor(rnd() * 5);
    var constR = rMax * (0.55 + rnd() * 0.28);
    var stars = [];
    for (var n = 0; n < nodes; n++) {
      var na = rot + (TAU * n) / nodes + (rnd() - 0.5) * 0.35;
      var nr = constR * (0.82 + rnd() * 0.28);
      stars.push({ x: cx + Math.cos(na) * nr, y: cy + Math.sin(na) * nr, w: 0.7 + rnd() });
    }
    // Connect each to next + a few chords (deterministic graph)
    for (var e = 0; e < stars.length; e++) {
      var aN = stars[e], bN = stars[(e + 1) % stars.length];
      parts.push('<line x1="' + aN.x.toFixed(2) + '" y1="' + aN.y.toFixed(2)
        + '" x2="' + bN.x.toFixed(2) + '" y2="' + bN.y.toFixed(2)
        + '" stroke="' + accent + '" stroke-opacity=".55" stroke-width="'
        + (S * 0.0025).toFixed(2) + '"/>');
    }
    var chords = 1 + Math.floor(rnd() * 3);
    for (var c = 0; c < chords; c++) {
      var i1 = Math.floor(rnd() * stars.length);
      var i2 = (i1 + 2 + Math.floor(rnd() * (stars.length - 3))) % stars.length;
      if (i1 === i2) continue;
      parts.push('<line x1="' + stars[i1].x.toFixed(2) + '" y1="' + stars[i1].y.toFixed(2)
        + '" x2="' + stars[i2].x.toFixed(2) + '" y2="' + stars[i2].y.toFixed(2)
        + '" stroke="' + accent2 + '" stroke-opacity=".32" stroke-width="'
        + (S * 0.0018).toFixed(2) + '" stroke-dasharray="' + (S * 0.012).toFixed(1) + ' ' + (S * 0.008).toFixed(1) + '"/>');
    }
    for (var ns = 0; ns < stars.length; ns++) {
      var st = stars[ns];
      var sr2 = (1.4 + st.w * 1.8) * (S / 512);
      parts.push('<circle cx="' + st.x.toFixed(2) + '" cy="' + st.y.toFixed(2) + '" r="' + sr2.toFixed(2)
        + '" fill="' + ink + '" filter="url(#' + uid + 'glow)"/>');
      parts.push('<circle cx="' + st.x.toFixed(2) + '" cy="' + st.y.toFixed(2) + '" r="' + (sr2 * 2.4).toFixed(2)
        + '" fill="' + accent + '" opacity=".18"/>');
    }

    // Core — small Vitruvian cross + glow heart
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (S * 0.07).toFixed(2) + '" fill="url(#' + uid + 'core)"/>');
    var arm = S * 0.028;
    parts.push('<path d="M' + cx + ' ' + (cy - arm) + 'V' + (cy + arm) + 'M' + (cx - arm) + ' ' + cy + 'H' + (cx + arm)
      + '" stroke="' + ink + '" stroke-width="' + (S * 0.003).toFixed(2) + '" stroke-linecap="round" opacity=".75"/>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (S * 0.009).toFixed(2) + '" fill="' + accent2 + '"/>');

    // Fine corner ticks — manuscript / atlas plate feel
    var tick = S * 0.04, inset = S * 0.06;
    [[inset, inset], [S - inset, inset], [inset, S - inset], [S - inset, S - inset]].forEach(function (pt, qi) {
      var tx = pt[0], ty = pt[1];
      var dx = qi % 2 === 0 ? tick : -tick;
      var dy = qi < 2 ? tick : -tick;
      parts.push('<path d="M' + tx + ' ' + (ty + dy) + 'V' + ty + 'H' + (tx + dx)
        + '" fill="none" stroke="' + faint + '" stroke-width="' + (S * 0.002).toFixed(2) + '"/>');
    });

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S
      + '" width="' + S + '" height="' + S + '" role="img" aria-label="Citizen sigil">'
      + parts.join('') + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  };

  KRAY.nameplateHtml = function (t) {
    t = t || {};
    var name = String(t.name || (t.baptism && t.baptism.name) || '').trim();
    var star = t.star != null ? t.star : t.no;
    var mark = KRAY.starMark(star);
    return '<span class="kv-nameplate" title="baptised — this star has a name and no inscription">'
      + '<i>' + KRAY.esc(mark) + '</i>'
      + (name ? '<b>' + KRAY.esc(name) + '</b>' : '')
      + '<em>name only</em></span>';
  };

  /* ── KRAY PLATE bannerUrl — paint the sealed HTTPS URL; the frame follows the bytes.
     youtube → embed autoplay (muted; browser policy) · stop on ENDED · 16:9 or Shorts 9:16
     direct video → <video autoplay> · pause on ended · native ratio
     image / gif → <img> contain · square / wide / tall from natural size
     other https → X-style site card (og:image via /api/kraynet/unfurl) · click opens the sealed URL ── */
  KRAY.plateYoutubeId = function (raw) {
    try {
      var u = new URL(String(raw || ''));
      var host = (u.hostname || '').replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be') {
        var id = (u.pathname || '').replace(/^\//, '').split('/')[0];
        return /^[\w-]{11}$/.test(id) ? id : '';
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        if (u.searchParams.get('v') && /^[\w-]{11}$/.test(u.searchParams.get('v'))) return u.searchParams.get('v');
        var parts = (u.pathname || '').split('/').filter(Boolean);
        // /live/ID · /embed/ID · /shorts/ID
        if (parts.length >= 2 && /^(live|embed|shorts|v)$/.test(parts[0]) && /^[\w-]{11}$/.test(parts[1])) return parts[1];
      }
    } catch (_) { /* not a URL */ }
    return '';
  };
  KRAY.plateYoutubeFrame = function (raw) {
    var id = KRAY.plateYoutubeId(raw);
    if (!id) return null;
    var tall = false;
    try {
      var parts = (new URL(String(raw || ''))).pathname.split('/').filter(Boolean);
      tall = parts[0] === 'shorts';
    } catch (_) { /* */ }
    return { id: id, w: tall ? 9 : 16, h: tall ? 16 : 9 };
  };
  KRAY.plateRatioLabel = function (w, h) {
    w = Math.round(Number(w) || 0);
    h = Math.round(Number(h) || 0);
    if (w < 1 || h < 1) return '';
    if (Math.abs(w / h - 1) <= 0.03) return '1:1';
    function gcd(a, b) { return b ? gcd(b, a % b) : a; }
    var g = gcd(w, h);
    var a = w / g;
    var b = h / g;
    if (a <= 32 && b <= 32) return a + ':' + b;
    return w >= h
      ? (Math.round((w / h) * 10) / 10) + ':1'
      : '1:' + (Math.round((h / w) * 10) / 10);
  };
  KRAY.plateShapeOf = function (w, h) {
    w = Number(w) || 0;
    h = Number(h) || 0;
    if (w < 1 || h < 1) return '';
    var r = w / h;
    if (r >= 0.97 && r <= 1.03) return 'square';
    return r > 1 ? 'wide' : 'tall';
  };
  /** Size the stage to the media. Chrome only — sealed URL is untouched. */
  KRAY.fitPlateBanner = function (stage, w, h) {
    if (!stage || !w || !h) return;
    var shape = KRAY.plateShapeOf(w, h);
    var label = KRAY.plateRatioLabel(w, h);
    if (!shape || !label) return;
    stage.style.setProperty('--plate-ar', w + ' / ' + h);
    stage.setAttribute('data-plate-shape', shape);
    stage.setAttribute('data-plate-ratio', label);
    var host = stage.parentNode;
    var lab = host && host.querySelector && host.querySelector('.plate-banner-lab b');
    if (lab) lab.textContent = label;
  };
  /** Paint src for an image banner. Sealed URL stays; twimg needs format= to decode. */
  KRAY.plateImageSrc = function (raw) {
    var s = String(raw || '').trim();
    try {
      var u = new URL(s);
      var host = (u.hostname || '').replace(/^www\./, '').toLowerCase();
      if (/(^|\.)twimg\.com$/.test(host) && /\/media\//.test(u.pathname || '')) {
        if (!u.searchParams.get('format')) u.searchParams.set('format', 'jpg');
        if (!u.searchParams.get('name')) u.searchParams.set('name', 'large');
        return u.toString();
      }
    } catch (_) { /* sealed URL as-is */ }
    return s;
  };
  KRAY.plateBannerKind = function (raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (KRAY.plateYoutubeId(s)) return 'youtube';
    try {
      var u = new URL(s);
      var path = u.pathname || '';
      var ext = (path.split('.').pop() || '').toLowerCase();
      if (ext.indexOf('/') !== -1) ext = '';
      if (/^(gif|png|jpe?g|webp|avif|svg)$/.test(ext)) return 'image';
      if (/^(mp4|webm|ogg|ogv|mov|m4v)$/.test(ext)) return 'video';
      var host = (u.hostname || '').replace(/^www\./, '').toLowerCase();
      var fmt = String(u.searchParams.get('format') || '').toLowerCase();
      if (/^(jpe?g|png|webp|gif|avif)$/.test(fmt)) return 'image';
      if (/(^|\.)twimg\.com$/.test(host) && /\/(media|tweet_video_thumb|ext_tw_video_thumb|amplify_video_thumb)\//.test(path)) return 'image';
      if (/^(i\.imgur\.com|imgur\.com|pbs\.twitter\.com|images\.unsplash\.com|lh3\.googleusercontent\.com|media\.discordapp\.net|cdn\.discordapp\.com|i\.ibb\.co)$/.test(host)) {
        return 'image';
      }
    } catch (_) { /* */ }
    if (/\.(gif|png|jpe?g|webp|avif)(\?|$)/i.test(s)) return 'image';
    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(s)) return 'video';
    return 'link';
  };
  /** HTML for one sealed bannerUrl — stage size is applied after the media decodes. */
  KRAY.plateBannerHtml = function (raw) {
    var url = String(raw || '').trim();
    if (!url) return '';
    var kind = KRAY.plateBannerKind(url);
    var esc = KRAY.esc;
    if (kind === 'youtube') {
      var frame = KRAY.plateYoutubeFrame(url);
      var id = frame.id;
      var shape = frame.h > frame.w ? 'tall' : 'wide';
      var src = 'https://www.youtube.com/embed/' + encodeURIComponent(id)
        + '?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1';
      return '<div class="plate-banner-stage" data-plate-banner="youtube" data-ytid="' + esc(id) + '"'
        + ' data-plate-shape="' + shape + '" data-plate-ratio="' + frame.w + ':' + frame.h + '"'
        + ' style="--plate-ar:' + frame.w + ' / ' + frame.h + '">'
        + '<iframe class="plate-banner-frame" src="' + esc(src) + '" title="KRAY Plate banner" '
        + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
        + 'allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>'
        + '</div>';
    }
    if (kind === 'video') {
      return '<div class="plate-banner-stage" data-plate-banner="video">'
        + '<video class="plate-banner-video" src="' + esc(url) + '" autoplay muted playsinline controls '
        + 'preload="metadata"></video></div>';
    }
    if (kind === 'image') {
      var imgSrc = KRAY.plateImageSrc(url);
      return '<div class="plate-banner-stage" data-plate-banner="image">'
        + '<a class="plate-banner-hit" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="Open banner">'
        + '<img class="plate-banner-img" src="' + esc(imgSrc) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
        + '</a></div>';
    }
    if (kind === 'link') {
      var host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { /* */ }
      return '<a class="plate-linkcard" data-plate-banner="link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">'
        + '<span class="plate-linkcard-media" hidden><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>'
        + '<span class="plate-linkcard-meta">'
        + '<b class="plate-linkcard-host">' + esc(host) + '</b>'
        + '<em class="plate-linkcard-title">Open site</em>'
        + '<span class="plate-linkcard-desc" hidden></span>'
        + '</span></a>';
    }
    var fallHost = url;
    try { fallHost = new URL(url).host; } catch (_) { /* */ }
    return '<a class="mouth-link plate-banner-fallback" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">banner · ' + esc(fallHost) + ' ↗</a>';
  };
  KRAY.unfurlSite = function (url) {
    var key = String(url || '').trim();
    if (!key) return Promise.resolve({ ok: false });
    KRAY._unfurlCache = KRAY._unfurlCache || {};
    if (KRAY._unfurlCache[key]) return Promise.resolve(KRAY._unfurlCache[key]);
    return fetch('/api/kraynet/unfurl?url=' + encodeURIComponent(key))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        KRAY._unfurlCache[key] = j && typeof j === 'object' ? j : { ok: false };
        return KRAY._unfurlCache[key];
      })
      .catch(function () { return { ok: false }; });
  };
  /**
   * Paint a plate banner into `host` only when the sealed URL changes.
   * Live node polls must never remount a playing <video> / YouTube iframe.
   * Returns true when the media node was (re)created.
   */
  KRAY.syncPlateBanner = function (host, raw, opts) {
    if (!host) return false;
    opts = opts || {};
    var url = String(raw || '').trim();
    var prev = host.getAttribute('data-plate-src') || '';
    if (url === prev) {
      if (!url) return false;
      if (host.querySelector('.plate-banner-stage, a.plate-linkcard, a.plate-banner-fallback')) return false;
    }
    if (!url) {
      host.innerHTML = '';
      host.removeAttribute('data-plate-src');
      return true;
    }
    var html = KRAY.plateBannerHtml(url);
    var lab = opts.lab
      ? '<div class="plate-banner-lab"><span>' + KRAY.esc(opts.labLabel || 'Plate banner') + '</span><b>—</b></div>'
      : '';
    host.innerHTML = lab + html;
    host.setAttribute('data-plate-src', url);
    if (typeof KRAY.mountPlateBanners === 'function') KRAY.mountPlateBanners(host);
    return true;
  };
  /** Wire stop-on-end for youtube / native video inside a painted root. Idempotent. */
  KRAY.mountPlateBanners = function (root) {
    var scope = root && root.querySelectorAll ? root : document;
    // Native <video> — pause when the clip ends (no loop landfill).
    scope.querySelectorAll('video.plate-banner-video').forEach(function (v) {
      if (v.__krayPlateWired) return;
      v.__krayPlateWired = true;
      function fitVid() {
        var stage = v.closest && v.closest('.plate-banner-stage');
        if (stage && v.videoWidth && v.videoHeight) KRAY.fitPlateBanner(stage, v.videoWidth, v.videoHeight);
      }
      v.addEventListener('loadedmetadata', fitVid);
      v.addEventListener('ended', function () {
        try { v.pause(); } catch (_) { /* */ }
      });
      if (v.readyState >= 1) fitVid();
    });
    // Site URL — X-style card: front image + title; click stays the sealed href.
    scope.querySelectorAll('a.plate-linkcard[data-plate-banner="link"]').forEach(function (card) {
      if (card.__krayPlateWired) return;
      card.__krayPlateWired = true;
      var href = card.getAttribute('href') || '';
      KRAY.unfurlSite(href).then(function (j) {
        if (!j || !j.ok) return;
        var title = card.querySelector('.plate-linkcard-title');
        var desc = card.querySelector('.plate-linkcard-desc');
        var hostEl = card.querySelector('.plate-linkcard-host');
        var media = card.querySelector('.plate-linkcard-media');
        var img = media && media.querySelector('img');
        if (hostEl && j.host) hostEl.textContent = j.host;
        if (title && j.title) title.textContent = j.title;
        if (desc && j.description) {
          desc.textContent = j.description;
          desc.hidden = false;
        }
        if (media && img && j.image) {
          img.addEventListener('error', function () { media.hidden = true; }, { once: true });
          img.src = j.image;
          media.hidden = false;
        }
        var lab = card.parentNode && card.parentNode.querySelector && card.parentNode.querySelector('.plate-banner-lab b');
        if (lab) lab.textContent = 'site';
      });
    });
    // Extensionless / hotlinked images — if the bytes are not a picture, keep a quiet link.
    scope.querySelectorAll('[data-plate-banner="image"] img.plate-banner-img').forEach(function (im) {
      if (im.__krayPlateWired) return;
      im.__krayPlateWired = true;
      function fall() {
        var stage = im.closest && im.closest('.plate-banner-stage');
        var a = stage && stage.querySelector('a.plate-banner-hit');
        var href = (a && a.getAttribute('href')) || '';
        var host = href;
        try { host = new URL(href).host; } catch (_) { /* */ }
        var fb = '<a class="mouth-link plate-banner-fallback" href="' + KRAY.esc(href) + '" target="_blank" rel="noopener noreferrer">banner · ' + KRAY.esc(host) + ' ↗</a>';
        if (stage && stage.parentNode) stage.outerHTML = fb;
      }
      function fitImg() {
        var stage = im.closest && im.closest('.plate-banner-stage');
        if (stage && im.naturalWidth && im.naturalHeight) KRAY.fitPlateBanner(stage, im.naturalWidth, im.naturalHeight);
      }
      im.addEventListener('error', fall);
      im.addEventListener('load', fitImg);
      if (im.complete && im.naturalWidth === 0) fall();
      else if (im.complete && im.naturalWidth) fitImg();
    });
    scope.querySelectorAll('.plate-banner-stage[data-plate-banner="youtube"][data-plate-ratio]').forEach(function (stage) {
      var bits = String(stage.getAttribute('data-plate-ratio') || '').split(':');
      var w = Number(bits[0]) || 0;
      var h = Number(bits[1]) || 0;
      if (w && h) KRAY.fitPlateBanner(stage, w, h);
    });
    var ytStages = scope.querySelectorAll('[data-plate-banner="youtube"][data-ytid]');
    if (!ytStages.length) return;
    function wirePlayers() {
      if (!window.YT || !YT.Player) return;
      ytStages.forEach(function (stage) {
        if (stage.__krayYt) return;
        var iframe = stage.querySelector('iframe.plate-banner-frame');
        if (!iframe) return;
        stage.__krayYt = true;
        try {
          // eslint-disable-next-line no-new
          new YT.Player(iframe, {
            events: {
              onStateChange: function (ev) {
                // 0 === ENDED — stop (do not loop). Live streams never fire this.
                if (ev && ev.data === 0 && ev.target && typeof ev.target.stopVideo === 'function') {
                  try { ev.target.stopVideo(); } catch (_) { /* */ }
                }
              },
            },
          });
        } catch (_) { /* API optional — embed still autoplays */ }
      });
    }
    if (window.YT && YT.Player) { wirePlayers(); return; }
    if (!window.__krayYtApiLoading) {
      window.__krayYtApiLoading = true;
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') try { prev(); } catch (_) { /* */ }
        wirePlayers();
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    } else {
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        if ((window.YT && YT.Player) || tries > 40) { clearInterval(t); wirePlayers(); }
      }, 250);
    }
  };

  /* Market / history plate — the sealed bytes fill the square. Image and audio cover as
     <img>; video as a still; text / code through the letter template. A baptised star
     with no bytes gets the nameplate — never an empty square. ★ N is the empty
     fallback only; it never sits behind inscribed content. */
  KRAY.faceHtml = function (t) {
    t = t || {};
    var kind = KRAY.starKindOf(t);
    if (kind === 'named') return KRAY.nameplateHtml(t);
    // profile.written uses `media` as a BOOLEAN flag (has image/video/audio).
    // Other doors pass `media` as a /content/… URL. Never treat a boolean as a src —
    // that made music tiles iframe "true" / dump the whole page into the square.
    var media = (typeof t.media === 'string' && t.media)
      || t.url
      || (t.contentHash ? '/content/' + t.contentHash : '');
    var ct = String(t.contentType || t.ctype || '');
    var cat = KRAY.categoryOf(ct);
    var badge = kind === 'inscribed'
      ? '<span class="skind-face" title="has an inscription — no baptism">unnamed</span>'
      : '';
    if (!media) return KRAY.starMarkPlate(t);
    var hash = (t.contentHash && /^[0-9a-f]{64}$/i.test(String(t.contentHash)) && String(t.contentHash).toLowerCase())
      || (String(media).match(/\/(?:content|cover|render)\/([0-9a-f]{64})/i) || [])[1];
    if (hash) hash = String(hash).toLowerCase();
    var layer;
    if (cat === 'image' || cat === 'vector') {
      layer = '<img loading="lazy" alt="" src="' + KRAY.esc(media) + '" onerror="this.remove()">';
    } else if (cat === 'audio') {
      // Lists / pickers: ID3 sleeve only — never an <audio> or /render iframe in the square.
      layer = hash
        ? '<img class="music-cover" loading="lazy" alt="" src="/cover/' + hash + '" onerror="this.remove()">'
        : '<span class="ph">♪</span>';
    } else if (cat === 'video') {
      layer = '<video muted playsinline preload="metadata" src="' + KRAY.esc(media) + '"></video>';
    } else {
      var pkind = KRAY.previewKindOf(ct);
      // text / code / markdown sit in the LETTER+SNIPPET template (hydratePortraits),
      // never a raw /render iframe — that dumps wrapping source into a 60px square.
      // pdf keeps the frozen first-page iframe. Image / video / audio already returned.
      if (pkind && pkind !== 'pdf' && hash) {
        layer = '<div class="kv-hyd" data-kvurl="/content/' + hash + '" data-kvct="' + KRAY.esc(ct) + '"></div>';
      } else {
        var render = hash ? '/render/' + hash : String(media).replace('/content/', '/render/');
        layer = '<iframe loading="lazy" src="' + KRAY.esc(render) + '#toolbar=0&navpanes=0&scrollbar=0" sandbox="allow-scripts allow-same-origin" tabindex="-1" title=""></iframe>';
      }
    }
    return layer + badge;
  };
  /* Standard star header — 128 face · ★ N · name · id chips. Catalog click lands here. */
  KRAY.starCrownHtml = function (s, book, opts) {
    s = s || {};
    book = book || s.luz || null;
    opts = opts || {};
    var ins = (s.inscriptions && s.inscriptions[0]) || null;
    var tok = {
      star: s.star,
      name: s.name,
      contentHash: s.contentHash || (ins && ins.contentHash),
      contentType: s.contentType || (ins && ins.contentType),
      url: s.contentHash ? ('/content/' + s.contentHash) : (ins && ins.url),
      held: ins ? ins.held : !!s.contentHash
    };
    var face = KRAY.faceHtml(tok);
    var ids = '<span class="chip">star #' + KRAY.esc(String(s.star)) + '</span>';
    if (s.name) ids += '<span class="chip">' + KRAY.esc(s.name) + '</span>';
    if (s.id) ids += '<span class="chip" title="inscription / birth id">' + KRAY.esc(s.id) + '</span>';
    if (ins && ins.number != null) ids += '<span class="chip">inscription #' + KRAY.esc(String(ins.number)) + '</span>';
    if (s.contentType) ids += '<span class="chip">' + KRAY.esc(s.contentType) + '</span>';
    var unportioned = !book || book.unportioned;
    var infinite = !!(book && book.infinite);
    if (!unportioned) ids += '<span class="chip">KRC-77</span>';
    var brow = infinite ? 'KRC-77 · INFINITE' : (unportioned ? 'STAR' : 'KRC-77 · HOLDER BOOK');
    var sub = unportioned
      ? 'This star has not sealed KRC-77. The light market has no book here.'
      : (infinite
        ? 'Infinite paper — no genesis units. There is no holder rank until a later mint door exists.'
        : 'Who holds this light. Σ must equal the sealed supply. A stranger who replays the journal gets the same table.');
    var n = KRAY.esc(String(s.star));
    return '<span class="face facefill fixed starcrown-face">' + face + '</span>'
      + '<div class="starcrown-m">'
      + '<div class="eyebrow">' + brow + '</div>'
      + '<h2>★ ' + n + (s.name ? ' · ' + KRAY.esc(s.name) : '') + (unportioned ? '' : ' ✧') + '</h2>'
      + '<div class="starids">' + ids + '</div>'
      + '<p class="sub">' + sub + '</p>'
      + '<div class="actions" style="margin-top:var(--s4)">'
      + (opts.onStar
        ? '<a class="btn" href="/rank/luz/' + n + '">the holder rank →</a>'
        : '<a class="btn" href="/star/' + n + '#luz">the star →</a>')
      + '<a class="btn" href="/inscribe?star=' + n + '&tab=law">the paper →</a>'
      + '</div></div>';
  };
  /* Circular face on a star chip (#32). The sealed bytes when an <img> can show them;
     otherwise the number stands alone. Never a frame emoji. Presentation only. */
  KRAY.starChipArt = function (t, px) {
    t = t || {};
    px = px || 32;
    if (t.held === false) return '';
    var hash = t.contentHash || (String(t.url || '').match(/\/(?:content|cover)\/([0-9a-f]{64})/) || [])[1];
    if (!hash) return '';
    var face = KRAY.workFace({ contentType: t.ctype || t.contentType, contentHash: hash });
    if (!face.src) return '';
    return '<img class="sface" src="' + KRAY.esc(face.src) + '" width="' + px + '" height="' + px + '" alt="" loading="lazy" onerror="this.remove()">';
  };
  KRAY.starChipInner = function (t) {
    t = t || {};
    var n = Number(t.star);
    var mark = Number.isFinite(n) ? KRAY.starMark(n) : KRAY.esc(String(t.star || ''));
    var name = String(t.name || (t.baptism && t.baptism.name) || '').trim();
    var lab = name
      ? (mark + '<span class="chip-name">' + KRAY.esc(name) + '</span>')
      : mark;
    return KRAY.starChipArt(t) + '<span class="chip-lab">' + lab + '</span>';
  };
  KRAY.starChipButton = function (attrs, t) {
    var inner = KRAY.starChipInner(t);
    var cls = inner.indexOf('class="sface"') >= 0 ? 'chip has-face' : 'chip';
    return '<button type="button" class="' + cls + '" ' + attrs + '>' + inner + '</button>';
  };
  /* One MP3 + APIC cover = one relic. Lists stay frozen (cover only).
     The cinema is the only mouth that plays — Spotify play geometry
     (solid disc, black glyph, heavy lift) on the sleeve. One click, one
     toggle. Native <audio controls> is a second mouth: discarded. */
  var _musicLive = null;
  function _silenceMusic(keep) {
    if (_musicLive && _musicLive !== keep) {
      try { _musicLive.pause(); } catch (_) { /* element may already be gone */ }
    }
    _musicLive = keep || null;
  }
  KRAY.musicStage = function (box, url, ct, opts) {
    opts = opts || {};
    box.innerHTML = '';
    var chip = '<span class="kv-chip">♪ ' + KRAY.esc(String(ct || '').split('/')[1] || 'audio') + '</span>';
    var cover = KRAY.coverUrlOf(url);
    if (opts.mini) {
      if (!cover) { box.innerHTML = chip; return; }
      var im = document.createElement('img');
      im.className = 'music-cover';
      im.alt = '';
      im.loading = 'lazy';
      im.src = cover;
      im.onerror = function () { box.innerHTML = chip; };
      box.appendChild(im);
      return;
    }
    box.classList.add('music');
    var stage = document.createElement('div');
    stage.className = 'music-cinema';
    if (cover) {
      var art = document.createElement('img');
      art.className = 'music-cover';
      art.alt = '';
      art.draggable = false;
      art.loading = 'lazy';
      art.src = cover;
      art.onerror = function () { art.remove(); };
      stage.appendChild(art);
    }
    var au = document.createElement('audio');
    au.preload = 'auto';
    au.setAttribute('playsinline', '');
    au.setAttribute('controlslist', 'nodownload');
    au.src = url;
    stage.appendChild(au);
    var PLAY_D = 'M8 5.2v13.6L20 12z';
    var PAUSE_D = 'M6.8 5h3.4v14H6.8zm7 0h3.4v14H13.8z';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'music-play';
    btn.setAttribute('aria-label', 'Play');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + PLAY_D + '"></path></svg>';
    stage.appendChild(btn);
    var meter = document.createElement('div');
    meter.className = 'music-meter';
    meter.setAttribute('role', 'slider');
    meter.setAttribute('aria-label', 'Seek');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', '0');
    var fill = document.createElement('i');
    meter.appendChild(fill);
    stage.appendChild(meter);
    box.appendChild(stage);

    function setOn(on) {
      on = !!on;
      stage.classList.toggle('is-on', on);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
      var path = btn.querySelector('path');
      if (path) path.setAttribute('d', on ? PAUSE_D : PLAY_D);
    }
    function seekAt(clientX) {
      var r = meter.getBoundingClientRect();
      var w = r.width || 1;
      var ratio = (clientX - r.left) / w;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      if (au.duration && isFinite(au.duration)) au.currentTime = ratio * au.duration;
    }
    function playNow() {
      _silenceMusic(au);
      var p = au.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          stage.classList.remove('is-dead');
          btn.removeAttribute('title');
          setOn(true);
        }).catch(function () {
          setOn(false);
          if (_musicLive === au) _musicLive = null;
          stage.classList.add('is-dead');
          btn.title = 'This browser could not play these bytes';
        });
      } else {
        setOn(!au.paused);
      }
    }
    function toggle() {
      if (au.paused) playNow();
      else {
        au.pause();
        setOn(false);
        if (_musicLive === au) _musicLive = null;
      }
    }
    /* One mouth. The button is the control; the sleeve is the same act.
       A second listener that also toggles would play-then-pause on one click. */
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    });
    stage.addEventListener('click', function (e) {
      if (e.target.closest('.music-play') || e.target.closest('.music-meter')) return;
      e.preventDefault();
      toggle();
    });
    meter.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      seekAt(e.clientX);
    });
    au.addEventListener('timeupdate', function () {
      var d = au.duration;
      if (!d || !isFinite(d)) return;
      var pct = (au.currentTime / d) * 100;
      fill.style.width = pct + '%';
      meter.setAttribute('aria-valuenow', String(Math.round(pct)));
    });
    au.addEventListener('play', function () { _silenceMusic(au); setOn(true); });
    au.addEventListener('pause', function () {
      if (_musicLive === au && au.paused) _musicLive = null;
      setOn(false);
    });
    au.addEventListener('ended', function () {
      setOn(false);
      fill.style.width = '0';
      meter.setAttribute('aria-valuenow', '0');
      if (_musicLive === au) _musicLive = null;
    });
  };
  KRAY.frozenPreview = function (box, url, ct, opts) {
    opts = opts || {};
    var kind = KRAY.previewKindOf(ct);
    box.innerHTML = '';
    if (kind === 'image') { var im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.src = url; box.appendChild(im); return; }
    if (kind === 'video') { var v = document.createElement('video'); v.src = url; v.muted = true; v.playsInline = true; if (opts.mini) { v.autoplay = true; v.loop = true; } else v.controls = true; box.appendChild(v); return; }
    if (kind === 'audio') { KRAY.musicStage(box, url, ct, opts); return; }
    if (kind === 'pdf') {
      var pw = document.createElement('div'); pw.className = 'kv-paper';
      var fr = document.createElement('iframe');
      fr.src = String(url).replace('/content/', '/render/') + '#toolbar=0&navpanes=0&scrollbar=0';
      fr.setAttribute('tabindex', '-1'); fr.title = 'pdf star (frozen preview)';
      pw.appendChild(fr); box.appendChild(pw); return;
    }
    if (kind === 'md' || kind === 'src' || kind === 'txt') {
      var wrap = document.createElement('div'); wrap.className = 'kv-paper' + (opts.mini ? ' kv-mini' : ' kv-paper--lg'); box.appendChild(wrap);
      var cap = opts.mini ? 4000 : 400000;
      fetch(url).then(function (r) { if (!r.ok) throw new Error('gone'); return r.text(); }).then(function (t) {
        t = t.length > cap ? t.slice(0, cap) + (opts.mini ? '' : '\n…') : t;
        if (kind === 'md') { wrap.innerHTML = '<div class="kv-mdprev">' + KRAY.mdToSafeHtml(t) + '</div>'; return; }
        if (kind === 'txt') {
          // the LETTER — a written post always arrives beautifully set. Mini tiles
          // always use the QUOTE CARD and then FIT the type to the real box so a
          // 60px library square never mid-word-breaks ("reli c"). Full-size short
          // posts still scale by length (the genesis verse look).
          var body = t.trim(), short = body.length > 0 && body.length <= 140 && body.split('\n').length <= 4;
          var d = document.createElement('div');
          d.className = 'kv-txtprev' + (opts.mini || short ? ' kv-txtprev--quote' : '');
          d.textContent = opts.mini ? (body || t) : t;
          if (short && !opts.mini) {
            d.style.fontSize = Math.max(17, Math.min(34, Math.round(38 - body.length / 4))) + 'px';
          }
          wrap.appendChild(d);
          if (opts.mini) kvFitPortrait(d);
          return;
        }
        if (opts.mini) {
          // SNIPPET CARD — a 60px square cannot host editor chrome. First lines,
          // centered, fitted, language as a corner whisper. Source is shown, never run.
          var chip = document.createElement('span'); chip.className = 'kv-chip kv-chip--corner';
          chip.textContent = kvCodeLabel(ct);
          var pre = document.createElement('pre'); pre.className = 'kv-srcprev kv-srcprev--fit';
          pre.textContent = kvSnippetLines(t, 180);
          wrap.appendChild(chip); wrap.appendChild(pre);
          kvFitPortrait(pre);
          return;
        }
        // the CODE page — editor chrome + source, shown, never run
        var head = document.createElement('div'); head.className = 'kv-codehead';
        head.innerHTML = '<i>' + KRAY.esc(kvCodeLabel(ct)) + '</i><span>source · never executed</span>';
        var src = document.createElement('pre'); src.className = 'kv-srcprev';
        src.textContent = t;                                    // textContent: never markup
        wrap.appendChild(head); wrap.appendChild(src);
      }).catch(function () { wrap.innerHTML = '<span class="kv-chip">bytes held elsewhere</span>'; });
      return;
    }
    box.innerHTML = '<span class="kv-chip">' + KRAY.esc(String(ct || 'unknown')) + '</span>';
  };

  /* Fit letter/snippet type to the LIVE box. Binary search font-size until the
     bytes sit inside without overflow — a 54px map lot and a 240px market plate
     share one template. Presentation only; the sealed bytes are unchanged. */
  function kvFits(el) {
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
  }
  function kvFitNow(el) {
    var w = el.clientWidth, h = el.clientHeight;
    if (w < 8 || h < 8) return;
    var min = 7, max = Math.max(min, Math.min(22, Math.floor(Math.min(w, h) / 3.2)));
    var lo = min, hi = max, best = min;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      el.style.fontSize = mid + 'px';
      if (kvFits(el)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    el.style.fontSize = best + 'px';
  }
  function kvFitPortrait(el) {
    if (!el) return;
    var run = function () { kvFitNow(el); };
    if (el.clientWidth) { requestAnimationFrame(run); return; }
    if (typeof ResizeObserver === 'undefined') { setTimeout(run, 60); return; }
    var ro = new ResizeObserver(function () {
      if (el.clientWidth) { ro.disconnect(); run(); }
    });
    ro.observe(el);
  }
  function kvSnippetLines(t, maxChars) {
    var lines = String(t || '').replace(/\t/g, '  ').split(/\r?\n/);
    var out = [], n = 0;
    for (var i = 0; i < lines.length && out.length < 6; i++) {
      var line = lines[i];
      if (!line.trim() && !out.length) continue;
      out.push(line);
      n += line.length;
      if (n >= maxChars) break;
    }
    return out.join('\n');
  }
  /* Paint every .kv-hyd portrait that a list just inserted. Pages may still call
     frozenPreview themselves — data-loaded makes this a no-op on those. */
  KRAY.hydratePortraits = function (root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.kv-hyd[data-kvurl]:not([data-loaded])').forEach(function (el) {
      el.setAttribute('data-loaded', '1');
      KRAY.frozenPreview(el, el.getAttribute('data-kvurl'), el.getAttribute('data-kvct'), { mini: true });
    });
  };

  /* ── the era's byte price — THIS node is the only mouth. Never invent a second rate.
     10 KB is only the SI name of 10_000 B (1000, not 1024). Both names, one law. ── */
  KRAY.eraRate = function () {
    var n = Number(window.kraynetBytesPerKray);
    return (Number.isFinite(n) && n > 0) ? n : 0;
  };
  /* Same function as the reducer: max(1, ceil(size / bytesPerKray)). Empty body = 1 ₭ floor. */
  KRAY.starFire = function (size, rate) {
    var r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) r = KRAY.eraRate();
    if (!r) return 1;
    var s = Number(size);
    if (!Number.isFinite(s) || s <= 0) return 1;
    return Math.max(1, Math.ceil(s / r));
  };
  KRAY.burnOf = function (size) { return KRAY.starFire(size); };
  /* SI (1000): 10_000_000 bytes = 10 MB. Binary 1024 would print 9.54 MB and lie. */
  KRAY.formatBytes = function (n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return '—';
    if (n === 0) return '0 bytes';
    if (n === 1) return '1 byte';
    if (n < 1000) return n + ' bytes';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var u = 0;
    var v = n / 1000;
    while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    var digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return String(Number(v.toFixed(digits))) + ' ' + units[u];
  };
  KRAY.sizeLawRate = function (bytesPer) {
    var n = Number(bytesPer);
    if (!Number.isFinite(n) || n <= 0) n = KRAY.eraRate();
    if (!n) return 'quoting…';
    if (n === 10000) return '1 ₭ / 10,000 B (10 KB)';
    if (n === 1000000) return '1 ₭ / 1 MB';
    return '1 ₭ / ' + KRAY.formatBytes(n);
  };
  try { fetch('/api/kraynet/donation/info').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.bytesPerKrayBurn) window.kraynetBytesPerKray = d.bytesPerKrayBurn;
    if (d && d.contentMax) window.kraynetContentMax = Number(d.contentMax);
    if (d) window.kraynetAtlasFeeOn = !!d.atlasFeeActive;
    try { window.dispatchEvent(new CustomEvent('kray-era-quote')); } catch (e) { /* old host */ }
  }).catch(function () {}); } catch (e) { /* static context */ }

  /* ── theme ── */
  var THEME_KEY = 'kray.theme';
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var ic = document.getElementById('kray-themeicon');
    if (ic) ic.innerHTML = '<use href="#' + (isLight() ? 'i-moon' : 'i-sun') + '"/>';
  }
  function isLight() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'light';
    return window.matchMedia && matchMedia('(prefers-color-scheme:light)').matches;
  }
  function toggleTheme() { var next = isLight() ? 'dark' : 'light'; try { localStorage.setItem(THEME_KEY, next); } catch (_) {} applyTheme(next); }
  (function initTheme() { var saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (_) {} if (saved) applyTheme(saved); })();

  /* ── KrayWallet connect — read-only greet; signing goes through the extension ── */
  var LSADDR = 'kray.linked.addr';
  // ── NETWORK-AWARE CONNECT — a KrayWallet holds ONE taproot key; its address differs only by the
  //    network prefix (bc1 main · tb1 signet · bcrt1 regtest). This explorer is served BY a node that
  //    knows its own network (overview.network), so we re-encode the connected address onto THIS node's
  //    prefix — the SAME key, the right network. That is why the signet explorer links a tb1 address and
  //    the regtest one a bcrt1, automatically, from the very same wallet. Self-contained: no extension change.
  var HRP_OF = { main: 'bc', signet: 'tb', test: 'tb', testnet: 'tb', regtest: 'bcrt' };
  var _CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', _GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], _B32M = 0x2bc830a3;
  function _pmod(v) { var c = 1; for (var p = 0; p < v.length; p++) { var t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ v[p]; for (var i = 0; i < 5; i++) if ((t >> i) & 1) c ^= _GEN[i]; } return c; }
  function _hexp(h) { var o = [], i; for (i = 0; i < h.length; i++) o.push(h.charCodeAt(i) >> 5); o.push(0); for (i = 0; i < h.length; i++) o.push(h.charCodeAt(i) & 31); return o; }
  function _ckind(h, d) { var c = _pmod(_hexp(h).concat(d)); if (c === 1) return 1; if (c === _B32M) return _B32M; return 0; }
  function _cksum(h, d, con) { var v = _hexp(h).concat(d).concat([0, 0, 0, 0, 0, 0]), m = _pmod(v) ^ con, r = []; for (var i = 0; i < 6; i++) r.push((m >> (5 * (5 - i))) & 31); return r; }
  // re-encode a bech32/bech32m address (ANY source prefix) onto `hrp` — same witness program/key, new network
  function _swapHrp(addr, hrp) {
    if (typeof addr !== 'string' || !hrp) return addr;
    var a = addr.trim().toLowerCase(), pos = a.lastIndexOf('1');
    if (pos < 1) return addr;
    var src = a.slice(0, pos), dp = a.slice(pos + 1);
    if (src === hrp) return a;                                  // already this network
    var data = []; for (var i = 0; i < dp.length; i++) { var d = _CS.indexOf(dp.charAt(i)); if (d === -1) return addr; data.push(d); }
    var kind = _ckind(src, data); if (!kind || data.length < 7) return addr;   // not a valid bech32/bech32m body
    var payload = data.slice(0, data.length - 6), con = kind === _B32M ? _B32M : 1, ck = _cksum(hrp, payload, con), full = payload.concat(ck), out = hrp + '1';
    for (var j = 0; j < full.length; j++) out += _CS.charAt(full[j]);
    return out;
  }
  KRAY.net = null; KRAY.hrp = null;
  function toNodeAddr(addr) { return (addr && KRAY.hrp) ? _swapHrp(addr, KRAY.hrp) : addr; }   // → THIS node's network
  KRAY.netReady = fetch('/api/kraynet/overview', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) {
    KRAY.net = (o && o.network) || null; KRAY.hrp = HRP_OF[KRAY.net] || null;
    // an address restored/connected before the network was known gets re-encoded onto this node now
    if (window.__krayAddr && KRAY.hrp) { var t = toNodeAddr(window.__krayAddr); if (t && t !== window.__krayAddr) { setAddr(t); try { localStorage.setItem(LSADDR, t); } catch (_) {} } }
    return KRAY.net;
  }).catch(function () { return null; });
  function present() { return !!(window.krayWallet && window.krayWallet._isKrayWallet); }
  function paintWallet(addr) {
    var b = document.getElementById('kray-connect'), lab = document.getElementById('kray-connectlabel');
    if (!b || !lab) return;
    if (addr) { b.classList.add('connected'); lab.textContent = KRAY.short(addr); b.title = addr + ' — open profile menu'; }
    else { b.classList.remove('connected'); lab.textContent = present() ? 'Connect KrayWallet' : 'Get KrayWallet'; b.title = present() ? 'Connect the KrayWallet extension — the taproot key you already hold' : 'Install KrayWallet to enter'; }
  }
  function setAddr(addr) { window.__krayAddr = addr || null; if (!addr) closeMenu(); paintWallet(addr); try { window.dispatchEvent(new CustomEvent(addr ? 'kray-connected' : 'kray-disconnected', { detail: { address: addr || null } })); } catch (_) {} }
  var connecting = false;
  function doConnect() {
    // CONNECTED → open the profile menu. A stray click on the chip must NEVER sign
    // you out silently (the old bug): disconnect now lives inside the menu.
    if (window.__krayAddr) { toggleMenu(); return; }
    if (!present()) { window.open('https://kray.network', '_blank', 'noopener'); return; }
    if (connecting) return; connecting = true;
    KRAY.netReady.then(function () { return window.krayWallet.requestAccounts(); }).then(function (r) {
      var addr = toNodeAddr((r && r.address) || (Array.isArray(r) && r[0]) || null);   // re-encode onto THIS node's network
      if (addr) { setAddr(addr); try { localStorage.setItem(LSADDR, addr); } catch (_) {} }
      else if (r && r.needsUserAction) { console.warn('KrayWallet locked — unlock the extension, then Connect again'); }
    }).catch(function (e) { console.warn('KrayWallet connect failed:', e && e.message); }).then(function () { connecting = false; });
  }
  function disconnect() { closeMenu(); setAddr(null); try { localStorage.removeItem(LSADDR); } catch (_) {} }

  /* ── the connected menu — profile, copy, disconnect ── */
  function closeMenu() {
    var m = document.getElementById('kray-walletmenu'); if (m) m.parentNode.removeChild(m);
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onMenuKey, true);
    var b = document.getElementById('kray-connect'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function onDocClick(e) {
    var m = document.getElementById('kray-walletmenu'), b = document.getElementById('kray-connect');
    if (!m || m.contains(e.target) || (b && b.contains(e.target))) return;
    closeMenu();
  }
  function onMenuKey(e) { if (e.key === 'Escape') closeMenu(); }
  function toggleMenu() {
    if (document.getElementById('kray-walletmenu')) { closeMenu(); return; }
    var addr = window.__krayAddr, wrap = document.querySelector('header.nav .right'); if (!addr || !wrap) return;
    var m = KRAY.el(
      '<div id="kray-walletmenu" class="wallet-menu" role="menu">' +
        '<div class="wm-head"><span class="wm-k">SIGNED IN</span><code class="wm-addr" title="' + KRAY.esc(addr) + '">' + KRAY.esc(KRAY.short(addr)) + '</code>' +
          '<button class="wm-copy" type="button" title="copy address">copy</button></div>' +
        '<a class="wm-item" href="/u/' + encodeURIComponent(addr) + '" role="menuitem"><svg width="15" height="15"><use href="#g-star"/></svg> My profile</a>' +
        '<a class="wm-item" href="/dashboard" role="menuitem"><svg width="15" height="15"><use href="#g-block"/></svg> Dashboard</a>' +
        '<a class="wm-item" href="/mine" role="menuitem"><svg width="15" height="15"><use href="#g-glow"/></svg> Donate → mint ₭</a>' +
        '<a class="wm-item" href="/mind" role="menuitem"><svg width="15" height="15"><use href="#g-t-resonance"/></svg> Talk to the book</a>' +
        '<a class="wm-item" href="/validate" role="menuitem"><svg width="15" height="15"><use href="#g-vote"/></svg> Be a validator</a>' +
        '<button class="wm-item wm-danger" type="button" id="kray-disconnect" role="menuitem"><svg width="15" height="15"><use href="#g-send"/></svg> Disconnect</button>' +
      '</div>');
    wrap.appendChild(m);
    var b = document.getElementById('kray-connect'); if (b) b.setAttribute('aria-expanded', 'true');
    var cp = m.querySelector('.wm-copy');
    cp.addEventListener('click', function (e) { e.stopPropagation(); try { navigator.clipboard.writeText(addr); } catch (_) {} cp.textContent = 'copied'; setTimeout(function () { cp.textContent = 'copy'; }, 1400); });
    m.querySelector('#kray-disconnect').addEventListener('click', disconnect);
    // defer: the click that OPENED the menu must not immediately close it
    setTimeout(function () { document.addEventListener('click', onDocClick, true); document.addEventListener('keydown', onMenuKey, true); }, 0);
  }
  function restoreWallet() {
    var saved = null; try { saved = localStorage.getItem(LSADDR); } catch (_) {}
    if (!saved || !present()) { paintWallet(null); return; }
    KRAY.netReady.then(function () { return window.krayWallet.getAccounts(); }).then(function (a) {
      var list = (Array.isArray(a) ? a : (a && a.accounts) || []).map(toNodeAddr);   // wallet reports its own network; match on THIS node's
      if (list.indexOf(saved) >= 0) setAddr(saved); else if (list.length) setAddr(list[0]); else paintWallet(null);
    }).catch(function () { paintWallet(null); });
  }

  /* ── header + footer markup ── */
  function navHTML(active) {
    var links = NAV.map(function (n) { return '<a href="' + n.href + '" data-p="' + n.p + '"' + (n.p === active ? ' class="on"' : '') + '>' + n.label + '</a>'; }).join('');
    return '<header class="nav"><div class="inner">' +
      '<a class="brand" href="/" aria-label="KRAY.NETWORK home"><img class="brand-mark" src="/kray-mark.svg" alt="" width="24" height="24"><b>KRAY</b><span>.NETWORK</span></a>' +
      '<nav class="links">' + links + '</nav>' +
      '<div class="right">' +
        '<button class="wallet" id="kray-connect" aria-haspopup="true" aria-expanded="false"><span class="dot"></span><span id="kray-connectlabel">Connect KrayWallet</span><span class="wcaret" aria-hidden="true">▾</span></button>' +
      '</div></div></header>';
  }
  function footHTML() {
    return '<footer class="foot"><div class="wrap">' +
      '<div class="g12">' +
        '<div class="foot-brand c4"><div class="b">₭ KRAY.NETWORK</div><div class="t">The book: sacrifice → ₭ → stars. Replay proves it. Sealed to Bitcoin. DeFi is an app on this ledger — not the node.</div></div>' +
        '<div class="col foot-col"><h5>Explore</h5><a href="/">Explorer</a><a href="/blocks">Chain</a><a href="/network">Network</a><a href="/land">Land</a><a href="/city">City</a><a href="/library">Library</a><a href="/mind">Mind</a><a href="/rank">Rank</a><a href="/dashboard">Dashboard</a><a href="/address/KRAY_TREASURY">Treasury</a><a href="/blackhole">Black hole</a></div>' +
        '<div class="col foot-col"><h5>Apps</h5><a href="/market">Markets</a><a href="/market/star">Star market</a><a href="/market/luz">Light market</a><a href="/market/drops">Drops</a><a href="/harvests">Harvests</a><a href="/collections">Collections</a><a href="/defi">DeFi</a><a href="/rune">Runes</a><a href="/send">Send</a></div>' +
        '<div class="col foot-col prove"><h5>Prove</h5><a href="/proof">Proof</a><a href="/verify">Verify</a><a href="/anchor">The anchor</a><a href="/burn">Bitcoin Proof</a><a href="/docs">Docs</a><a href="/docs#atlas">Site atlas</a></div>' +
      '</div>' +
      '<div class="bar"><span>circulating ₭ = emitted − burned · one cascade root sealed to Bitcoin</span><span>KRAY OS v2 · Blueprint</span></div>' +
    '</div></footer>';
  }

  function init() {
    // the reading room is bare on purpose: no nav, no wallet, no footer — only the star
    var mdview = document.body && document.body.getAttribute('data-mdview');
    if (mdview && /^[0-9a-f]{64}$/.test(mdview)) { mountMdView(mdview); return; }
    // glyphs first — every <use> on the page resolves against this sheet
    if (!document.getElementById('kray-glyphs')) {
      var g = document.createElement('div'); g.id = 'kray-glyphs'; g.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; g.innerHTML = GLYPHS;
      document.body.insertBefore(g, document.body.firstChild);
    }
    if (!document.querySelector('link[rel="icon"]')) {
      var icon = document.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/svg+xml';
      icon.href = '/kray-mark.svg?v=2';
      document.head.appendChild(icon);
    }
    var active = document.body.getAttribute('data-page') || 'home';
    try {
      if (/\/(?:u|address|profile)\/KRAY_TREASURY\/?$/i.test(location.pathname)) active = 'treasury';
      else if (/\/blackhole\/?$/i.test(location.pathname)) active = 'blackhole';
    } catch (_) { /* path paint only */ }
    if (window.KRAY_NAV !== false && !document.querySelector('header.nav')) {
      document.body.insertBefore(KRAY.el(navHTML(active)), document.getElementById('kray-glyphs').nextSibling);
    }
    if (window.KRAY_FOOTER !== false && !document.querySelector('footer.foot')) {
      document.body.appendChild(KRAY.el(footHTML()));
    }
    applyTheme(localStorage.getItem(THEME_KEY) || null);
    var tb = document.getElementById('kray-theme'); if (tb) tb.addEventListener('click', toggleTheme);
    var cb = document.getElementById('kray-connect'); if (cb) cb.addEventListener('click', doConnect);
    if (present()) restoreWallet(); else { paintWallet(null); window.addEventListener('krayWalletReady', restoreWallet); setTimeout(restoreWallet, 1200); }
    KRAY.hydratePortraits();
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          if (recs[i].addedNodes && recs[i].addedNodes.length) { KRAY.hydratePortraits(); return; }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
