/* ============================================================
   app.js — amorçage de la coquille et comportements d'interface
   Expose HQ.ui (modale, toasts) pour les autres modules.
   ============================================================ */
(function () {
  'use strict';

  var D = HQ.dom;
  var store = HQ.store;
  var el = D.el, byId = D.byId, on = D.on;

  var app, stage, stageScroll, dock, grip;

  /* ========================================================
     THÈME
     ======================================================== */
  var THEMES = ['auto', 'light', 'dark'];
  var GLYPH = { auto: '◐', light: '☀', dark: '☾' };
  var LABEL = { auto: 'Thème : système', light: 'Thème : clair', dark: 'Thème : sombre' };

  function applyTheme() {
    var t = store.getUI().theme;
    document.documentElement.setAttribute('data-theme', t);
    var g = byId('glyph-theme');
    var b = byId('btn-theme');
    if (g) g.textContent = GLYPH[t];
    if (b) { b.setAttribute('title', LABEL[t]); b.setAttribute('aria-label', LABEL[t]); }
  }

  function cycleTheme() {
    var cur = store.getUI().theme;
    var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    store.setUI({ theme: next });
    toast(LABEL[next], 'ok');
  }

  /* ========================================================
     ONGLETS DU BANDEAU
     ======================================================== */
  var TABS = ['chat', 'script', 'files', 'warnings'];

  function applyTab() {
    var active = store.getUI().activeTab;
    if (TABS.indexOf(active) < 0) active = 'chat';
    TABS.forEach(function (name) {
      var tab = byId('tab-' + name);
      var pane = byId('pane-' + name);
      var isOn = name === active;
      if (tab) tab.setAttribute('aria-selected', isOn ? 'true' : 'false');
      if (pane) pane.hidden = !isOn;
    });
  }

  function wireTabs() {
    TABS.forEach(function (name) {
      var tab = byId('tab-' + name);
      if (!tab) return;
      on(tab, 'click', function () {
        if (store.getUI().dockCollapsed) store.setUI({ dockCollapsed: false });
        store.setUI({ activeTab: name });
      });
    });

    /* flèches gauche/droite entre onglets */
    var bar = byId('dock-tabs');
    if (!bar) return;
    on(bar, 'keydown', function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var i = TABS.indexOf(store.getUI().activeTab);
      if (i < 0) return;
      var d = ev.key === 'ArrowRight' ? 1 : -1;
      var next = TABS[(i + d + TABS.length) % TABS.length];
      store.setUI({ activeTab: next });
      var t = byId('tab-' + next);
      if (t) t.focus();
      ev.preventDefault();
    });
  }

  /* ========================================================
     BANDEAU : REPLI ET REDIMENSIONNEMENT
     ======================================================== */
  var DOCK_MIN = 120;

  /* La hauteur de fenêtre peut valoir 0 au tout premier rendu dans un
     volet qui n'a pas encore sa mise en page : on se rabat alors sur une
     borne haute viable plutôt que d'écraser la hauteur du bandeau. */
  function dockMax() {
    var h = window.innerHeight || 0;
    return Math.max(DOCK_MIN + 80, Math.round(h * 0.68));
  }

  function applyDock() {
    var u = store.getUI();
    app.dataset.dock = u.dockCollapsed ? 'collapsed' : 'open';
    if (!u.dockCollapsed) {
      app.style.setProperty('--dock-h', D.clamp(u.dockHeight, DOCK_MIN, dockMax()) + 'px');
    } else {
      app.style.removeProperty('--dock-h');
    }
    var g = byId('glyph-dock');
    var b = byId('btn-dock-toggle');
    if (g) g.textContent = u.dockCollapsed ? '▴' : '▾';
    if (b) {
      var lab = u.dockCollapsed ? 'Déplier le bandeau' : 'Replier le bandeau';
      b.setAttribute('title', lab);
      b.setAttribute('aria-label', lab);
    }
    measureStage();
  }

  function wireDock() {
    var btn = byId('btn-dock-toggle');
    if (btn) on(btn, 'click', function () {
      store.setUI({ dockCollapsed: !store.getUI().dockCollapsed });
    });

    var dragging = false;

    on(grip, 'pointerdown', function (ev) {
      if (store.getUI().dockCollapsed) return;
      dragging = true;
      grip.setPointerCapture(ev.pointerId);
      document.body.style.cursor = 'ns-resize';
      ev.preventDefault();
    });

    on(grip, 'pointermove', function (ev) {
      if (!dragging) return;
      var h = D.clamp(window.innerHeight - ev.clientY - 3, DOCK_MIN, dockMax());
      app.style.setProperty('--dock-h', Math.round(h) + 'px');
    });

    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      try { grip.releasePointerCapture(ev.pointerId); } catch (e) { /* déjà relâché */ }
      var h = parseInt(app.style.getPropertyValue('--dock-h'), 10);
      if (!isNaN(h)) store.setUI({ dockHeight: h });
      measureStage();
    }

    on(grip, 'pointerup', endDrag);
    on(grip, 'pointercancel', endDrag);

    /* clavier : flèches haut/bas, Entrée pour replier */
    on(grip, 'keydown', function (ev) {
      var u = store.getUI();
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        var step = ev.shiftKey ? 48 : 16;
        var h = D.clamp(u.dockHeight + (ev.key === 'ArrowUp' ? step : -step), DOCK_MIN, dockMax());
        store.setUI({ dockHeight: h, dockCollapsed: false });
        ev.preventDefault();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        store.setUI({ dockCollapsed: !u.dockCollapsed });
        ev.preventDefault();
      }
    });
  }

  /* ========================================================
     CONNEXIONS ET LÉGENDE
     ======================================================== */
  function renderConnections() {
    var host = byId('conns');
    if (!host) return;
    D.replace(host, store.getConnections().map(function (c) {
      return el('span.conn.conn--' + c.role + '.has-tip', { }, [
        el('span.conn__dot', { 'aria-hidden': 'true' }),
        el('span.conn__name', { text: c.id }),
        el('div.tip', {}, [
          el('b', { text: c.label }),
          el('span.tip__type', { text: c.server + ' · ' + c.database + ' · schéma ' + c.schema }),
          el('span.tip__why', { text: 'DSN ' + c.dsn + ' · encodage ' + c.encoding })
        ])
      ]);
    }));
  }

  function renderLegend() {
    var host = byId('legend');
    if (!host) return;
    D.replace(host, store.getLegend().map(function (item) {
      return el('li.legend__item', {}, [
        el('span.legend__swatch', { style: { background: 'var(' + item.token + ')' } }),
        el('span', { text: item.text })
      ]);
    }));
  }

  /* ========================================================
     SCÈNE : DÉTECTION DU DÉBORDEMENT HORIZONTAL
     ======================================================== */
  function measureStage() {
    if (!stageScroll || !stage) return;
    var over = stageScroll.scrollWidth - stageScroll.clientWidth > 4;
    stage.dataset.overflow = over ? '1' : '0';
  }

  /* ========================================================
     MODALE
     ======================================================== */
  var modal, modalBody, modalFoot, modalTitle, lastFocus = null;

  function openModal(title, bodyNodes, footNodes) {
    lastFocus = document.activeElement;
    modalTitle.textContent = title;
    D.replace(modalBody, bodyNodes);
    D.replace(modalFoot, footNodes || null);
    modal.hidden = false;
    var first = modalBody.querySelector('input,textarea,select,button,[tabindex]');
    (first || byId('modal-close')).focus();
  }

  function closeModal() {
    modal.hidden = true;
    D.clear(modalBody);
    D.clear(modalFoot);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function wireModal() {
    on(byId('modal-close'), 'click', closeModal);
    on(byId('modal-scrim'), 'click', closeModal);
    on(document, 'keydown', function (ev) {
      if (ev.key === 'Escape' && !modal.hidden) { closeModal(); ev.preventDefault(); }
    });
  }

  /* ========================================================
     TOASTS
     ======================================================== */
  function toast(text, kind, ms) {
    var host = byId('toasts');
    if (!host) return;
    var node = el('div.toast' + (kind ? '.toast--' + kind : ''), { text: text });
    host.appendChild(node);
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, ms || 3200);
  }

  /* ========================================================
     SCRIPT R — génération et affichage
     ======================================================== */
  function renderScript() {
    var pane = byId('pane-script');
    if (!pane) return;

    /* Vider le pane existant */
    D.clear(pane);

    var state = store.getState();
    var script;
    try {
      script = HQ.generator ? HQ.generator.buildScript(state) : '# generator non chargé';
    } catch (e) {
      script = '# Erreur de génération : ' + e.message;
    }

    var toolbar = el('div.script-toolbar', {}, [
      el('button.btn.btn--sm', {
        type: 'button',
        title: 'Copier le script',
        'aria-label': 'Copier le script',
        text: '⎘ Copier'
      }),
      el('button.btn.btn--sm', {
        type: 'button',
        title: 'Télécharger le .R',
        'aria-label': 'Télécharger le script',
        text: '↓ .R'
      }),
      el('button.btn.btn--sm', {
        type: 'button',
        title: 'Télécharger le SQL',
        'aria-label': 'Télécharger le script SQL',
        text: '↓ .SQL'
      }),
      el('button.btn.btn--sm', {
        type: 'button',
        title: 'Télécharger la liste de colonnes Markdown',
        'aria-label': 'Télécharger la liste Markdown',
        text: '↓ .md'
      })
    ]);

    var pre = el('pre.script-code', {}, [
      el('code', { text: script })
    ]);

    pane.appendChild(toolbar);
    pane.appendChild(pre);

    /* Copier */
    toolbar.children[0].onclick = function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(script).then(function () { toast('Script copié !', 'ok'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = script;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Script copié !', 'ok');
      }
    };

    /* Télécharger .R */
    toolbar.children[1].onclick = function () {
      var blob = new Blob([script], { type: 'text/plain' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = 'extraction.R';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    /* Télécharger .SQL */
    toolbar.children[2].onclick = function () {
      var sql = HQ.generator ? HQ.generator.buildSQL(state) : '-- generator non chargé';
      var blob = new Blob([sql], { type: 'text/plain' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = 'extraction.sql';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    /* Télécharger .md */
    toolbar.children[3].onclick = function () {
      var md = HQ.generator ? HQ.generator.buildMarkdown(state) : '*(generator non chargé)*';
      var blob = new Blob([md], { type: 'text/plain' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = 'colonnes.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  }

  /* ========================================================
     BARRE DE CONTEXTE — synchronisation avec l'état
     ======================================================== */
  function renderContext() {
    var state = store.getState();
    var reqEl   = byId('context-request');
    var grainEl = byId('context-grain');
    if (reqEl) {
      var empty = !state.request;
      reqEl.textContent = empty ? 'Aucune demande en cours' : state.request;
      reqEl.dataset.empty = empty ? '1' : '0';
    }
    if (grainEl) grainEl.textContent = state.granularity || '';
  }

  /* ========================================================
     PLACEHOLDERS DES LOTS SUIVANTS
     ======================================================== */
  function renderPlaceholders() {
    /* LOT 10 : warnings géré par HQ.uiWarnings — plus de placeholder ici */
  }

  /* ========================================================
     RÉINITIALISATION ET RENOMMAGE
     ======================================================== */
  function wireReset() {
    var btn = byId('btn-reset');
    if (!btn) return;
    on(btn, 'click', function () {
      store.patch(function (s) {
        s.request    = '';
        s.granularity = '';
        s.nodes      = [];
        s.joins      = [];
        s.warnings   = [];
      });
      /* Vider le panneau Discussion */
      if (HQ.renderChat && HQ.renderChat.reset) HQ.renderChat.reset();
      /* Vider le panneau Script R */
      var scriptPane = byId('pane-script');
      if (scriptPane) D.clear(scriptPane);
      toast('Nouvelle extraction', 'ok');
    });
  }

  function wireRename() {
    var reqEl = byId('context-request');
    if (!reqEl) return;
    on(reqEl, 'click', function () {
      if (!store.getState().request) return;
      reqEl.contentEditable = 'true';
      reqEl.focus();
      var range = document.createRange();
      range.selectNodeContents(reqEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    on(reqEl, 'keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); reqEl.blur(); }
      if (ev.key === 'Escape') { reqEl.contentEditable = 'false'; renderContext(); }
    });
    on(reqEl, 'blur', function () {
      if (reqEl.contentEditable !== 'true') return;
      reqEl.contentEditable = 'false';
      var newVal = (reqEl.textContent || '').trim();
      if (newVal && newVal !== store.getState().request) {
        store.patch(function (s) { s.request = newVal; });
        toast('Extraction renommée', 'ok');
      } else {
        renderContext();
      }
    });
  }

  function wireConfigButtons() {
    /* CLAUDE.md — lot 9 */
    if (HQ.uiClaudemd) HQ.uiClaudemd.wire(openModal, closeModal, toast);
    /* Modèles & Historique — lot 10 */
    if (HQ.uiTemplates) HQ.uiTemplates.wire(openModal, closeModal, toast);
    /* Fichiers externes — lot 9 (chip topbar, le pane est géré dans init) */
    /* Réglages — lot 7 */
    if (HQ.uiSettings) {
      HQ.uiSettings.wire(openModal, closeModal, toast);
    }

    /* Dictionnaire — lot 6 */
    if (HQ.uiDictionary) {
      HQ.uiDictionary.wire(openModal, closeModal, toast);
    } else {
      var dictBtn = byId('btn-dictionary');
      if (dictBtn) {
        on(dictBtn, 'click', function () {
          openModal('Dictionnaire de données', el('p', { text: 'Module dictionnaire non chargé.' }),
            el('button.btn', { type: 'button', text: 'Fermer', 'data-close': '1' }));
        });
      }
    }

    on(byId('modal-foot'), 'click', function (ev) {
      if (ev.target.closest('[data-close]')) closeModal();
    });
  }

  /* ========================================================
     AMORÇAGE
     ======================================================== */
  function render(what) {
    if (!what || what === 'ui') { applyTheme(); applyTab(); applyDock(); }
    if (!what || what === 'state') { renderScript(); renderContext(); if (HQ.renderSchema) HQ.renderSchema.render(); if (HQ.renderFinal) HQ.renderFinal.render(); }
  }

  function init() {
    app = D.qs('.app');
    stage = byId('stage');
    stageScroll = byId('stage-scroll');
    dock = byId('dock');
    grip = byId('dock-grip');
    modal = byId('modal');
    modalBody = byId('modal-body');
    modalFoot = byId('modal-foot');
    modalTitle = byId('modal-title');

    renderConnections();
    renderLegend();
    renderPlaceholders();
    renderScript();
    renderContext();
    if (HQ.renderSchema) HQ.renderSchema.render();

    wireTabs();
    wireDock();
    wireModal();
    if (HQ.renderChat)    HQ.renderChat.wire(toast);
    if (HQ.uiFiles)       HQ.uiFiles.wire(toast);
    if (HQ.uiWarnings)    HQ.uiWarnings.wire();
    wireReset();
    wireRename();
    wireConfigButtons();
    on(byId('btn-theme'), 'click', cycleTheme);

    store.subscribe(render);
    render();

    /* applyDock recalcule la borne haute puis mesure la scène : à brancher
       sur le redimensionnement, sinon une fenêtre mesurée à 0 au chargement
       laisse le bandeau à une hauteur fausse. */
    on(window, 'resize', applyDock);
    applyDock();

    HQ.ui = { openModal: openModal, closeModal: closeModal, toast: toast, measureStage: measureStage };
  }

  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', init);
  else init();
})();
