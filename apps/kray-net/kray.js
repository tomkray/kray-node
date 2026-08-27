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
    { p: 'blackhole', href: '/blackhole', label: 'Black hole' },
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
    var lab = '#' + (Number.isFinite(n) ? n.toLocaleString() : KRAY.esc(String(t.star || '')));
    return KRAY.starChipArt(t) + '<span>' + lab + '</span>';
  };
  KRAY.starChipButton = function (attrs, t) {
    var inner = KRAY.starChipInner(t);
    var cls = inner.indexOf('class="sface"') >= 0 ? 'chip has-face' : 'chip';
    return '<button type="button" class="' + cls + '" ' + attrs + '>' + inner + '</button>';
  };
  /* One MP3 + APIC cover = one relic. The cover door reads only the ID3 prefix.
     No cover → the honest audio chip. Never a second inscription. */
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
    if (cover) {
      var art = document.createElement('img');
      art.className = 'music-cover';
      art.alt = '';
      art.loading = 'lazy';
      art.src = cover;
      art.onerror = function () { art.remove(); };
      box.appendChild(art);
    }
    var au = document.createElement('audio');
    au.src = url;
    au.controls = true;
    au.preload = 'metadata';
    box.appendChild(au);
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
      var wrap = document.createElement('div'); wrap.className = 'kv-paper' + (opts.mini ? '' : ' kv-paper--lg'); box.appendChild(wrap);
      var cap = opts.mini ? 4000 : 400000;
      fetch(url).then(function (r) { if (!r.ok) throw new Error('gone'); return r.text(); }).then(function (t) {
        t = t.length > cap ? t.slice(0, cap) + (opts.mini ? '' : '\n…') : t;
        if (kind === 'md') { wrap.innerHTML = '<div class="kv-mdprev">' + KRAY.mdToSafeHtml(t) + '</div>'; return; }
        if (kind === 'txt') {
          // the LETTER — a written post always arrives beautifully set. A SHORT post is a
          // QUOTE CARD: centered on both axes, type scaled to its length (a two-word verse
          // fills the tile; a paragraph settles down) — like the genesis posts looked.
          var body = t.trim(), short = body.length > 0 && body.length <= 140 && body.split('\n').length <= 4;
          var d = document.createElement('div'); d.className = 'kv-txtprev' + (short ? ' kv-txtprev--quote' : '');
          d.textContent = t;
          if (short) {
            var L = body.length;
            d.style.fontSize = (opts.mini ? Math.max(9, Math.min(16, Math.round(19 - L / 9)))
                                          : Math.max(17, Math.min(34, Math.round(38 - L / 4)))) + 'px';
          }
          wrap.appendChild(d); return;
        }
        // the CODE page — editor chrome + source, shown, never run
        var head = document.createElement('div'); head.className = 'kv-codehead';
        head.innerHTML = '<i>' + KRAY.esc(kvCodeLabel(ct)) + '</i><span>source · never executed</span>';
        var pre = document.createElement('pre'); pre.className = 'kv-srcprev';
        pre.textContent = t;                                    // textContent: never markup
        wrap.appendChild(head); wrap.appendChild(pre);
      }).catch(function () { wrap.innerHTML = '<span class="kv-chip">bytes held elsewhere</span>'; });
      return;
    }
    box.innerHTML = '<span class="kv-chip">' + KRAY.esc(String(ct || 'unknown')) + '</span>';
  };

  /* ── the era's byte price, seeded ONCE for every page (the size-burn law) ── */
  KRAY.burnOf = function (size) { return Math.max(1, Math.ceil((Number(size) || 1) / (window.kraynetBytesPerKray || 1000000))); };
  /* SI (1000): the live ceiling is 10_000_000 bytes = 10 MB. Binary 1024 would print 9.54 MB and lie. */
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
    var n = Number(bytesPer) || Number(window.kraynetBytesPerKray) || 10000;
    if (n === 10000) return '1 ₭ / 10 KB';
    if (n === 1000000) return '1 ₭ / 1 MB';
    return '1 ₭ / ' + KRAY.formatBytes(n);
  };
  try { fetch('/api/kraynet/donation/info').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.bytesPerKrayBurn) window.kraynetBytesPerKray = d.bytesPerKrayBurn;
    if (d && d.contentMax) window.kraynetContentMax = Number(d.contentMax);
    if (d) window.kraynetAtlasFeeOn = !!d.atlasFeeActive;
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
        '<div class="col foot-col"><h5>Explore</h5><a href="/">Explorer</a><a href="/blocks">Chain</a><a href="/network">Network</a><a href="/land">Land</a><a href="/city">City</a><a href="/library">Library</a><a href="/mind">Mind</a><a href="/dashboard">Dashboard</a></div>' +
        '<div class="col foot-col"><h5>Apps</h5><a href="/market">Marketplace</a><a href="/defi">DeFi</a><a href="/rune">Runes</a><a href="/send">Send</a></div>' +
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
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
