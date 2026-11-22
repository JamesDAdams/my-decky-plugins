/* Static page: sidebar menu, EN/FR switch, real version read from the plugin's package.json. */
(() => {
  'use strict';
  if (window.__mdpReady) return; // guards against a double initialisation
  window.__mdpReady = true;

  const I18N = {
    en: {
      title: 'My Decky plugins',
      subtitle: 'Decky Loader plugins for Steam Big Picture, installed from a zip.',
      download: 'Download',
      details: 'Details',
      'deckyshortcut.name': 'Decky shortcut',
      'deckyshortcut.navDesc': 'Steam Big Picture',
      'deckyshortcut.desc': 'Adds Ctrl+2 DECKY to the bottom shortcut bar, immediately left of F9 OPTIONS, and opens the Decky panel from the keyboard, the mouse or a click on the legend.',
      'deckyshortcut.f1': "The legend is a clone of Steam's own legends: same markup, same font, same spacing, so Valve's visual updates apply to it too.",
      'deckyshortcut.f2': 'Ctrl+2 or a click toggles the Decky tab of the Quick Access Menu, and the legend is re-inserted whenever Steam rebuilds its bar.',
      'deckyshortcut.f3': 'Nothing is patched in Steam and no file is modified: the legend is cloned at runtime inside the visible Big Picture window.',
      'deckyshortcut.meta': 'Keyboard and mouse; Big Picture only',
      'deckyshortcut.alt': "Ctrl+2 DECKY legend in Steam Big Picture's bottom bar, next to Esc BACK",
      'scskiller.name': 'Shader precompile',
      'scskiller.navDesc': 'Steam Big Picture',
      'scskiller.desc': "Bridges the SCSKiller Windows app into Steam: a shader-compile button on the game page, next to Steam's own icons, and a Quick Access Menu page to start, watch and stop the compile.",
      'scskiller.f1': 'A 48x48 button exactly 8 px left of the controller icon, with the SCSKiller badge and a green or red dot for compiled / to compile.',
      'scskiller.f2': 'Clicking it opens the numbers SCSKiller reports: shaders, pipelines, cache on disk, estimate, last compile, plus Compile, Stop and Refresh.',
      'scskiller.f3': 'The plugin ships no binary: it calls the scskiller.exe already installed and reads its games.json. The QAM page lists the queue with live progress.',
      'scskiller.meta': 'Windows; SCSKiller installed',
      'scskiller.alt': 'Steam game page with the SCSKiller button left of the controller icon',
      'steamswitch.name': 'Switch account & Play',
      'steamswitch.navDesc': 'Steam Big Picture',
      'steamswitch.desc': 'When a game belongs to another Steam account remembered on this PC, Steam shows Borrow. This plugin turns it into Switch account & Play: Steam restarts signed into the owning account and launches the game there.',
      'steamswitch.f1': "Steam's own button is rewritten in place - label, click and gamepad activation - so its size, colour, hover and focus stay untouched.",
      'steamswitch.f2': 'One detached helper quits Steam, sets the auto-login account in loginusers.vdf and in the registry, restarts in Big Picture and waits for the right account before launching the game.',
      'steamswitch.f3': 'A second button on the account settings page switches account without the sign-out screen. No account is hard-coded: names and ids come from the local Steam install.',
      'steamswitch.meta': 'Windows; two accounts remembered on the PC',
      'steamswitch.alt': 'Borrow button replaced by Switch account & Play on a Steam game page',
      'help.title': 'No Decky Loader yet?',
      'help.text': 'A plugin is a zip file: install Decky Loader, open its menu, choose Install from zip file and pick the download. Without Decky nothing is installed - the sources are plain TypeScript and Python.',
      'help.btn': 'Get Decky Loader',
      footer: 'Source code, changelog and detailed README on GitHub.'
    },
    fr: {
      title: 'Mes plugins Decky',
      subtitle: 'Plugins Decky Loader pour Steam Big Picture, installés depuis un zip.',
      download: 'Télécharger',
      details: 'Détails',
      'deckyshortcut.name': 'Raccourci Decky',
      'deckyshortcut.navDesc': 'Steam Big Picture',
      'deckyshortcut.desc': 'Ajoute Ctrl+2 DECKY à la barre de raccourcis du bas, juste à gauche de F9 OPTIONS, et ouvre le panneau Decky au clavier, à la souris ou d’un clic sur la légende.',
      'deckyshortcut.f1': 'La légende est un clone des légendes Steam : même balisage, même police, même espacement, donc les mises à jour visuelles de Valve s’appliquent aussi.',
      'deckyshortcut.f2': 'Ctrl+2 ou un clic ouvre puis referme l’onglet Decky du menu d’accès rapide, et la légende est réinsérée dès que Steam reconstruit sa barre.',
      'deckyshortcut.f3': 'Rien n’est patché dans Steam et aucun fichier n’est modifié : la légende est clonée à l’exécution dans la fenêtre Big Picture visible.',
      'deckyshortcut.meta': 'Clavier et souris ; Big Picture uniquement',
      'deckyshortcut.alt': 'Légende Ctrl+2 DECKY dans la barre du bas de Steam Big Picture, à côté de Esc BACK',
      'scskiller.name': 'Précompilation de shaders',
      'scskiller.navDesc': 'Steam Big Picture',
      'scskiller.desc': 'Relie l’application Windows SCSKiller à Steam : un bouton de compilation des shaders sur la fiche du jeu, à côté des icônes Steam, et une page dans le menu d’accès rapide pour lancer, suivre et arrêter la compilation.',
      'scskiller.f1': 'Un bouton de 48×48 px exactement à 8 px à gauche de l’icône manette, avec le badge SCSKiller et une pastille verte (compilé) ou rouge (à compiler).',
      'scskiller.f2': 'Un clic ouvre les chiffres que SCSKiller remonte : shaders, pipelines, cache sur disque, estimation, dernière compilation, plus Compile, Stop et Refresh.',
      'scskiller.f3': 'Le plugin n’embarque aucun binaire : il appelle le scskiller.exe déjà installé et lit son games.json. La page du menu d’accès rapide liste la file avec la progression en direct.',
      'scskiller.meta': 'Windows ; SCSKiller installé',
      'scskiller.alt': 'Fiche de jeu Steam avec le bouton SCSKiller à gauche de l’icône manette',
      'steamswitch.name': 'Changer de compte et jouer',
      'steamswitch.navDesc': 'Steam Big Picture',
      'steamswitch.desc': 'Quand un jeu appartient à un autre compte Steam mémorisé sur ce PC, Steam affiche Borrow. Ce plugin le remplace par Switch account & Play : Steam redémarre connecté au compte propriétaire et y lance le jeu.',
      'steamswitch.f1': 'Le bouton natif de Steam est réécrit sur place — libellé, clic et validation manette — donc sa taille, sa couleur, son survol et son focus restent ceux de Steam.',
      'steamswitch.f2': 'Un helper détaché quitte Steam, déclare le compte propriétaire en connexion automatique dans loginusers.vdf et dans le registre, relance en Big Picture et attend le bon compte avant de lancer le jeu.',
      'steamswitch.f3': 'Un second bouton sur la page des réglages du compte change de compte sans passer par l’écran de déconnexion. Aucun compte n’est codé en dur : les noms et les ids viennent de l’installation Steam locale.',
      'steamswitch.meta': 'Windows ; deux comptes mémorisés sur le PC',
      'steamswitch.alt': 'Bouton Borrow remplacé par Switch account & Play sur une fiche de jeu Steam',
      'help.title': 'Pas encore Decky Loader ?',
      'help.text': 'Un plugin est un fichier zip : installez Decky Loader, ouvrez son menu, choisissez Install from zip file et sélectionnez le téléchargement. Sans Decky, rien ne s’installe — les sources sont du TypeScript et du Python classiques.',
      'help.btn': 'Installer Decky Loader',
      footer: 'Code source, changelog et README détaillé sur GitHub.'
    }
  };

  const STORAGE_KEY = 'mdp-lang';

  /* ---------- language ---------- */

  const stored = (() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  })();
  let lang = stored === 'fr' || stored === 'en'
    ? stored
    : (String(navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en');

  const applyLang = next => {
    lang = I18N[next] ? next : 'en';
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const text = I18N[lang][el.dataset.i18n];
      if (text != null) el.textContent = text;
    }
    for (const btn of document.querySelectorAll('[data-lang]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
    }
    for (const el of document.querySelectorAll('[data-i18n-alt]')) {
      const text = I18N[lang][el.dataset.i18nAlt];
      if (text != null) el.alt = text;
    }
    document.title = I18N[lang].title;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage blocked */ }
  };

  for (const btn of document.querySelectorAll('[data-lang]')) {
    btn.addEventListener('click', () => applyLang(btn.dataset.lang));
  }

  applyLang(lang);

  /* ---------- plugin selection ---------- */

  const select = (id, updateHash) => {
    const panels = [...document.querySelectorAll('.panel')];
    if (!panels.length) return;
    if (!panels.some(p => p.id === 'panel-' + id)) id = panels[0].id.replace(/^panel-/, '');
    for (const p of panels) p.hidden = p.id !== 'panel-' + id;
    for (const b of document.querySelectorAll('.nav-item')) {
      const on = b.dataset.panel === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
    if (updateHash) {
      try { history.replaceState(null, '', '#' + id); } catch { /* file:// */ }
    }
  };

  // delegation: any nav item added later keeps working
  document.querySelector('.nav')?.addEventListener('click', e => {
    const b = e.target.closest('.nav-item');
    if (!b) return;
    select(b.dataset.panel, true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  addEventListener('hashchange', () => select((location.hash || '').slice(1), false));

  select((location.hash || '').slice(1) || document.querySelector('.nav-item')?.dataset.panel, false);

  /* ---------- real version, read from the plugin's package.json ---------- */

  for (const el of document.querySelectorAll('[data-version-src]')) {
    fetch(el.dataset.versionSrc, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(meta => {
        if (meta && typeof meta.version === 'string') el.textContent = 'v' + meta.version;
      })
      .catch(() => { /* offline: keep the static version */ });
  }
})();
