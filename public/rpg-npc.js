/** 面试官拟人立绘（SVG） */
function getNpcAvatarSvg(gate, { event = false } = {}) {
  const palettes = {
    academics: { skin: "#f5d0b5", hair: "#3d2c4a", accent: "#7c5cff", cloth: "#4a5568" },
    math_cs: { skin: "#e8c4a8", hair: "#1a1a2e", accent: "#20c997", cloth: "#2d3748" },
    projects: { skin: "#f0c9a6", hair: "#4a3728", accent: "#f6ad55", cloth: "#553c2a" },
    research: { skin: "#f5d0b5", hair: "#6b7280", accent: "#63b3ed", cloth: "#e2e8f0" },
    communication: { skin: "#e8c4a8", hair: "#2d1f1f", accent: "#fc8181", cloth: "#742a2a" },
    positioning: { skin: "#f0c9a6", hair: "#1a1a1a", accent: "#ecc94b", cloth: "#1a202c" },
    lead: { skin: "#f5d0b5", hair: "#5c4a3a", accent: "#68d391", cloth: "#2f855a" },
    setup: { skin: "#f5d0b5", hair: "#7c5cff", accent: "#b794f4", cloth: "#553c9a" },
  };
  const p = palettes[gate] || palettes.academics;
  const glow = event ? "filter:url(#evtGlow)" : "";

  const variants = {
    academics: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M28 95 Q60 55 92 95 L88 130 Q60 142 32 130 Z" fill="${p.cloth}"/>
      <path d="M35 78 Q60 48 85 78 L82 98 Q60 108 38 98 Z" fill="${p.skin}"/>
      <path d="M42 72 Q60 58 78 72" stroke="${p.hair}" stroke-width="3" fill="none"/>
      <ellipse cx="60" cy="68" rx="26" ry="30" fill="${p.skin}"/>
      <path d="M34 55 Q60 32 86 55 L82 68 Q60 52 38 68 Z" fill="${p.hair}"/>
      <rect x="44" y="64" width="14" height="6" rx="2" fill="#fff" opacity=".9"/>
      <rect x="62" y="64" width="14" height="6" rx="2" fill="#fff" opacity=".9"/>
      <circle cx="51" cy="67" r="3" fill="#2d3748"/>
      <circle cx="69" cy="67" r="3" fill="#2d3748"/>
      <path d="M52 78 Q60 84 68 78" stroke="#c4a484" stroke-width="2" fill="none"/>
      <rect x="46" y="60" width="28" height="8" rx="3" fill="none" stroke="${p.accent}" stroke-width="2"/>
    `,
    math_cs: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M26 96 Q60 52 94 96 L90 132 Q60 144 30 132 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="70" rx="28" ry="32" fill="${p.skin}"/>
      <path d="M32 48 Q60 22 88 48 L84 62 Q60 42 36 62 Z" fill="${p.hair}"/>
      <rect x="40" y="62" width="16" height="7" rx="2" fill="#fff" opacity=".95"/>
      <rect x="64" y="62" width="16" height="7" rx="2" fill="#fff" opacity=".95"/>
      <circle cx="48" cy="66" r="3.5" fill="#1a202c"/>
      <circle cx="72" cy="66" r="3.5" fill="#1a202c"/>
      <path d="M54 80 Q60 76 66 80" stroke="#a08060" stroke-width="2" fill="none"/>
      <path d="M38 58 L82 58" stroke="${p.accent}" stroke-width="2"/>
    `,
    projects: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M28 94 Q60 54 92 94 L88 130 Q60 140 32 130 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="72" rx="27" ry="31" fill="${p.skin}"/>
      <path d="M33 50 Q60 28 87 50 L83 65 Q60 48 37 65 Z" fill="${p.hair}"/>
      <circle cx="50" cy="68" r="3" fill="#2d3748"/>
      <circle cx="70" cy="68" r="3" fill="#2d3748"/>
      <path d="M52 80 Q60 86 68 80" stroke="#b8956e" stroke-width="2" fill="none"/>
      <path d="M48 52 L72 52 L68 58 L52 58 Z" fill="${p.accent}" opacity=".8"/>
    `,
    research: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M30 92 Q60 50 90 92 L86 128 Q60 138 34 128 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="70" rx="26" ry="30" fill="${p.skin}"/>
      <path d="M36 52 Q60 30 84 52 L80 66 Q60 50 40 66 Z" fill="${p.hair}"/>
      <circle cx="51" cy="66" r="3" fill="#2d3748"/>
      <circle cx="69" cy="66" r="3" fill="#2d3748"/>
      <path d="M54 78 Q60 82 66 78" stroke="#c4a484" stroke-width="2" fill="none"/>
      <rect x="42" y="88" width="36" height="28" rx="4" fill="#fff" opacity=".15"/>
    `,
    communication: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M28 95 Q60 54 92 95 L88 130 Q60 142 32 130 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="68" rx="27" ry="31" fill="${p.skin}"/>
      <path d="M34 46 Q60 24 86 46 L82 62 Q60 46 38 62 Z" fill="${p.hair}"/>
      <ellipse cx="50" cy="66" rx="4" ry="5" fill="#fff"/>
      <ellipse cx="70" cy="66" rx="4" ry="5" fill="#fff"/>
      <circle cx="50" cy="67" r="2.5" fill="#2d3748"/>
      <circle cx="70" cy="67" r="2.5" fill="#2d3748"/>
      <path d="M52 80 Q60 86 68 80" stroke="#c4a484" stroke-width="2" fill="none"/>
    `,
    positioning: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M26 94 Q60 48 94 94 L92 132 Q60 146 28 132 Z" fill="${p.cloth}"/>
      <path d="M30 92 L90 92 L88 108 L32 108 Z" fill="${p.accent}" opacity=".6"/>
      <ellipse cx="60" cy="66" rx="26" ry="30" fill="${p.skin}"/>
      <path d="M36 44 Q60 20 84 44 L80 58 Q60 42 40 58 Z" fill="${p.hair}"/>
      <circle cx="51" cy="64" r="3" fill="#1a202c"/>
      <circle cx="69" cy="64" r="3" fill="#1a202c"/>
      <path d="M54 76 Q60 80 66 76" stroke="#a08060" stroke-width="1.5" fill="none"/>
    `,
    lead: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M30 94 Q60 56 90 94 L86 128 Q60 138 34 128 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="70" rx="27" ry="30" fill="${p.skin}"/>
      <path d="M35 50 Q60 32 85 50 L81 64 Q60 50 39 64 Z" fill="${p.hair}"/>
      <path d="M48 78 Q60 84 72 78" stroke="#c4a484" stroke-width="2" fill="none"/>
      <circle cx="51" cy="66" r="3" fill="#2d3748"/>
      <circle cx="69" cy="66" r="3" fill="#2d3748"/>
      <path d="M54 50 Q60 44 66 50" stroke="${p.accent}" stroke-width="2" fill="none"/>
    `,
    setup: `
      <ellipse cx="60" cy="118" rx="38" ry="8" fill="rgba(0,0,0,.25)"/>
      <path d="M28 94 Q60 54 92 94 L88 130 Q60 140 32 130 Z" fill="${p.cloth}"/>
      <ellipse cx="60" cy="70" rx="28" ry="30" fill="${p.skin}"/>
      <path d="M32 48 Q60 26 88 48 L84 62 Q60 46 36 62 Z" fill="${p.hair}"/>
      <circle cx="50" cy="68" r="3.5" fill="#2d3748"/>
      <circle cx="70" cy="68" r="3.5" fill="#2d3748"/>
      <path d="M52 80 Q60 88 68 80" stroke="#c4a484" stroke-width="2" fill="none"/>
    `,
  };

  const body = variants[gate] || variants.academics;

  return `
    <svg class="rpg-npc-svg" viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" ${glow}>
      <defs>
        <linearGradient id="npcBg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${p.accent};stop-opacity:0.15"/>
          <stop offset="100%" style="stop-color:transparent"/>
        </linearGradient>
        <filter id="evtGlow">
          <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#ff5c7a" flood-opacity="0.6"/>
        </filter>
      </defs>
      <rect width="120" height="130" rx="16" fill="url(#npcBg)"/>
      ${body}
    </svg>
  `;
}

function getPlayerAvatarSvg(base) {
  return `
    <svg class="rpg-player-svg" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="rgba(124,92,255,.15)" stroke="rgba(124,92,255,.45)" stroke-width="2"/>
      <ellipse cx="24" cy="22" rx="12" ry="14" fill="#f5d0b5"/>
      <path d="M14 38 Q24 28 34 38" fill="#4a5568"/>
      <path d="M16 18 Q24 10 32 18 L30 24 Q24 18 18 24 Z" fill="#5c4a3a"/>
      <circle cx="20" cy="22" r="2" fill="#2d3748"/>
      <circle cx="28" cy="22" r="2" fill="#2d3748"/>
    </svg>
  `;
}

function setNpcPortrait(gate, { event = false } = {}) {
  const wrap = document.querySelector("#npcPortrait");
  if (!wrap) return;
  wrap.innerHTML = getNpcAvatarSvg(gate, { event });
  wrap.classList.toggle("event", event);
}

function setPlayerPortrait(base) {
  const wrap = document.querySelector("#playerPortrait");
  if (!wrap) return;
  wrap.innerHTML = getPlayerAvatarSvg(base);
}
