  // ─── 4. MENU SHELL, SETTINGS & INPUT ───
  const gameHud = document.getElementById('gameHud');
  const titleScreen = document.getElementById('titleScreen');
  const titleMenu = document.getElementById('titleMenu');
  const menuHint = document.getElementById('menuHint');
  const menuPanel = document.getElementById('menuPanel');
  const titleAside = document.getElementById('titleAside');
  const asideGlyph = document.getElementById('asideGlyph');
  const asideName = document.getElementById('asideName');
  const asideLine = document.getElementById('asideLine');
  const netDot = document.getElementById('netDot');
  const netLabel = document.getElementById('netLabel');
  const waitingModal = document.getElementById('waitingModal');
  const rulesScreen = document.getElementById('rulesScreen');
  const rulesBody = document.getElementById('rulesBody');
  const settingsScreen = document.getElementById('settingsScreen');
  const settingsBody = document.getElementById('settingsBody');
  const endModal = document.getElementById('endModal');
  const quickModal = document.getElementById('quickModal');
  const quickStatusText = document.getElementById('quickStatusText');
  const btnCloseRules = document.getElementById('btnCloseRules');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnRematch = document.getElementById('btnRematch');
  const btnExitDuel = document.getElementById('btnExitDuel');
  const btnDuelMenu = document.getElementById('btnDuelMenu');
  const btnResumeDuel = document.getElementById('btnResumeDuel');
  const btnDuelRules = document.getElementById('btnDuelRules');
  const btnDuelSettings = document.getElementById('btnDuelSettings');
  const btnForfeit = document.getElementById('btnForfeit');
  const duelMenu = document.getElementById('duelMenu');
  const spellButtonsContainer = document.getElementById('spellButtonsContainer');
  const spellFlash = document.getElementById('spellFlash');
  const heardDisplay = document.getElementById('heardDisplay');
  const btnVoiceToggle = document.getElementById('btnVoiceToggle');
  const micStatusText = document.getElementById('micStatusText');
  const hudVoiceLangSelect = document.getElementById('hudVoiceLangSelect');
  const btnHudVoiceTest = document.getElementById('btnHudVoiceTest');
  const btnHudMute = document.getElementById('btnHudMute');
  const btnTypeCast = document.getElementById('btnTypeCast');
  const typeCastForm = document.getElementById('typeCastForm');
  const typeCastInput = document.getElementById('typeCastInput');
  const disconnectBanner = document.getElementById('disconnectBanner');
  const disconnectSec = document.getElementById('disconnectSec');
  const blindnessOverlay = document.getElementById('blindnessOverlay');
  const youWindupBox = document.getElementById('youWindupBox');
  const youWindupFill = document.getElementById('youWindupFill');
  const youWindupLabel = document.getElementById('youWindupLabel');
  const oppWindupBox = document.getElementById('oppWindupBox');
  const oppWindupFill = document.getElementById('oppWindupFill');
  const oppWindupLabel = document.getElementById('oppWindupLabel');
  const waitingCodeDisplay = document.getElementById('waitingCodeDisplay');
  const btnCopyInvite = document.getElementById('btnCopyInvite');
  const btnCancelWaiting = document.getElementById('btnCancelWaiting');
  const btnCancelQuick = document.getElementById('btnCancelQuick');
  const matchClock = document.getElementById('matchClock');
  const matchIntro = document.getElementById('matchIntro');
  const bootScreen = document.getElementById('bootScreen');
  const bootFill = document.getElementById('bootFill');
  const bootStep = document.getElementById('bootStep');
  const bootTip = document.getElementById('bootTip');
  const introMe = document.getElementById('introMe');
  const introOpp = document.getElementById('introOpp');

  const CLASS_KEYS = ['fire', 'frost', 'lightning', 'earth', 'dark'];
  const CLASS_GLYPH = { fire: '🔥', frost: '❄️', lightning: '⚡', earth: '🌍', dark: '🌑' };
  const NAME_KEY = 'mage_duel_name';
  const CLASS_STORE_KEY = 'mage_duel_class';

  let playerName = (function() {
    try { return localStorage.getItem(NAME_KEY) || 'Pyromancer'; } catch (e) { return 'Pyromancer'; }
  })();
  let pendingRoomCode = '';
  let titleVisible = false;
  let bootVisible = true;
  let menuPanelOpen = false;
  let panelKey = null;
  let menuBusy = false;
  let menuActive = 0;
  let staffAimEl = null;
  let firstFrameDrawn = false;
  let currentRulesTab = 'basics';
  let currentSettingsTab = 'controls';
  let captureSlot = null;

  let roster = null;
  window.addEventListener('load', () => { roster = null; });

  // Saved class survives a refresh; the 3D preview is rebuilt to match.
  try {
    const savedClass = localStorage.getItem(CLASS_STORE_KEY);
    if (savedClass && window.CLASSES[savedClass]) selectedClass = savedClass;
  } catch (e) {}

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function saveStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function currentName() {
    const n = String(playerName || '').trim().slice(0, 14);
    return n || 'Mage';
  }

  // ─── Class + spell presentation helpers ───
  function classHex(cfg) {
    return '#' + (cfg && cfg.crystalHex ? cfg.crystalHex.toString(16).padStart(6, '0') : '5ad6e8');
  }

  function spellSlotsFor(mageClass) {
    const cfg = (window.CLASSES && window.CLASSES[mageClass]) || window.CLASSES.fire;
    const byCost = cost => cfg.spells.find(sid => window.SPELLS[sid] && window.SPELLS[sid].cost === cost);
    return [
      { slot: 'slot1', sid: byCost(1) },
      { slot: 'slot2', sid: byCost(3) },
      { slot: 'slot3', sid: byCost(10) },
      { slot: 'slot4', sid: 'heal' },
      { slot: 'slot5', sid: 'block' }
    ].filter(item => item.sid && window.SPELLS[item.sid]).map(item => {
      const sp = window.SPELLS[item.sid];
      return { slot: item.slot, sid: item.sid, spell: sp, name: sp.name, cost: sp.cost };
    });
  }

  function spellEffectLabel(spell) {
    if (spell.damage > 0) return spell.damage + ' dmg';
    if (spell.heal > 0) return '+' + spell.heal + ' HP';
    if (spell.duration > 0) return (spell.duration / 1000).toFixed(1) + 's shield';
    return 'utility';
  }

  function classChipsHTML() {
    return CLASS_KEYS.map(key => {
      const cfg = window.CLASSES[key];
      return `<button type="button" class="chip${key === selectedClass ? ' on' : ''}" data-class="${key}" style="--cl:${classHex(cfg)}">
        <span class="c-glyph">${CLASS_GLYPH[key]}</span>${escapeHtml(cfg.name.replace(' Mage', '').toUpperCase())}
      </button>`;
    }).join('');
  }

  function applyClassTheme(key) {
    const cfg = window.CLASSES[key] || window.CLASSES.fire;
    const hex = classHex(cfg);
    stage.style.setProperty('--ac', hex);
    document.documentElement.style.setProperty('--ac', hex);
    document.querySelectorAll('.chip[data-class]').forEach(chip => {
      chip.classList.toggle('on', chip.dataset.class === key);
    });
    if (asideGlyph) asideGlyph.textContent = CLASS_GLYPH[key] || '✦';
    if (asideName) asideName.textContent = cfg.name.toUpperCase();
    if (asideLine) asideLine.textContent = cfg.desc;
  }

  function setClass(key, opts) {
    if (!window.CLASSES[key]) return;
    selectedClass = key;
    saveStore(CLASS_STORE_KEY, key);
    applyClassTheme(key);
    if (!opts || opts.rebuild !== false) rebuildMages(key, 'frost');
    if (menuPanelOpen && panelKey === 'mages') renderMagesPanel();
    SFX.ui('pick');
  }

  // ─── Settings model ───
  const SETTINGS_KEY = 'mage_duel_settings_v1';
  const DEFAULT_BINDS = { slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Space' };
  const RESERVED_CODES = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Escape', 'Tab', 'Enter', 'NumpadEnter', 'F5', 'F11', 'F12'
  ]);

  const settings = loadSettings();

  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function loadSettings() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) {}
    const merged = Object.assign({
      binds: Object.assign({}, DEFAULT_BINDS),
      sens: 1,
      shake: 1,
      scanlines: true,
      smoothPixels: false
    }, stored || {});
    merged.binds = Object.assign({}, DEFAULT_BINDS, (stored && stored.binds) || {});
    merged.sens = clampNum(merged.sens, 0.4, 2.4, 1);
    merged.shake = clampNum(merged.shake, 0, 1.5, 1);
    merged.scanlines = merged.scanlines !== false;
    merged.smoothPixels = merged.smoothPixels === true;
    return merged;
  }

  function saveSettings() {
    saveStore(SETTINGS_KEY, JSON.stringify(settings));
  }

  const KEY_LABELS = {
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\'
  };

  function keyLabel(code) {
    if (!code) return '—';
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return 'NUM' + code.slice(6);
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    return KEY_LABELS[code] || String(code).toUpperCase();
  }

  function applyDisplaySettings() {
    const scan = document.querySelector('.scan');
    if (scan) scan.classList.toggle('off', !settings.scanlines);
    if (renderer && renderer.domElement) renderer.domElement.classList.toggle('smooth', !!settings.smoothPixels);
  }

  function applySettings() {
    applyDisplaySettings();
  }

  // ─── Title menu ───
  const TITLE_ITEMS = [
    { key: 'play', label: 'PLAY', sub: 'Quick duel, private room, or solo practice.' },
    { key: 'mages', label: 'MAGES', sub: 'Choose your arcane class and inspect its kit.' },
    { key: 'book', label: 'SPELLBOOK', sub: 'Every spell, cost, and spoken incantation.' },
    { key: 'rules', label: 'HOW TO PLAY', sub: 'The rules, the controls, and the timing of a parry.' },
    { key: 'settings', label: 'SETTINGS', sub: 'Keybinds, aim, audio, voice, and display.' }
  ];

  function buildTitleMenu() {
    titleMenu.innerHTML = '';
    TITLE_ITEMS.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      btn.dataset.key = item.key;
      btn.innerHTML = `<span class="mi-num">0${i + 1}</span><span>${item.label}</span>`;
      btn.addEventListener('pointerenter', () => { if (!menuPanelOpen) setMenuActive(i, false); });
      btn.addEventListener('focus', () => setMenuActive(i, false));
      btn.addEventListener('click', () => activateMenuItem(i));
      titleMenu.appendChild(btn);
    });
  }

  function setMenuActive(index, focus) {
    const items = Array.from(titleMenu.querySelectorAll('.menu-item'));
    if (!items.length) return;
    menuActive = (index + items.length) % items.length;
    items.forEach((btn, i) => btn.classList.toggle('act', i === menuActive));
    if (menuHint) menuHint.textContent = TITLE_ITEMS[menuActive].sub;
    if (!menuPanelOpen) staffAimEl = items[menuActive];
    if (focus) items[menuActive].focus();
  }

  function activateMenuItem(index) {
    if (!titleVisible || menuBusy) return;
    const item = TITLE_ITEMS[index];
    const btn = titleMenu.querySelectorAll('.menu-item')[index];
    if (!item || !btn) return;
    if (item.key === 'rules') {
      SFX.ui('select');
      fireMenuBeam(btn, () => showRules('basics'));
      return;
    }
    if (item.key === 'settings') {
      SFX.ui('select');
      fireMenuBeam(btn, () => showSettings('controls'));
      return;
    }
    menuBusy = true;
    SFX.ui('select');
    fireMenuBeam(btn, () => {
      menuBusy = false;
      openPanel(item.key);
    });
    setTimeout(() => { menuBusy = false; }, 700);
  }

  // ─── Right-hand panel ───
  function panelShell(title, eyebrow, body) {
    return `<div class="panel-head">
        <div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div>
        <button class="panel-close" type="button" data-close-panel aria-label="Close panel">✕</button>
      </div>
      <div class="panel-scroll">${body}</div>`;
  }

  function openPanel(key) {
    if (!titleVisible) return;
    menuPanelOpen = true;
    panelKey = key;
    titleMenu.classList.add('dim');
    titleScreen.classList.add('panel-open');
    menuPanel.classList.add('on');
    staffAimEl = menuPanel;
    if (key === 'play') renderPlayPanel();
    else if (key === 'mages') renderMagesPanel();
    else if (key === 'book') renderSpellbookPanel();
    menuPanel.scrollTop = 0;
    menuPanel.querySelectorAll('[data-close-panel]').forEach(b => b.addEventListener('click', closePanel));
  }

  function closePanel() {
    if (!menuPanelOpen) return;
    menuPanelOpen = false;
    panelKey = null;
    menuPanel.classList.remove('on');
    menuPanel.innerHTML = '';
    titleMenu.classList.remove('dim');
    titleScreen.classList.remove('panel-open');
    if (titleVisible) staffAimEl = titleMenu.querySelectorAll('.menu-item')[menuActive] || null;
  }

  function panelNotice(message, isError) {
    const el = document.getElementById('panelNotice');
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.style.color = isError ? '#fca5a5' : '#b3abd8';
    el.style.borderLeftColor = isError ? '#f87171' : '#4a3e9c';
    clearTimeout(panelNotice._t);
    if (message) panelNotice._t = setTimeout(() => { el.style.display = 'none'; }, 4200);
  }

  function renderPlayPanel() {
    menuPanel.innerHTML = panelShell('ENTER THE DUEL', 'ARCANE ARENA', `
      <p class="panel-lede">Pick a class, then choose how you want to fight. Every mage has the same five-slot kit.</p>
      <div class="sec-label"><span>MAGE NAME</span><span>SHOWN TO YOUR RIVAL</span></div>
      <input id="mageNameInput" class="arc-input" maxlength="14" autocomplete="off" value="${escapeHtml(playerName)}" placeholder="Your mage name" />
      <div class="sec-label"><span>CLASS</span><span>FIVE KITS · EQUAL POWER</span></div>
      <div class="chip-row" id="playClassChips">${classChipsHTML()}</div>
      <div class="sec-label"><span>GAME MODE</span><span>ONLINE OR OFFLINE</span></div>
      <div class="mode-grid">
        <button class="mode-card primary wide" type="button" data-mode="quick">
          <em>ONLINE</em><b>QUICK DUEL</b><span>Pair with the next mage searching. No room code, no waiting around.</span>
        </button>
        <button class="mode-card" type="button" data-mode="practice"><b>SOLO PRACTICE</b><span>Unlimited mana against a training dummy.</span></button>
        <button class="mode-card" type="button" data-mode="create"><b>CREATE ROOM</b><span>Get a code and invite a friend.</span></button>
      </div>
      <div class="sec-label"><span>JOIN WITH CODE</span><span>4–6 LETTERS</span></div>
      <div class="join-row">
        <input id="roomCodeInput" class="arc-input" maxlength="6" autocomplete="off" placeholder="ROOM CODE" style="text-transform: uppercase;" value="${escapeHtml(pendingRoomCode)}" />
        <button class="arc-btn" type="button" data-mode="join">JOIN</button>
      </div>
      <p class="set-note" id="panelNotice" style="display:none"></p>
      <div class="panel-foot">
        <span>Voice, keybinds and display live in Settings.</span>
        <button class="link-btn" type="button" data-open-settings>OPEN SETTINGS →</button>
      </div>
    `);

    const nameInput = document.getElementById('mageNameInput');
    nameInput.addEventListener('input', () => {
      playerName = nameInput.value;
      saveStore(NAME_KEY, playerName);
    });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); startQuickDuel(); }
    });

    menuPanel.querySelectorAll('#playClassChips .chip').forEach(chip => {
      chip.addEventListener('click', () => setClass(chip.dataset.class));
    });

    const codeInput = document.getElementById('roomCodeInput');
    codeInput.addEventListener('input', () => {
      const cleaned = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (codeInput.value !== cleaned) codeInput.value = cleaned;
      pendingRoomCode = cleaned;
    });
    codeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); joinRoom(); }
    });

    menuPanel.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'quick') startQuickDuel();
        else if (mode === 'practice') startPractice();
        else if (mode === 'create') createRoom();
        else if (mode === 'join') joinRoom();
      });
    });
    const setLink = menuPanel.querySelector('[data-open-settings]');
    if (setLink) setLink.addEventListener('click', () => showSettings('controls'));
    copyClassThemeToPanel();
  }

  function copyClassThemeToPanel() {
    menuPanel.style.setProperty('--ac', getComputedStyle(stage).getPropertyValue('--ac').trim() || '#5ad6e8');
  }

  function renderMagesPanel() {
    const cfg = window.CLASSES[selectedClass] || window.CLASSES.fire;
    const slots = spellSlotsFor(selectedClass);
    menuPanel.innerHTML = panelShell('CHOOSE YOUR MAGE', 'CLASS SELECT', `
      <p class="panel-lede">All five mages share the same spell costs and timings. Class identity comes from the signature spell and the 3-hit passive.</p>
      <div class="class-list">
        ${CLASS_KEYS.map(key => {
          const c = window.CLASSES[key];
          return `<button class="class-line${key === selectedClass ? ' on' : ''}" type="button" data-class="${key}" style="--cl:${classHex(c)}">
            <span class="cl-glyph">${CLASS_GLYPH[key]}</span>
            <span class="cl-name">${escapeHtml(c.name.toUpperCase())}</span>
            <span class="cl-tag">${escapeHtml(c.element.toUpperCase())}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="class-hero" style="--cl:${classHex(cfg)}">
        <h3>${CLASS_GLYPH[selectedClass]} <span>${escapeHtml(cfg.name.toUpperCase())}</span></h3>
        <p>${escapeHtml(cfg.desc)}</p>
      </div>
      <div class="sec-label"><span>KIT</span><span>${escapeHtml(cfg.spells.length + ' SPELLS')}</span></div>
      ${slots.map(item => `<div class="spell-row" style="--cl:${classHex(cfg)}">
        <span class="sr-name"><span class="sr-cost">${keyLabel(settings.binds[item.slot])}</span>${escapeHtml(item.spell.name)}</span>
        <span class="sr-chant">“${escapeHtml(item.spell.incantation)}”</span>
      </div>`).join('')}
      <div class="passive-line" style="--cl:${classHex(cfg)}"><strong>PASSIVE · </strong>${escapeHtml(passiveText(selectedClass))}</div>
      <div class="panel-foot">
        <span>Selected: <b style="color:${classHex(cfg)};font-weight:400">${escapeHtml(cfg.name.toUpperCase())}</b></span>
        <button class="arc-btn primary" type="button" data-go-play>ENTER THE DUEL →</button>
      </div>
    `);
    menuPanel.querySelectorAll('.class-line').forEach(btn => {
      btn.addEventListener('click', () => setClass(btn.dataset.class));
    });
    const go = menuPanel.querySelector('[data-go-play]');
    if (go) go.addEventListener('click', () => openPanel('play'));
    copyClassThemeToPanel();
  }

  function passiveText(key) {
    const map = {
      fire: 'Land 3 Sparks on the same rival to ignite them: 2 damage every 0.8s for 2.5s.',
      frost: 'Land 3 Ice Shards to chill your rival, halving their mana regeneration for 2.5s.',
      lightning: 'Land 3 Zaps to instantly burn 1 mana off your rival.',
      earth: 'Land 3 Pebbles to trigger a tremor: the rival’s next spell gains 0.8s of cooldown.',
      dark: 'Land 3 Shadow Darts to blind your rival for 2s — their screen closes in.'
    };
    return map[key] || '';
  }

  function renderSpellbookPanel() {
    const cfg = window.CLASSES[selectedClass] || window.CLASSES.fire;
    const slots = spellSlotsFor(selectedClass);
    menuPanel.innerHTML = panelShell('SPELLBOOK', escapeHtml(cfg.name.toUpperCase()), `
      <div class="chip-row">${classChipsHTML()}</div>
      <p class="panel-lede" style="margin-top:.7em">Say the incantation, press the bound key, or tap the card. Wind-up spells telegraph before they land.</p>
      ${slots.map(item => {
        const sp = item.spell;
        const wind = sp.windUp > 0 ? (sp.windUp / 1000).toFixed(1) + 's cast' : 'instant';
        const cd = sp.cooldown > 0 ? (sp.cooldown / 1000) + 's cooldown' : 'no cooldown';
        return `<div class="kit-card" style="--cl:${classHex(cfg)}; margin-top:.5em">
          <div class="kit-head">
            <h4><span>${keyLabel(settings.binds[item.slot])}</span> · ${escapeHtml(sp.name)}</h4>
            <em>${sp.cost > 0 ? sp.cost + ' MANA' : 'FREE'}</em>
          </div>
          <div class="kit-spells" style="margin-top:.3em">
            <div class="kit-spell"><span class="ks-chant">“${escapeHtml(sp.incantation)}”</span></div>
            <div class="kit-spell"><b>${spellEffectLabel(sp)}</b><span class="ks-meta">${wind} · ${cd}</span></div>
          </div>
          ${sp.blockable === false ? '<div class="set-note" style="margin-top:.45em"><b>Ignores Block.</b> This spell cannot be shielded the normal way.</div>' : ''}
          ${sp.interruptible ? '<div class="set-note" style="margin-top:.45em"><b>Interruptible.</b> Any unblocked hit cancels the cast' + (sp.manaRefund ? ` and refunds ${sp.manaRefund} mana.` : '.') + '</div>' : ''}
        </div>`;
      }).join('')}
      <div class="passive-line"><strong>PASSIVE · </strong>${escapeHtml(passiveText(selectedClass))}</div>
      <div class="panel-foot">
        <span>The same incantations work when spoken aloud.</span>
        <button class="arc-btn primary" type="button" data-go-play>DUEL WITH THIS MAGE →</button>
      </div>
    `);
    menuPanel.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        setClass(chip.dataset.class);
        renderSpellbookPanel();
      });
    });
    const go = menuPanel.querySelector('[data-go-play]');
    if (go) go.addEventListener('click', () => openPanel('play'));
    copyClassThemeToPanel();
  }

  // ─── Codex (rules) ───
  function ruleCard(title, html) {
    return `<div class="rule-card"><h4>${title}</h4>${html}</div>`;
  }

  function renderRules() {
    document.querySelectorAll('#rulesTabs .tab').forEach(t => {
      t.classList.toggle('on', t.dataset.tab === currentRulesTab);
    });
    if (currentRulesTab === 'controls') {
      rulesBody.innerHTML = rulesControlsHTML();
      return;
    }
    if (currentRulesTab === 'kits') {
      rulesBody.innerHTML = rulesKitsHTML();
      return;
    }

    const player = window.PLAYER;
    const blockSpell = window.SPELLS.block;
    const ult = window.SPELLS.inferno_nova;
    const thunder = window.SPELLS.thunder_strike;
    const surgeAt = player.lowHpThreshold;
    const perfect = (player.perfectBlockWindow / 1000).toFixed(1);
    const blockSec = (blockSpell.duration / 1000).toFixed(1);
    const blockCd = (blockSpell.cooldown / 1000).toFixed(0);
    const stunSec = (player.stunDuration / 1000).toFixed(1);
    const ultStunSec = (player.ultimateStunDuration / 1000).toFixed(1);
    const sudden = (player.suddenDeathTime / 60000).toFixed(0);
    const slots = spellSlotsFor(selectedClass);

    rulesBody.innerHTML = `
      <h3>THE DUEL, IN ONE SCREEN</h3>
      <p>Both mages start at ${player.maxHp} HP and ${player.startMana} mana. Cast spells to break the rival's guard; the first mage at 0 HP loses.</p>
      <div class="rule-grid">
        ${ruleCard('1 · THE GOAL', `
          <ul>
            <li>Reduce your rival from <strong>${player.maxHp} HP</strong> to 0.</li>
            <li>At <strong>${sudden} minutes</strong> the arena turns lethal: both mages lose <strong>${player.suddenDeathDps} HP per second</strong>.</li>
            <li>Leaving mid-duel counts as a forfeit.</li>
          </ul>`)}
        ${ruleCard('2 · MANA', `
          <ul>
            <li>Start at <strong>${player.startMana} / ${player.maxMana}</strong> and regenerate <strong>${player.manaRegen} per second</strong>.</li>
            <li>Quick spell <strong>1</strong> · signature <strong>3</strong> · heal <strong>4</strong> · ultimate <strong>${ult.cost}</strong>.</li>
            <li>At <strong>${surgeAt} HP or below</strong>, your regen rises to <strong>${player.lowHpManaRegen}/s</strong>. The HUD announces it as a SURGE.</li>
          </ul>`)}
        ${ruleCard('3 · CASTING', `
          <ul>
            <li><strong>Press</strong> the bound key, <strong>tap</strong> the spell card, or <strong>speak</strong> the incantation.</li>
            <li>Quick spells resolve instantly. Signature and ultimate spells have a <strong>wind-up</strong> — the rival can see and interrupt it.</li>
            <li>Any unblocked hit cancels an interruptible cast. A parried ultimate also costs the caster <strong>${ult.manaRefund || 0} mana</strong> back on interrupt.</li>
            <li>You must wait out a spell's cooldown before casting it again.</li>
          </ul>`)}
        ${ruleCard('4 · DEFENCE', `
          <ul>
            <li>Block is <strong>free</strong>, lasts <strong>${blockSec}s</strong>, and has a <strong>${blockCd}s cooldown</strong>.</li>
            <li>A block absorbs all damage from blockable spells.</li>
            <li>Block within <strong>${perfect}s</strong> of impact for a <strong>PERFECT BLOCK</strong>: the attacker is stunned for <strong>${stunSec}s</strong> and their cast is cancelled.</li>
            <li>Parrying an ultimate stuns the caster for <strong>${ultStunSec}s</strong>; a normal block still takes <strong>${ult.chipDamage} chip damage</strong>.</li>
            <li><strong>Thunder Strike ignores Block</strong> (${thunder.damage} damage).</li>
          </ul>`)}
        ${ruleCard('5 · STATUS EFFECTS', `
          <ul>
            <li><strong>BURN</strong> — 2 damage every 0.8s for 2.5s.</li>
            <li><strong>CHILL</strong> — mana regeneration halved for 2.5s.</li>
            <li><strong>BLIND</strong> — the arena closes in for 2s.</li>
            <li><strong>TREMOR</strong> — the next spell gains 0.8s of cooldown.</li>
            <li><strong>STONE ARMOUR</strong> — absorbs up to 16 damage.</li>
          </ul>`)}
        ${ruleCard('6 · YOUR KEYS', `
          <ul>
            ${slots.map(item => `<li><kbd class="key">${keyLabel(settings.binds[item.slot])}</kbd> ${escapeHtml(item.spell.name)} <span class="accent">(${item.cost > 0 ? item.cost + 'M' : 'FREE'})</span></li>`).join('')}
          </ul>
          <p style="margin-top:.4em">Change these in <strong>Settings → Controls</strong>.</p>`)}
      </div>
      <p class="set-note">Tip: the fastest way to learn a class is <b>Solo Practice</b> from the Play menu. Mana is unlimited there, so you can rehearse wind-ups and parry timing without losing a duel.</p>
    `;
  }

  function rulesControlsHTML() {
    const slots = spellSlotsFor(selectedClass);
    return `
      <h3>CONTROLS</h3>
      <p>Move with your left hand, aim with the mouse, and cast without letting go of either. Touch devices can tap the spell dock.</p>
      <table class="control-table">
        <tr><td>Move</td><td><kbd class="key">W</kbd> <kbd class="key">A</kbd> <kbd class="key">S</kbd> <kbd class="key">D</kbd> — relative to where you face</td></tr>
        <tr><td>Aim</td><td>Hold <kbd class="key">RMB</kbd> and move the mouse — or drag on touch. <kbd class="key">Q</kbd> / <kbd class="key">E</kbd> and <kbd class="key">←</kbd> <kbd class="key">→</kbd> turn without the mouse.</td></tr>
        ${slots.map(item => `<tr><td>${escapeHtml(item.spell.name)}</td><td><kbd class="key">${keyLabel(settings.binds[item.slot])}</kbd> — tap the card or say “${escapeHtml(item.spell.incantation)}”</td></tr>`).join('')}
        <tr><td>Voice casting</td><td>Enable the mic in <strong>Settings → Audio &amp; Voice</strong>, then speak a spell name or its incantation. Chrome and Edge have the widest support.</td></tr>
        <tr><td>Typed casting</td><td>Press <kbd class="key">TYPE</kbd> in the duel HUD, type an incantation, press <kbd class="key">Enter</kbd>.</td></tr>
        <tr><td>Duel menu</td><td><kbd class="key">ESC</kbd> — resume, rules, settings, or forfeit.</td></tr>
        <tr><td>Menu</td><td><kbd class="key">↑</kbd> <kbd class="key">↓</kbd> to move, <kbd class="key">ENTER</kbd> to select, <kbd class="key">ESC</kbd> to go back.</td></tr>
      </table>
      <div class="set-note"><b>Why right-click?</b> Aiming is independent of movement so you can strafe while lining up a spell. Your left hand keeps the movement keys and spell binds free.</div>
      <div class="set-note">Aim sensitivity and screen shake are adjustable in <strong>Settings → Controls</strong>.</div>
    `;
  }

  function rulesKitsHTML() {
    return `
      <h3>MAGES &amp; SPELLS</h3>
      <p>Five classes, five identical slots each. The difference is the signature spell and the passive that rewards landing the quick spell three times.</p>
      ${CLASS_KEYS.map(key => {
        const cfg = window.CLASSES[key];
        const slots = spellSlotsFor(key);
        return `<div class="kit-card" style="--cl:${classHex(cfg)}">
          <div class="kit-head">
            <h4>${CLASS_GLYPH[key]} <span>${escapeHtml(cfg.name.toUpperCase())}</span></h4>
            <em>${escapeHtml(cfg.element.toUpperCase())}</em>
          </div>
          <p class="kit-desc">${escapeHtml(cfg.desc)}</p>
          <div class="kit-spells">
            ${slots.map(item => `<div class="kit-spell">
              <b>${escapeHtml(item.spell.name)}</b>
              <span class="ks-meta">${item.cost > 0 ? item.cost + 'M' : 'FREE'} · ${spellEffectLabel(item.spell)}</span>
              <span class="ks-chant">“${escapeHtml(item.spell.incantation)}”</span>
            </div>`).join('')}
          </div>
          <div class="kit-passive"><strong>PASSIVE · </strong>${escapeHtml(passiveText(key))}</div>
        </div>`;
      }).join('')}
    `;
  }

  function showRules(tab) {
    currentRulesTab = tab || currentRulesTab || 'basics';
    renderRules();
    rulesScreen.classList.add('on');
    if (duelMenu.classList.contains('on')) duelMenu.classList.remove('on');
  }

  function closeRules() {
    rulesScreen.classList.remove('on');
  }

  // ─── Settings screen ───
  function renderSettings() {
    document.querySelectorAll('#settingsTabs .tab').forEach(t => {
      t.classList.toggle('on', t.dataset.tab === currentSettingsTab);
    });
    if (currentSettingsTab === 'audio') { renderSettingsAudio(); return; }
    if (currentSettingsTab === 'display') { renderSettingsDisplay(); return; }
    renderSettingsControls();
  }

  function renderSettingsControls() {
    const slots = spellSlotsFor(selectedClass);
    settingsBody.innerHTML = `
      <h3>CONTROLS</h3>
      <p>Click a key, then press the replacement. Movement keys, arrows and Escape stay reserved.</p>
      <div class="sec-label"><span>SPELL KEYBINDS</span><span>${escapeHtml((window.CLASSES[selectedClass] || window.CLASSES.fire).name.toUpperCase())}</span></div>
      ${slots.map(item => `<div class="set-row">
        <div>
          <span class="set-label">${escapeHtml(item.spell.name)}</span>
          <span class="set-sub">${item.cost > 0 ? item.cost + ' mana' : 'free'} · “${escapeHtml(item.spell.incantation)}”</span>
        </div>
        <div class="set-control">
          <button class="bind-btn${captureSlot === item.slot ? ' capturing' : ''}" type="button" data-bind="${item.slot}">
            ${captureSlot === item.slot ? 'PRESS A KEY…' : keyLabel(settings.binds[item.slot])}
          </button>
        </div>
      </div>`).join('')}
      <div class="sec-label"><span>AIM &amp; FEEL</span><span>TAKES EFFECT IMMEDIATELY</span></div>
      <div class="set-row">
        <div><span class="set-label">Aim sensitivity</span><span class="set-sub">Mouse and touch look speed</span></div>
        <div class="set-control">
          <input class="arc-range" type="range" min="0.4" max="2.4" step="0.1" value="${settings.sens}" data-range="sens" aria-label="Aim sensitivity" />
          <span class="range-val" id="sensVal">${settings.sens.toFixed(1)}×</span>
        </div>
      </div>
      <div class="set-row">
        <div><span class="set-label">Screen shake</span><span class="set-sub">Impact and parry camera kick</span></div>
        <div class="set-control">
          <input class="arc-range" type="range" min="0" max="1.5" step="0.1" value="${settings.shake}" data-range="shake" aria-label="Screen shake" />
          <span class="range-val" id="shakeVal">${Math.round(settings.shake * 100)}%</span>
        </div>
      </div>
      <p class="set-note"><b>Movement is fixed</b> to <kbd class="key">W</kbd><kbd class="key">A</kbd><kbd class="key">S</kbd><kbd class="key">D</kbd> and aiming to the mouse / <kbd class="key">Q</kbd><kbd class="key">E</kbd>, so keybinds can never lock you out of moving.</p>
      <div class="panel-foot"><span>Bindings are stored on this device.</span></div>
    `;
    settingsBody.querySelectorAll('.bind-btn').forEach(btn => {
      btn.addEventListener('click', () => beginBind(btn.dataset.bind));
    });
    settingsBody.querySelectorAll('[data-range]').forEach(range => {
      range.addEventListener('input', () => {
        const key = range.dataset.range;
        const value = Number(range.value);
        if (key === 'sens') {
          settings.sens = clampNum(value, 0.4, 2.4, 1);
          const out = document.getElementById('sensVal');
          if (out) out.textContent = settings.sens.toFixed(1) + '×';
        } else {
          settings.shake = clampNum(value, 0, 1.5, 1);
          const out = document.getElementById('shakeVal');
          if (out) out.textContent = Math.round(settings.shake * 100) + '%';
        }
        saveSettings();
      });
    });
  }

  function renderSettingsAudio() {
    const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const muted = SFX.isMuted();
    settingsBody.innerHTML = `
      <h3>AUDIO &amp; VOICE</h3>
      <p>Every spell has its own sound. Wind-ups play a rising tone that peaks on impact, so you can hear a cast before the bar fills.</p>
      <div class="sec-label"><span>SOUND</span></div>
      <div class="set-row">
        <div><span class="set-label">Spell &amp; arena effects</span><span class="set-sub">Sample bank with procedural fallback</span></div>
        <div class="set-control"><button class="toggle${muted ? '' : ' on'}" type="button" data-toggle="sfx">${muted ? 'OFF' : 'ON'}</button></div>
      </div>
      <div class="sec-label"><span>VOICE CASTING</span><span>${supported ? 'SUPPORTED' : 'UNAVAILABLE IN THIS BROWSER'}</span></div>
      <div class="set-row">
        <div>
          <span class="set-label">Microphone casting</span>
          <span class="set-sub">${supported ? 'Say a spell name or its incantation' : 'Use Chrome or Edge for speech recognition'}</span>
        </div>
        <div class="set-control">
          <select id="setVoiceLang" class="voice-lang-select" aria-label="Voice accent">
            <option value="en-IN">English (India)</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-AU">English (Australia)</option>
          </select>
          <button class="toggle${voiceOn ? ' on' : ''}" type="button" data-toggle="voice" ${supported ? '' : 'disabled'}>${voiceOn ? 'ON' : 'OFF'}</button>
        </div>
      </div>
      <div class="set-row">
        <div><span class="set-label">Microphone test</span><span class="set-sub">Checks permission and transcription</span></div>
        <div class="set-control"><button class="arc-btn ghost" type="button" id="btnSetMicTest">TEST MIC</button></div>
      </div>
      <p class="set-note" id="setVoiceStatus">${supported ? 'Microphone requires HTTPS or localhost. Speech is processed by your browser’s speech service.' : 'Speech recognition is not available in Firefox. Typed and tap casting always work.'}</p>
      <p class="set-note"><b>No microphone?</b> Tap the spell cards, use the bound keys, or open the TYPE bar in the duel. All three cast the same spells.</p>
      <div class="panel-foot"><span>Accent affects recognition only.</span></div>
    `;

    const lang = document.getElementById('setVoiceLang');
    if (lang) {
      try {
        lang.value = localStorage.getItem('mage_duel_voice_lang') || (hudVoiceLangSelect ? hudVoiceLangSelect.value : 'en-US');
      } catch (e) {}
      lang.addEventListener('change', () => {
        if (hudVoiceLangSelect) {
          hudVoiceLangSelect.value = lang.value;
          hudVoiceLangSelect.dispatchEvent(new Event('change'));
        }
      });
    }

    settingsBody.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.toggle === 'sfx') {
          toggleMute();
          btn.classList.toggle('on', !SFX.isMuted());
          btn.textContent = SFX.isMuted() ? 'OFF' : 'ON';
        } else {
          toggleVoice();
          btn.classList.toggle('on', voiceOn);
          btn.textContent = voiceOn ? 'ON' : 'OFF';
        }
      });
    });

    const micBtn = document.getElementById('btnSetMicTest');
    if (micBtn) micBtn.addEventListener('click', () => {
      const status = document.getElementById('setVoiceStatus');
      if (status) status.textContent = 'Requesting microphone permission…';
      runVoiceDiagnostic();
    });

    syncSettingsVoiceStatus();
    copyClassThemeToPanel();
  }

  function renderSettingsDisplay() {
    settingsBody.innerHTML = `
      <h3>DISPLAY</h3>
      <p>The arena is rendered at a fixed retro resolution. These options change how that image sits on your screen.</p>
      <div class="sec-label"><span>IMAGE</span></div>
      <div class="set-row">
        <div><span class="set-label">Scanlines &amp; vignette</span><span class="set-sub">CRT overlay and darkened corners</span></div>
        <div class="set-control"><button class="toggle${settings.scanlines ? ' on' : ''}" type="button" data-toggle="scanlines">${settings.scanlines ? 'ON' : 'OFF'}</button></div>
      </div>
      <div class="set-row">
        <div><span class="set-label">Smooth pixels</span><span class="set-sub">Bilinear upscale instead of crisp pixels</span></div>
        <div class="set-control"><button class="toggle${settings.smoothPixels ? ' on' : ''}" type="button" data-toggle="smooth">${settings.smoothPixels ? 'ON' : 'OFF'}</button></div>
      </div>
      <div class="set-row">
        <div><span class="set-label">Screen shake</span><span class="set-sub">Adjusted in Controls</span></div>
        <div class="set-control"><span class="range-val">${Math.round(settings.shake * 100)}%</span></div>
      </div>
      <p class="set-note"><b>Performance:</b> if the arena stutters on a low-power device, turning scanlines off and staying away from 2× browser zoom keeps the frame cost down.</p>
      <div class="panel-foot"><span>Display settings are saved automatically.</span></div>
    `;
    settingsBody.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.toggle === 'scanlines') {
          settings.scanlines = !settings.scanlines;
          btn.classList.toggle('on', settings.scanlines);
          btn.textContent = settings.scanlines ? 'ON' : 'OFF';
        } else {
          settings.smoothPixels = !settings.smoothPixels;
          btn.classList.toggle('on', settings.smoothPixels);
          btn.textContent = settings.smoothPixels ? 'ON' : 'OFF';
        }
        saveSettings();
        applyDisplaySettings();
      });
    });
  }

  function beginBind(slot) {
    captureSlot = captureSlot === slot ? null : slot;
    renderSettingsControls();
    const active = settingsBody.querySelector(`.bind-btn[data-bind="${captureSlot}"]`);
    if (active) active.focus();
  }

  function cancelBind(event) {
    if (!captureSlot) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    captureSlot = null;
    renderSettingsControls();
    return true;
  }

  // Capture phase: a key captured for a bind must never also cast a spell.
  window.addEventListener('keydown', e => {
    if (!captureSlot) return;
    e.preventDefault();
    e.stopPropagation();
    const code = e.code || e.key;
    if (code === 'Escape') { cancelBind(); return; }
    if (RESERVED_CODES.has(code) || /^(Shift|Control|Alt|Meta)/.test(code)) {
      const btn = settingsBody.querySelector(`.bind-btn[data-bind="${captureSlot}"]`);
      if (btn) {
        btn.textContent = 'RESERVED';
        btn.classList.add('capturing');
        setTimeout(() => { if (captureSlot) renderSettingsControls(); }, 700);
      }
      return;
    }
    const previous = settings.binds[captureSlot];
    const other = Object.keys(settings.binds).find(k => k !== captureSlot && settings.binds[k] === code);
    if (other) settings.binds[other] = previous;
    settings.binds[captureSlot] = code;
    captureSlot = null;
    saveSettings();
    refreshBinds();
    renderSettingsControls();
    SFX.ui('confirm');
  }, true);

  function refreshBinds() {
    buildSpellButtons(myMageClass || selectedClass);
  }

  function showSettings(tab) {
    currentSettingsTab = tab || currentSettingsTab || 'controls';
    renderSettings();
    settingsScreen.classList.add('on');
    if (duelMenu.classList.contains('on')) duelMenu.classList.remove('on');
  }

  function closeSettings() {
    captureSlot = null;
    settingsScreen.classList.remove('on');
  }

  function syncSettingsVoiceStatus() {
    const el = document.getElementById('setVoiceStatus');
    if (!el) return;
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return;
    el.textContent = voiceOn
      ? 'Microphone is live. Say a spell name or incantation while in a duel.'
      : 'Microphone is off. Enable it above, then speak during a duel.';
  }

  // ─── Boot sequence ───
  const BOOT_TIPS = [
    'A perfect block is read, not spammed — block within 0.6s of impact.',
    'Three quick spells in a row trigger your class passive.',
    'At 30 HP your mana surges. The HUD will tell you.',
    'Every ultimate has a long, audible wind-up. Interrupt it.',
    'Ultimates reset the rival’s block cooldown. Save yours for the opening.',
    'Mana is the real health bar. A dry mage cannot block forever.',
    'Say the incantation out loud — the staff listens.'
  ];

  function startBoot() {
    bootTip.textContent = BOOT_TIPS[Math.floor(Math.random() * BOOT_TIPS.length)];
    const startedAt = performance.now();
    let shown = 0.04;
    let last = startedAt;
    let finished = false;

    const steps = [
      [0.0, 'WAKING THE ARENA…'],
      [0.22, 'CARVING THE DUELING FLOOR…'],
      [0.46, 'BINDING SPELL SOUNDS…'],
      [0.72, 'CONTACTING THE COUNCIL…'],
      [0.94, 'THE MAGES ARE READY.']
    ];

    function readyFraction() {
      let ready = 0.1;
      if (firstFrameDrawn) ready += 0.22;
      if (window.AUDIO && window.AUDIO.status) {
        try {
          const st = window.AUDIO.status();
          const ratio = st.files ? Math.min(1, (st.fetched + st.loaded) / st.files) : 0;
          ready += 0.36 * ratio;
        } catch (e) {}
      }
      if (socket.connected) ready += 0.3;
      return ready;
    }

    function paintStep() {
      let label = steps[0][1];
      for (let i = steps.length - 1; i >= 0; i--) {
        if (shown >= steps[i][0]) { label = steps[i][1]; break; }
      }
      if (bootStep.textContent !== label) bootStep.textContent = label;
    }

    function tick() {
      if (finished) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const target = Math.min(0.99, readyFraction());
      shown += Math.min(Math.max(0, target - shown), dt * 0.8);
      bootFill.style.width = (Math.floor(shown * 1000) / 10) + '%';
      paintStep();

      const elapsed = (now - startedAt) / 1000;
      if ((shown > 0.985 && elapsed > 1.5) || elapsed > 6.5) {
        finished = true;
        bootFill.style.width = '100%';
        bootStep.textContent = 'THE MAGES ARE READY.';
        setTimeout(finishBoot, 300);
        return;
      }
      setTimeout(tick, 55);
    }
    tick();
  }

  function finishBoot() {
    bootVisible = false;
    bootScreen.classList.add('gone');
    setTimeout(() => {
      showTitle();
      if (pendingRoomCode) {
        openPanel('play');
        const input = document.getElementById('roomCodeInput');
        if (input) { input.value = pendingRoomCode; input.focus(); }
      }
    }, 280);
  }

  function showTitle() {
    if (gameHud.style.display !== 'none') return;
    bootVisible = false;
    titleVisible = true;
    titleScreen.classList.add('on');
    closePanel();
    applyClassTheme(selectedClass);
    rebuildMages(selectedClass, 'frost');
    updateNetState();
    if (!titleMenu.querySelector('.menu-item')) buildTitleMenu();
    setMenuActive(menuActive, false);
  }

  function hideTitle() {
    titleVisible = false;
    titleScreen.classList.remove('on');
    closePanel();
    matchIntro.classList.remove('on');
  }

  function updateNetState() {
    const online = socket.connected;
    if (netDot) netDot.classList.toggle('on', online);
    if (netLabel) netLabel.textContent = online ? 'CONNECTED TO THE ARENA' : 'OFFLINE — START THE SERVER';
  }

  // ─── Match entry ───
  function startQuickDuel() {
    if (!socket.connected) {
      panelNotice('Not connected to the arena. Start the server and refresh.', true);
      return;
    }
    const name = currentName();
    quickStatusText.textContent = 'Looking for another mage…';
    hideTitle();
    quickModal.classList.add('show');
    socket.emit('quick_duel', { name, class: selectedClass }, res => {
      if (!res || !res.ok) {
        quickModal.classList.remove('show');
        showTitle();
        openPanel('play');
        panelNotice(res && res.error === 'already_in_room'
          ? 'You are already seated in a room.'
          : 'Could not search right now. Try again in a moment.', true);
      }
    });
  }

  function startPractice() {
    if (!socket.connected) {
      panelNotice('Not connected to the arena. Start the server and refresh.', true);
      return;
    }
    socket.emit('practice_mode', { name: currentName(), class: selectedClass }, res => {
      if (res && res.ok) {
        currentRoom = res.code;
        isPracticeMode = true;
        hideTitle();
        waitingModal.classList.remove('show');
        quickModal.classList.remove('show');
      } else {
        panelNotice('Could not open the practice arena. Try again.', true);
      }
    });
  }

  function createRoom() {
    if (!socket.connected) {
      panelNotice('Not connected to the arena. Start the server and refresh.', true);
      return;
    }
    socket.emit('create_room', { name: currentName(), class: selectedClass }, res => {
      if (res && res.ok) {
        currentRoom = res.code;
        isHost = true;
        waitingCodeDisplay.textContent = res.code;
        sessionStorage.setItem('md_token', res.token);
        sessionStorage.setItem('md_room', res.code);
        hideTitle();
        waitingModal.classList.add('show');
      } else {
        panelNotice('Could not create a room. Try again.', true);
      }
    });
  }

  function joinRoom() {
    const input = document.getElementById('roomCodeInput');
    const code = (input ? input.value : pendingRoomCode).trim().toUpperCase();
    if (!code) {
      panelNotice('Enter the room code your rival shared.', true);
      if (input) input.focus();
      return;
    }
    if (!socket.connected) {
      panelNotice('Not connected to the arena. Start the server and refresh.', true);
      return;
    }
    const savedToken = sessionStorage.getItem('md_room') === code ? sessionStorage.getItem('md_token') : null;
    socket.emit('join_room', { code, name: currentName(), class: selectedClass, token: savedToken }, res => {
      if (!res || !res.ok) {
        panelNotice(res && res.error ? res.error : 'Could not join that room.', true);
        return;
      }
      currentRoom = res.code;
      isHost = false;
      sessionStorage.setItem('md_token', res.token);
      sessionStorage.setItem('md_room', res.code);
      waitingCodeDisplay.textContent = res.code;
      hideTitle();
      if (!res.reconnected) waitingModal.classList.add('show');
    });
  }

  function leaveQuickQueue() {
    socket.emit('cancel_quick_duel');
    quickModal.classList.remove('show');
    showTitle();
  }

  btnCancelQuick.addEventListener('click', leaveQuickQueue);
  btnCancelWaiting.addEventListener('click', () => {
    socket.emit('leave_room');
    waitingModal.classList.remove('show');
    showTitle();
  });

  btnCopyInvite.addEventListener('click', () => {
    const url = `${window.location.origin}/?room=${currentRoom}`;
    const done = () => {
      btnCopyInvite.textContent = '✅ COPIED!';
      setTimeout(() => { btnCopyInvite.textContent = '📋 COPY INVITE LINK'; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(done);
    } else {
      done();
    }
  });

  // ─── Screens: tabs, close, escape ───
  document.querySelectorAll('#rulesTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentRulesTab = tab.dataset.tab;
      renderRules();
    });
  });
  document.querySelectorAll('#settingsTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentSettingsTab = tab.dataset.tab;
      renderSettings();
    });
  });

  btnCloseRules.addEventListener('click', closeRules);
  btnCloseSettings.addEventListener('click', closeSettings);
  document.getElementById('btnResetSettings').addEventListener('click', () => {
    Object.assign(settings, {
      binds: Object.assign({}, DEFAULT_BINDS),
      sens: 1,
      shake: 1,
      scanlines: true,
      smoothPixels: false
    });
    saveSettings();
    applySettings();
    refreshBinds();
    renderSettings();
    SFX.ui('confirm');
  });

  function openDuelMenu() {
    if (gameHud.style.display === 'none') return;
    if (isPracticeMode) btnForfeit.textContent = 'EXIT PRACTICE';
    else btnForfeit.textContent = 'FORFEIT DUEL';
    btnForfeit.dataset.confirm = '';
    duelMenu.classList.add('on');
  }

  function closeDuelMenu() {
    duelMenu.classList.remove('on');
  }

  function leaveMatch() {
    isMatchActive = false;
    isPracticeMode = false;
    SFX.stopCharge();
    socket.emit('leave_room');
    gameHud.style.display = 'none';
    blindnessOverlay.classList.remove('active');
    [duelMenu, rulesScreen, settingsScreen].forEach(el => el.classList.remove('on'));
    endModal.classList.remove('show');
    waitingModal.classList.remove('show');
    quickModal.classList.remove('show');
    matchIntro.classList.remove('on');
    currentRoom = null;
    resetNetState();
    showTitle();
  }

  btnDuelMenu.addEventListener('click', openDuelMenu);
  btnResumeDuel.addEventListener('click', closeDuelMenu);
  btnDuelRules.addEventListener('click', () => showRules('basics'));
  btnDuelSettings.addEventListener('click', () => showSettings('controls'));
  btnForfeit.addEventListener('click', () => {
    if (btnForfeit.dataset.confirm !== '1') {
      btnForfeit.dataset.confirm = '1';
      btnForfeit.textContent = isPracticeMode ? 'CONFIRM EXIT' : 'CONFIRM FORFEIT';
      setTimeout(() => {
        if (btnForfeit.dataset.confirm === '1') {
          btnForfeit.dataset.confirm = '';
          btnForfeit.textContent = isPracticeMode ? 'EXIT PRACTICE' : 'FORFEIT DUEL';
        }
      }, 3000);
      return;
    }
    leaveMatch();
  });

  function handleEscape() {
    if (captureSlot) { cancelBind(); return; }
    if (settingsScreen.classList.contains('on')) { closeSettings(); return; }
    if (rulesScreen.classList.contains('on')) { closeRules(); return; }
    if (duelMenu.classList.contains('on')) { closeDuelMenu(); return; }
    if (endModal.classList.contains('show')) return;
    if (titleVisible && menuPanelOpen) { closePanel(); return; }
    if (gameHud.style.display !== 'none') { openDuelMenu(); return; }
    if (quickModal.classList.contains('show')) { leaveQuickQueue(); return; }
  }

  // ─── Keyboard: menu navigation and spell binds ───
  let hotkeySpellMap = {};

  function triggerSpellByKey(code) {
    const spellId = hotkeySpellMap[code];
    if (!spellId) return;
    const card = document.getElementById(`btn_spell_${spellId}`);
    if (card) {
      card.classList.add('key-pressed');
      setTimeout(() => card.classList.remove('key-pressed'), 140);
    }
    requestCast(spellId, 'keybind');
  }

  function inputFieldFocused(target) {
    return target instanceof Element && !!target.closest('input, textarea, select');
  }

  window.addEventListener('keydown', e => {
    const inField = inputFieldFocused(e.target);

    if (e.key === 'Escape') {
      if (!inField) { handleEscape(); return; }
      e.target.blur();
      return;
    }

    if (titleVisible && !menuPanelOpen && !inField && gameHud.style.display === 'none') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuActive(menuActive + (e.key === 'ArrowDown' ? 1 : -1), true);
        return;
      }
      if (e.key === 'Enter' && !titleMenu.contains(e.target)) {
        e.preventDefault();
        activateMenuItem(menuActive);
        return;
      }
    }

    if (inField) return;

    keys[e.key.toLowerCase()] = true;
    if (e.code === 'Space') e.preventDefault();

    if (gameHud.style.display !== 'none' && !e.repeat && !titleVisible &&
        !document.querySelector('.overlay-screen.on, .modal-backdrop.show')) {
      if (hotkeySpellMap[e.code]) {
        e.preventDefault();
        triggerSpellByKey(e.code);
      }
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    Object.keys(keys).forEach(k => { keys[k] = false; });
  });

  // ─── Typed casting fallback ───
  btnTypeCast.addEventListener('click', () => {
    typeCastForm.hidden = !typeCastForm.hidden;
    if (!typeCastForm.hidden) typeCastInput.focus();
  });

  typeCastForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = typeCastInput.value.trim();
    if (!text || !isMatchActive) return;
    socket.emit('cast', { text, source: 'text' });
    heardDisplay.innerHTML = `⌨ Typed: <span class="heard-transcript">“${escapeVoiceText(text)}”</span> — casting…`;
    typeCastInput.value = '';
  });

  // ─── Network state label ───
  socket.on('connect', updateNetState);
  socket.on('disconnect', updateNetState);
  updateNetState();

  // First paint of the shell
  buildTitleMenu();
  setMenuActive(0, false);
  applyClassTheme(selectedClass);
  rebuildMages(selectedClass, 'frost');
  applySettings();

  startBoot();
