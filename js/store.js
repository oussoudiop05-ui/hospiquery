/* ============================================================
   store.js — état central. AUCUN accès au DOM dans ce fichier.
   Expose HQ.store
   ------------------------------------------------------------
   Lot 1 : préférences d'interface (thème, bandeau, onglet).
   Lot 2 : état d'extraction (nodes, joins, derived…) + undo/redo
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var KEY_UI    = 'hq.ui';
  var KEY_STATE = 'hq.state';

  /* ---- connexions déclarées (CLAUDE.md §8.3) --------------- */
  var CONNECTIONS = [
    { id: 'con1', role: 'c1', label: 'DECISIONNEL',
      dsn: 'DECISIONNEL', server: 'CAIDPROD1\\IDDWH',
      database: 'INFOCENTRE', schema: 'Q', encoding: 'latin1' },
    { id: 'con2', role: 'c2', label: 'CORA RECUEIL',
      dsn: 'DECISIONNEL-REPLICATS_CORA', server: 'CAIDPROD2\\IDRPL',
      database: 'CORA_RECUEIL', schema: 'dbo', encoding: 'latin1' },
    { id: 'con3', role: 'c2', label: 'CORA RECUEIL (variante)',
      dsn: 'DECISIONNEL-REPLICATS_CORA_REC', server: 'CAIDPROD2\\IDRPL',
      database: 'CORA_RECUEIL', schema: 'dbo', encoding: 'latin1' },
    { id: 'axi', role: 'cx', label: 'SPIM / DPI',
      dsn: 'DPI-2012', server: 'SRWPR-SAMSIH',
      database: 'SPIM', schema: 'dbo', encoding: 'UTF-8' }
  ];

  /* ---- légende des couleurs -------------------------------- */
  var LEGEND = [
    { token: '--c2-line',      text: 'con2 · CORA dbo' },
    { token: '--c1-line',      text: 'con1 · Décisionnel Q' },
    { token: '--cx-line',      text: 'axi · SPIM / DPI' },
    { token: '--loc-line',     text: 'fichier / R local' },
    { token: '--created-line', text: 'colonne créée' },
    { token: '--modif-line',   text: 'colonne modifiée' },
    { token: '--aggr-line',    text: 'colonne agrégée' }
  ];

  /* ---- état d'interface par défaut ------------------------- */
  function defaultUI() {
    return {
      theme: 'auto',        // auto | light | dark
      dockHeight: 286,
      dockCollapsed: false,
      activeTab: 'script'   // script par défaut au lot 2
    };
  }

  /* ---- état d'extraction par défaut (seed I50 si présent) -- */
  function defaultState() {
    if (window.HQ && window.HQ.SEED_I50) {
      return JSON.parse(JSON.stringify(window.HQ.SEED_I50));
    }
    return { request: '', granularity: '', nodes: [], joins: [], derived: [], finalOrder: [], warnings: [] };
  }

  var ui    = defaultUI();
  var state = defaultState();

  /* pile undo / redo : chaque entrée est un snapshot JSON */
  var undoStack = [];
  var redoStack = [];

  var subs = [];

  /* ---- persistance ----------------------------------------- */
  function loadUI() {
    try {
      var raw = window.localStorage.getItem(KEY_UI);
      if (!raw) return;
      var saved = JSON.parse(raw);
      Object.keys(ui).forEach(function (k) {
        if (saved[k] !== undefined) ui[k] = saved[k];
      });
    } catch (e) { /* stockage indisponible : on garde les valeurs par défaut */ }
  }

  function saveUI() {
    try { window.localStorage.setItem(KEY_UI, JSON.stringify(ui)); }
    catch (e) { /* navigation privée ou stockage bloqué : sans conséquence */ }
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(KEY_STATE);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.nodes) state = saved;
    } catch (e) { /* garde le seed */ }
  }

  function saveState() {
    try { window.localStorage.setItem(KEY_STATE, JSON.stringify(state)); }
    catch (e) { /* sans conséquence */ }
  }

  /* ---- abonnements ----------------------------------------- */
  function subscribe(fn) {
    subs.push(fn);
    return function unsubscribe() {
      var i = subs.indexOf(fn);
      if (i > -1) subs.splice(i, 1);
    };
  }

  function notify(what) {
    subs.forEach(function (fn) {
      try { fn(what); } catch (e) { console.error('[store] abonné en erreur', e); }
    });
  }

  /* ---- lecture / écriture de l'interface ------------------- */
  function getUI() { return ui; }

  function setUI(patch) {
    var changed = false;
    Object.keys(patch).forEach(function (k) {
      if (ui[k] !== patch[k]) { ui[k] = patch[k]; changed = true; }
    });
    if (!changed) return;
    saveUI();
    notify('ui');
  }

  /* ---- lecture / écriture de l'état d'extraction ----------- */
  function getState() { return state; }

  /* patch(fn) : fn reçoit une copie profonde, retourne le nouvel état */
  function patch(fn) {
    var snapshot = JSON.stringify(state);
    undoStack.push(snapshot);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    try {
      var copy = JSON.parse(snapshot);
      var next = fn(copy);
      state = next || copy;
    } catch (e) {
      /* rollback silencieux */
      state = JSON.parse(undoStack.pop());
      return;
    }
    saveState();
    notify('state');
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    saveState();
    notify('state');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    saveState();
    notify('state');
  }

  /* réinitialise l'état vers le seed I50 */
  function resetToSeed() {
    patch(function () { return defaultState(); });
  }

  /* ---- référentiels ---------------------------------------- */
  function getConnections() { return CONNECTIONS; }

  function getConnection(id) {
    for (var i = 0; i < CONNECTIONS.length; i++) {
      if (CONNECTIONS[i].id === id) return CONNECTIONS[i];
    }
    return null;
  }

  function getLegend() { return LEGEND; }

  loadUI();
  loadState();

  HQ.store = {
    subscribe: subscribe,
    notify: notify,
    getUI: getUI,
    setUI: setUI,
    getState: getState,
    patch: patch,
    undo: undo,
    redo: redo,
    resetToSeed: resetToSeed,
    getConnections: getConnections,
    getConnection: getConnection,
    getLegend: getLegend
  };
})();
