/* ============================================================
   render-final.js — carte de la table finale (TB_FINAL)
   LOT 5. Aucune règle métier ici : la liste des colonnes vient de
   HQ.generator.finalColumns(state). Ce fichier dessine et réordonne.
   render-joins.js pose un emplacement vide (#final-slot) en fin de
   flux ; ce module le remplit, et le redessine seul quand l'alias,
   la case, les colonnes calculées ou l'ordre changent.
   Expose HQ.renderFinal = { slot, render }
   ============================================================ */
(function () {
  'use strict';

  var D = HQ.dom;
  var store = HQ.store;
  var el = D.el, on = D.on;

  var ORIGIN = {
    kept:       { cls: 'kept',    text: 'reprise' },
    modified:   { cls: 'modif',   text: 'modifiée' },
    created:    { cls: 'created', text: 'créée' },
    aggregated: { cls: 'aggr',    text: 'agrégée' }
  };

  var lastHash = '';
  var pendingFocus = null;   // nom de colonne à refocaliser après un déplacement clavier

  function tip() { return HQ.renderSchema && HQ.renderSchema.tip; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- contenu de la bulle --------------------- */
  function tipHtml(c) {
    var o = ORIGIN[c.origin] || ORIGIN.kept;
    var h = '<b>' + esc(c.name) + '</b><span class="col-tip__type">colonne ' + esc(o.text) + '</span>';
    if (c.expr) h += '<span class="col-tip__why">Expression : <code>' + esc(c.expr) + '</code></span>';
    var src = c.nodeName ? c.nodeName + (c.col ? '.' + c.col : '') : (c.col || '');
    if (src) {
      h += '<span class="col-tip__type">' +
        (c.origin === 'kept' ? 'Origine : ' : 'Calculée depuis : ') + esc(src) +
        (c.renamedFrom ? ' (renommée par alias)' : '') + '</span>';
    }
    if (c.label) h += '<span class="col-tip__why">' + esc(c.label) + '</span>';
    if (c.why)   h += '<span class="col-tip__why">' + esc(c.why) + '</span>';
    if (c.collision) {
      h += '<span class="col-tip__warn">&#9888; Même nom dans deux tables : dplyr les renommera ' +
        esc(c.name) + '.x / ' + esc(c.name) + '.y. Donner un alias à l\'une des deux.</span>';
    }
    return h;
  }

  /* ---------------- écriture de l'ordre dans le store ------- */
  function commitOrder(names) {
    var current = HQ.generator.finalColumns(store.getState()).map(function (c) { return c.name; });
    if (names.join('|') === current.join('|')) return;
    store.patch(function (s) { s.finalOrder = names.slice(); return s; });
  }

  function listNames(list) {
    return D.qsa('.final-col', list).map(function (li) { return li.dataset.name; });
  }

  /* ---------------- glisser-déposer (souris + tactile) ------ */
  function wireDrag(list) {
    var drag = null;   // { li, startY, moved, id }

    on(list, 'pointerdown', function (ev) {
      var grip = ev.target.closest('.final-col__grip');
      if (!grip || ev.button !== 0) return;
      var li = grip.closest('.final-col');
      drag = { li: li, startY: ev.clientY, moved: false, id: ev.pointerId };
      try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* ancien navigateur */ }
      ev.preventDefault();
    });

    on(list, 'pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.abs(ev.clientY - drag.startY) < 4) return;
        drag.moved = true;
        drag.li.classList.add('is-dragging');
        list.classList.add('is-sorting');
        var t = tip(); if (t) t.hide();
      }
      /* place l'élément avant la première ligne dont le milieu est sous le pointeur */
      var items = D.qsa('.final-col', list).filter(function (x) { return x !== drag.li; });
      var before = null;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { before = items[i]; break; }
      }
      if (before) { if (drag.li.nextSibling !== before) list.insertBefore(drag.li, before); }
      else if (list.lastElementChild !== drag.li) list.appendChild(drag.li);
    });

    function end(ev) {
      if (!drag || (ev && ev.pointerId !== drag.id)) return;
      var d = drag; drag = null;
      d.li.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      if (d.moved) commitOrder(listNames(list));
    }
    on(list, 'pointerup', end);
    on(list, 'pointercancel', end);
  }

  /* ---------------- clavier : Alt+↑/↓ déplace, ↑/↓ navigue -- */
  function wireKeys(list) {
    on(list, 'keydown', function (ev) {
      var li = ev.target.closest && ev.target.closest('.final-col');
      if (!li || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      ev.preventDefault();
      var up = ev.key === 'ArrowUp';
      if (!ev.altKey) {
        var next = up ? li.previousElementSibling : li.nextElementSibling;
        if (next) next.focus();
        return;
      }
      var names = listNames(list);
      var i = names.indexOf(li.dataset.name), j = up ? i - 1 : i + 1;
      if (j < 0 || j >= names.length) return;
      var tmp = names[i]; names[i] = names[j]; names[j] = tmp;
      pendingFocus = li.dataset.name;
      commitOrder(names);
    });
  }

  /* ---------------- une ligne de colonne -------------------- */
  function makeRow(c, idx) {
    var o = ORIGIN[c.origin] || ORIGIN.kept;
    var src = c.origin === 'kept'
      ? (c.nodeName || '')
      : o.text;
    var li = el('li.final-col.final-col--' + o.cls + (c.collision ? '.final-col--clash' : ''), {
      tabindex: '0',
      'data-name': c.name,
      'aria-label': c.name + ', colonne ' + o.text + ', position ' + (idx + 1) +
        '. Alt + flèche haut ou bas pour déplacer.'
    }, [
      el('span.final-col__grip', { 'aria-hidden': 'true', title: 'Glisser pour réordonner', text: '⋮⋮' }),
      el('span.final-col__idx', { text: String(idx + 1) }),
      el('span.final-col__name', { text: c.name }),
      c.collision ? el('span.final-col__clash', { text: '⚠', 'aria-hidden': 'true' }) : null,
      el('span.final-col__src', { text: src })
    ]);
    function show() { var t = tip(); if (t) t.show(li, tipHtml(c)); }
    function hide() { var t = tip(); if (t) t.hideSoon(); }
    on(li, 'mouseenter', show);
    on(li, 'mouseleave', hide);
    on(li, 'focus', show);
    on(li, 'blur', hide);
    return li;
  }

  /* ---------------- la carte -------------------------------- */
  function makeCard(state, cols) {
    var counts = { kept: 0, modified: 0, created: 0, aggregated: 0 };
    cols.forEach(function (c) { counts[c.origin] = (counts[c.origin] || 0) + 1; });

    var badges = [];
    if (counts.modified)   badges.push(el('span.badge.badge--modif',   { text: counts.modified + ' modif.' }));
    if (counts.created)    badges.push(el('span.badge.badge--created', { text: counts.created + ' créée' + (counts.created > 1 ? 's' : '') }));
    if (counts.aggregated) badges.push(el('span.badge.badge--aggr',    { text: counts.aggregated + ' agrég.' }));

    var head = el('div.flow-card__head', {}, [
      el('div.flow-card__title-row', {}, [
        el('span.flow-card__name', { text: 'TB_FINAL' }),
        el('span.flow-card__count', { text: cols.length + ' col.' }),
        el('div.flow-card__badges', {}, badges)
      ]),
      el('p.flow-card__meta', { text: state.granularity || 'Table finale' })
    ]);

    var body;
    if (!cols.length) {
      body = el('div.flow-card__body', {}, [
        el('p.final-empty', { text: 'Aucune colonne cochée : rien ne sortira de TB_FINAL.' })
      ]);
    } else {
      var list = el('ol.final-list', { 'aria-label': 'Ordre des colonnes de l\'export' },
        cols.map(makeRow));
      wireDrag(list);
      wireKeys(list);
      body = el('div.flow-card__body', {}, [
        el('p.final-hint', { text: 'Glisser ⋮⋮ (ou Alt + ↑/↓) pour fixer l\'ordre de l\'export.' }),
        list
      ]);
    }

    return el('div.flow-card.flow-card--final', { role: 'region', 'aria-label': 'Table finale' }, [head, body]);
  }

  /* ---------------- emplacement dans le flux ---------------- */
  /* Appelé par render-joins.build() : flèche + emplacement vide. */
  function slot() {
    lastHash = '';   // emplacement neuf : forcer le remplissage
    return [
      el('div.join-h.join-h--final', { 'aria-hidden': 'true' }, [
        el('div.join__track', {}, [el('span.join__line'), el('span.join__line.join__line--arrow')]),
        el('div.join__labels', {}, [el('code.join__key', { text: 'select()' })])
      ]),
      el('div.flow-col.flow-col--final#final-slot')
    ];
  }

  function render() {
    var host = document.getElementById('final-slot');
    if (!host) return;
    var state = store.getState();
    var cols = HQ.generator.finalColumns(state);
    var hash = JSON.stringify([state.granularity, cols]);
    if (hash === lastHash && host.firstChild) return;
    lastHash = hash;
    D.replace(host, makeCard(state, cols));
    if (HQ.ui && HQ.ui.measureStage) HQ.ui.measureStage();
    if (pendingFocus) {
      var li = host.querySelector('.final-col[data-name="' + pendingFocus.replace(/"/g, '') + '"]');
      pendingFocus = null;
      if (li) li.focus();
    }
  }

  HQ.renderFinal = { slot: slot, render: render };

  /* s'abonne APRÈS render-schema (ordre de chargement) : l'emplacement
     est donc déjà reconstruit quand on le remplit */
  store.subscribe(function (what) {
    if (!what || what === 'state') render();
  });
})();
