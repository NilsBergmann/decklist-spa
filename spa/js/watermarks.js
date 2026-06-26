// ── WATERMARKS + WATERMARK RESOLUTION ───────────────────────────────────────

import { COLOR_HEX } from './config.js';

export const SF = code => `https://svgs.scryfall.io/sets/${code}.svg`;

export const GUILD_NAMES = {
  WU: 'azorius', WB: 'orzhov',  WR: 'boros',  WG: 'selesnya',
  UB: 'dimir',   UR: 'izzet',   UG: 'simic',
  BR: 'rakdos',  BG: 'golgari', RG: 'gruul',
};

export const WATERMARKS = {
  none:        { label: 'None',              image: null },
  'set-color': { label: 'Set color (auto)',  image: null },
  // ── 2025 ──────────────────────────────────────────────
  eoe:  { label: 'EOE — Edge of Eternities',           image: SF('eoe') },
  // ── 2024 ──────────────────────────────────────────────
  fdn:  { label: 'FDN — Foundations',                  image: SF('fdn') },
  dsk:  { label: 'DSK — Duskmourn: House of Horror',   image: SF('dsk') },
  blb:  { label: 'BLB — Bloomburrow',                  image: SF('blb') },
  mh3:  { label: 'MH3 — Modern Horizons 3',            image: SF('mh3') },
  otj:  { label: 'OTJ — Outlaws of Thunder Junction',  image: SF('otj') },
  mkm:  { label: 'MKM — Murders at Karlov Manor',      image: SF('mkm') },
  // ── 2023 ──────────────────────────────────────────────
  lci:  { label: 'LCI — The Lost Caverns of Ixalan',   image: SF('lci') },
  woe:  { label: 'WOE — Wilds of Eldraine',            image: SF('woe') },
  mom:  { label: 'MOM — March of the Machine',         image: SF('mom') },
  one:  { label: 'ONE — Phyrexia: All Will Be One',    image: SF('one') },
  // ── 2022 ──────────────────────────────────────────────
  bro:  { label: "BRO — The Brothers' War",            image: SF('bro') },
  dmu:  { label: 'DMU — Dominaria United',             image: SF('dmu') },
  snc:  { label: 'SNC — Streets of New Capenna',       image: SF('snc') },
  neo:  { label: 'NEO — Kamigawa: Neon Dynasty',       image: SF('neo') },
  vow:  { label: 'VOW — Innistrad: Crimson Vow',       image: SF('vow') },
  mid:  { label: 'MID — Innistrad: Midnight Hunt',     image: SF('mid') },
  // ── 2021 ──────────────────────────────────────────────
  afr:  { label: 'AFR — Adventures in the Forgotten Realms', image: SF('afr') },
  stx:  { label: 'STX — Strixhaven: School of Mages', image: SF('stx') },
  khm:  { label: 'KHM — Kaldheim',                    image: SF('khm') },
  mh2:  { label: 'MH2 — Modern Horizons 2',           image: SF('mh2') },
  // ── 2020 ──────────────────────────────────────────────
  znr:  { label: 'ZNR — Zendikar Rising',              image: SF('znr') },
  iko:  { label: 'IKO — Ikoria: Lair of Behemoths',   image: SF('iko') },
  thb:  { label: 'THB — Theros Beyond Death',          image: SF('thb') },
  // ── 2019 ──────────────────────────────────────────────
  eld:  { label: 'ELD — Throne of Eldraine',           image: SF('eld') },
  war:  { label: 'WAR — War of the Spark',             image: SF('war') },
  mh1:  { label: 'MH1 — Modern Horizons',              image: SF('mh1') },
  // ── 2018 ──────────────────────────────────────────────
  grn:  { label: 'GRN — Guilds of Ravnica',            image: SF('grn') },
  m19:  { label: 'M19 — Core Set 2019',                image: SF('m19') },
  dom:  { label: 'DOM — Dominaria',                    image: SF('dom') },
  rix:  { label: 'RIX — Rivals of Ixalan',             image: SF('rix') },
  // ── 2017 ──────────────────────────────────────────────
  xln:  { label: 'XLN — Ixalan',                       image: SF('xln') },
  hou:  { label: 'HOU — Hour of Devastation',          image: SF('hou') },
  akh:  { label: 'AKH — Amonkhet',                     image: SF('akh') },
  aer:  { label: 'AER — Aether Revolt',                image: SF('aer') },
  // ── 2016 ──────────────────────────────────────────────
  kld:  { label: 'KLD — Kaladesh',                     image: SF('kld') },
  emn:  { label: 'EMN — Eldritch Moon',                image: SF('emn') },
  soi:  { label: 'SOI — Shadows over Innistrad',       image: SF('soi') },
  ogw:  { label: 'OGW — Oath of the Gatewatch',        image: SF('ogw') },
  // ── 2015 ──────────────────────────────────────────────
  bfz:  { label: 'BFZ — Battle for Zendikar',          image: SF('bfz') },
  ori:  { label: 'ORI — Magic Origins',                image: SF('ori') },
  dtk:  { label: 'DTK — Dragons of Tarkir',            image: SF('dtk') },
  frf:  { label: 'FRF — Fate Reforged',                image: SF('frf') },
  // ── 2014 ──────────────────────────────────────────────
  ktk:  { label: 'KTK — Khans of Tarkir',              image: SF('ktk') },
  m15:  { label: 'M15 — Magic 2015',                   image: SF('m15') },
  jou:  { label: 'JOU — Journey into Nyx',             image: SF('jou') },
  bng:  { label: 'BNG — Born of the Gods',             image: SF('bng') },
  // ── 2013 ──────────────────────────────────────────────
  ths:  { label: 'THS — Theros',                       image: SF('ths') },
  m14:  { label: 'M14 — Magic 2014',                   image: SF('m14') },
  dgm:  { label: "DGM — Dragon's Maze",                image: SF('dgm') },
  gtc:  { label: 'GTC — Gatecrash',                    image: SF('gtc') },
  // ── 2012 ──────────────────────────────────────────────
  rtr:  { label: 'RTR — Return to Ravnica',            image: SF('rtr') },
  m13:  { label: 'M13 — Magic 2013',                   image: SF('m13') },
  avr:  { label: 'AVR — Avacyn Restored',              image: SF('avr') },
  dka:  { label: 'DKA — Dark Ascension',               image: SF('dka') },
  // ── 2011 ──────────────────────────────────────────────
  isd:  { label: 'ISD — Innistrad',                    image: SF('isd') },
  m12:  { label: 'M12 — Magic 2012',                   image: SF('m12') },
};

// colorIdentity is WUBRG-sorted (e.g. ['W','U']); used only for set-color SVG lookup.
// primaryColor / secondaryColor are by card count (most common first); used for hex tinting.
function colorWatermarkSrc(colorIdentity) {
  if (colorIdentity.length === 1) {
    const c = colorIdentity[0].toLowerCase();
    return c === 'c' ? null : `assets/watermarks/${c}.svg`;
  }
  if (colorIdentity.length === 2) {
    const key = colorIdentity.join('');        // already WUBRG-sorted
    const guild = GUILD_NAMES[key];
    return guild ? `assets/watermarks/guild-${guild}.svg` : null;
  }
  return null;   // 3+ colors → no watermark
}

export function resolveWatermark(wmKey, colorIdentity, primaryColor, secondaryColor) {
  let source;
  if (wmKey === 'set-color') {
    source = colorWatermarkSrc(colorIdentity);
  } else {
    source = WATERMARKS[wmKey]?.image ?? null;
  }
  return {
    source,
    leftHex:  COLOR_HEX[primaryColor]   ?? '#888888',
    rightHex: COLOR_HEX[secondaryColor] ?? '#888888',
  };
}
