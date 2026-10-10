// Provider login and defaults. Edited in Settings on the TV, stored in localStorage.
var DEFAULT_CONFIG = {
  server: '',                // filled by js/config.local.js (not in git)
  username: '',
  password: '',
  liveFormat: 'ts',          // 'ts' or 'm3u8'
  defaultAspect: 'original', // original | fill | zoom235 | zoom
  debug: false,              // POST diagnostics to the laptop (Settings switch)
  dlViaLaptop: false,        // TV downloads go straight from the provider to the USB stick; NOTHING is ever stored on the laptop (Zhivko's rule, 2026-10-08)
  relay: 'http://192.168.100.80:8092',   // TV only: tells the laptop which channel it plays (fire and forget) and syncs favourites/positions when at home
  viaHome: true,             // Android (default): route everything through the home laptop (Bulgarian connection), needs homeToken
  homeToken: '',             // access token for the home API (set in config.local.js)
  homeBaseUrl: 'https://outhenticltd.github.io/los-bebos-tv-web/api-base.txt',
  posFactor: '2'             // video position correction: this TV shows AVPlay video at double the x/y given; auto | 1 | 1.5 | 2
};
function loadConfig() {
  try { var s = localStorage.getItem('doortv.config'); if (s) { var c = JSON.parse(s); for (var k in DEFAULT_CONFIG) if (!(k in c)) c[k] = DEFAULT_CONFIG[k]; return c; } } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
function saveConfig(c) { try { localStorage.setItem('doortv.config', JSON.stringify(c)); } catch (e) {} }
// js/config.local.js (gitignored) sets window.LOCAL_CONFIG = { server, username, password }
if (window.LOCAL_CONFIG) for (var _k in window.LOCAL_CONFIG) DEFAULT_CONFIG[_k] = window.LOCAL_CONFIG[_k];
var CONFIG = loadConfig();
if (window.LOCAL_CONFIG) { for (var _k2 in window.LOCAL_CONFIG) if (!CONFIG[_k2] || window.PREVIEW) CONFIG[_k2] = window.LOCAL_CONFIG[_k2]; }

// Countries shown by default (others under "All countries"). Code = prefix before "|" in the provider's category names.
var COUNTRY_NAMES = { BG: 'Bulgaria', UK: 'United Kingdom', ES: 'Spain', US: 'USA', IE: 'Ireland', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', LA: 'Latin America', MX: 'Mexico', AR: 'Arabic', DE: 'Germany', FR: 'France', IT: 'Italy', NL: 'Netherlands', PT: 'Portugal', BR: 'Brazil', TR: 'Turkey', GR: 'Greece', PL: 'Poland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', CZ: 'Czechia', HU: 'Hungary', RO: 'Romania', HR: 'Croatia', SI: 'Slovenia', SR: 'Serbia', MK: 'North Macedonia', CG: 'Montenegro', EXYU: 'Ex-Yugoslavia', AL: 'Albania', RU: 'Russia', IL: 'Israel', IR: 'Iran', KU: 'Kurdish', ASIA: 'Asia', AFR: 'Africa', CY: 'Cyprus', IS: 'Iceland', MA: 'Morocco', TN: 'Tunisia', ID: 'Indonesia', PH: 'Philippines', KR: 'Korea', JP: 'Japan', GE: 'Georgia', CR: 'Costa Rica', BO: 'Bolivia', BH: 'Bahrain', '4K': '4K channels', '8K': 'Sport on air', TS: 'Sport on demand', WT: 'World' };
var PREFERRED_COUNTRIES = ['BG', 'UK', 'ES', 'US', 'IE', 'LA', 'MX', '4K', '8K'];

// Favourites seeded on first start (stream ids from IPTV Door, October 2026). Yellow button adds/removes.
var DEFAULT_FAVS = [
  { group: 'Bulgaria', kind: 'live', id: 1460978, name: 'Max Sport 1', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 1460977, name: 'Max Sport 2', type: 'sport' },
  { group: 'Bulgaria', kind: 'live', id: 441429, name: 'Max Sport 3 4K', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 441486, name: 'Max Sport 4 4K', type: 'sport' },
  { group: 'Bulgaria', kind: 'live', id: 1460981, name: 'Diema Sport 1', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 1460980, name: 'Diema Sport 2', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 1460979, name: 'Diema Sport 3', type: 'sport' },
  { group: 'Bulgaria', kind: 'live', id: 1460967, name: 'Diema', type: 'tv' }, { group: 'Bulgaria', kind: 'live', id: 1460966, name: 'Diema Family', type: 'tv' },
  { group: 'Bulgaria', kind: 'live', id: 1460965, name: 'Ring', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 441600, name: 'bTV Action 4K', type: 'sport' }, { group: 'Bulgaria', kind: 'live', id: 1460983, name: 'Nova Sport', type: 'sport' },
  { group: 'England', kind: 'live', id: 621633, name: 'Sky Sports Premier League 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621632, name: 'Sky Sports Football 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621634, name: 'Sky Sports Main Event 4K', type: 'sport' },
  { group: 'England', kind: 'live', id: 621639, name: 'TNT Sports 1 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621638, name: 'TNT Sports 2 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621637, name: 'TNT Sports 3 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621636, name: 'TNT Sports 4 4K', type: 'sport' },
  { group: 'England', kind: 'live', id: 621620, name: 'Premier Sports 1 4K', type: 'sport' }, { group: 'England', kind: 'live', id: 621619, name: 'Premier Sports 2 4K', type: 'sport' },
  { group: 'Spain', kind: 'live', id: 2133307, name: 'DAZN LaLiga', type: 'sport' }, { group: 'Spain', kind: 'live', id: 839981, name: 'DAZN LaLiga 2', type: 'sport' },
  { group: 'Spain', kind: 'live', id: 2126805, name: 'Movistar LaLiga', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2126804, name: 'Movistar LaLiga 2', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2126803, name: 'Movistar LaLiga 3', type: 'sport' },
  { group: 'Spain', kind: 'live', id: 2144595, name: 'M+ Liga de Campeones', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2144594, name: 'M+ Liga de Campeones 2', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2144593, name: 'M+ Liga de Campeones 3', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2144592, name: 'M+ Liga de Campeones 4', type: 'sport' },
  { group: 'Spain', kind: 'live', id: 2133310, name: 'DAZN 1', type: 'sport' }, { group: 'Spain', kind: 'live', id: 2133309, name: 'DAZN 2', type: 'sport' }, { group: 'Spain', kind: 'live', id: 839946, name: 'Movistar Deportes', type: 'sport' },
  { group: 'Series', kind: 'series', id: 20392, name: 'Dark Matter (2024) 4K', icon: 'https://photo-tmdb.com/stalker_portal/screenshots/414/41312.jpg' }
];
