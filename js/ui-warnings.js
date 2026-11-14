/* ============================================================
   ui-warnings.js — panneau Avertissements (LOT 10)
   Alimente #pane-warnings depuis les multiplicateurs et
   jointures supposées de l'état courant.
   Expose HQ.uiWarnings = { wire, render }
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  var D = HQ.dom;

  function collectWarnings(state) {
    var w = [];

    (state.nodes || []).forEach(function (n) {
      var existenceOnly = (state.joins || []).some(function (join) {
        return join.to === n.id && join.type === 'semi';
      }) && !(state.joins || []).some(function (join) {
        return join.to === n.id && join.type !== 'semi';
      });
      if (n.multiplier && n.multiplier.factor && !existenceOnly) {
        var detail = n.multiplier.reason || '';
        if (n.multiplier.workaround) detail += ' → ' + n.multiplier.workaround;
        w.push({
          level:  'warn',
          label:  n.kind === 'file' ? n.name : (n.schema + '.' + n.name),
          msg:    '⚠ Multiplicateur × ' + n.multiplier.factor,
          detail: detail
        });
      }
      if (n.reliability === 'q' || n.reliability === 'supposed') {
        w.push({
          level:  'info',
          label:  n.kind === 'file' ? n.name : (n.schema + '.' + n.name),
          msg:    '❓ Table supposée — vérifier en base (CLAUDE.md §9)',
          detail: ''
        });
      }
    });

    (state.joins || []).forEach(function (j) {
      if (j.type === 'semi') return;
      if (j.reliability === 'q' || j.reliability === 'supposed') {
        var fromN = (state.nodes || []).filter(function (n) { return n.id === j.from; })[0];
        var toN   = (state.nodes || []).filter(function (n) { return n.id === j.to;   })[0];
        var label = (fromN ? fromN.name : j.from) + ' → ' + (toN ? toN.name : j.to);
        w.push({
          level:  'info',
          label:  label,
          msg:    '❓ Jointure supposée — vérifier en base avant usage',
          detail: (j.on || []).map(function (p) { return p[0] + ' = ' + p[1]; }).join(', ')
        });
      }
    });

    (state.warnings || []).forEach(function (warning) {
      var text = typeof warning === 'string' ? warning : warning && warning.text;
      if (!text || w.some(function (item) { return item.detail === text; })) return;
      w.push({
        level: warning.level === 'info' ? 'info' : 'warn',
        label: 'Plan d’extraction',
        msg: text.replace(/^À confirmer\s*:\s*/i, ''),
        detail: ''
      });
    });

    return w;
  }

  function render() {
    var pane  = D.byId('pane-warnings');
    var badge = D.byId('count-warnings');
    if (!pane) return;

    var ws = collectWarnings(HQ.store.getState());

    if (badge) {
      badge.hidden      = ws.length === 0;
      badge.textContent = String(ws.length);
    }

    D.clear(pane);

    if (!ws.length) {
      pane.appendChild(D.el('p.empty-note', { text: 'Aucun avertissement — schéma propre.' }));
      return;
    }

    ws.forEach(function (w) {
      var children = [
        D.el('span.warn-item__label', { text: w.label }),
        D.el('span.warn-item__msg',   { text: w.msg })
      ];
      if (w.detail) children.push(D.el('span.warn-item__detail', { text: w.detail }));
      pane.appendChild(D.el('div.warn-item.warn-item--' + w.level, {}, children));
    });
  }

  function wire() {
    HQ.store.subscribe(function (what) {
      if (!what || what === 'state') render();
    });
    render();
  }

  HQ.uiWarnings = { wire: wire, render: render };
})();
