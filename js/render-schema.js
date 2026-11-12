/* ============================================================
   render-schema.js — cartes de tables dans la scène (#flow)
   LOT 3 : une carte par nœud, colonnes sélectionnables.
   Expose HQ.renderSchema = { render }
   ============================================================ */
(function () {
  'use strict';

  var D = HQ.dom;
  var store = HQ.store;
  var el = D.el, byId = D.byId, on = D.on;

  /* ============================================================
     INFOBULLE FIXE (échappe à overflow:hidden des cartes)
     ============================================================ */
  var TIP_EL = null;
  var TIP_TIMER = null;

  function ensureTip() {
    if (!TIP_EL) {
      TIP_EL = document.createElement('div');
      TIP_EL.className = 'col-tip';
      TIP_EL.setAttribute('aria-hidden', 'true');
      TIP_EL.hidden = true;
      document.body.appendChild(TIP_EL);
    }
    return TIP_EL;
  }

  function showTip(anchor, col) {
    var html = '<b>' + esc(col.name) + '</b>';
    if (col.type) {
      html += '<span class="col-tip__type">' + esc(col.type) + '</span>';
    }
    if (col.label) {
      html += '<span class="col-tip__why">' + esc(col.label) + '</span>';
    }
    if (col.note) {
      html += '<span class="col-tip__warn">&#9888; ' + esc(col.note) + '</span>';
    }
    showHtml(anchor, html);
  }

  /* Bulle générique (aussi utilisée par render-joins.js) */
  function showHtml(anchor, html) {
    clearTimeout(TIP_TIMER);
    var tip = ensureTip();
    var r = anchor.getBoundingClientRect();
    tip.innerHTML = html;

    var TIP_W = 240;
    var left = r.right + 10;
    var top  = r.top - 4;
    if (left + TIP_W > window.innerWidth - 8) { left = r.left - TIP_W - 10; }
    top = Math.max(8, Math.min(top, window.innerHeight - 160));

    tip.style.left = Math.round(left) + 'px';
    tip.style.top  = Math.round(top)  + 'px';
    tip.hidden = false;
  }

  function hideTip() { if (TIP_EL) TIP_EL.hidden = true; }
  function hideSoon() { clearTimeout(TIP_TIMER); TIP_TIMER = window.setTimeout(hideTip, 100); }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function connCls(conn) {
    if (conn === 'con1') return 'flow-card--c1';
    if (conn === 'con2') return 'flow-card--c2';
    if (conn === 'axi')  return 'flow-card--cx';
    return 'flow-card--c2';
  }

  function relBadge(rel) {
    var MAP = {
      ok:   { text: '✅ validé',      cls: 'badge--ok' },
      book: { text: '📖 dict.',       cls: 'badge--info' },
      q:    { text: '❓ supposé',      cls: 'badge--warn' }
    };
    MAP.dict = MAP.book;          /* noms de l'état (PLAN.md lot 2) */
    MAP.supposed = MAP.q;
    return MAP[rel] || { text: rel || '?', cls: 'badge--neutral' };
  }

  /* ============================================================
     HASH STRUCTUREL — évite de reconstruire les cartes
     quand seul le filtre ou l'alias change (perte de focus)
     ============================================================ */
  var lastHash = '';

  function structHash(nodes, joins) {
    return JSON.stringify((nodes || []).map(function (n) {
      return {
        id: n.id, name: n.name, conn: n.conn, kind: n.kind, branchOf: n.branchOf || null,
        rel: n.reliability,
        cols: (n.columns || []).map(function (c) {
          return c.name + ':' + (c.checked ? '1' : '0') + (c.isKey ? 'k' : '');
        })
      };
    })) + '|' + JSON.stringify((joins || []).map(function (j) {
      return [j.from, j.to, j.type, j.on];
    }));
  }

  /* ============================================================
     LIGNE DE COLONNE
     ============================================================ */
  function makeColRow(nodeId, col, colIdx) {
    var unchecked = !col.checked;

    /* -- Checkbox -- */
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'col-row__check';
    chk.checked = !!col.checked;
    chk.setAttribute('aria-label', col.name);

    /* -- Nom + type + clé -- */
    var nameSpan = el('span.col-row__name', { text: col.name, title: col.label || col.name });
    var typeSpan = el('span.col-row__type', { text: col.type || '' });
    var nameWrap = el('div.col-row__name-wrap', {}, [nameSpan, typeSpan]);
    if (col.isKey) {
      nameWrap.appendChild(el('span.col-row__key', {
        text: '🔑',
        title: 'Clé de jointure',
        'aria-label': 'Clé de jointure'
      }));
    }

    /* -- Champs filtre / alias -- */
    var filterIn = el('input.col-row__input', {
      type: 'text',
      placeholder: 'filtre…',
      value: col.filter || '',
      'aria-label': 'Filtre pour ' + col.name
    });
    var aliasIn = el('input.col-row__input', {
      type: 'text',
      placeholder: 'alias…',
      value: col.alias || '',
      'aria-label': 'Alias pour ' + col.name
    });

    /* -- Conteneur ligne -- */
    var row = document.createElement('div');
    row.className = 'col-row' + (unchecked ? ' col-row--unchecked' : '');

    row.appendChild(chk);
    row.appendChild(nameWrap);
    row.appendChild(el('div.col-row__fields', {}, [filterIn, aliasIn]));

    /* ---- Événements ----------------------------------------- */

    /* Tooltip sur le nom */
    on(nameWrap, 'mouseenter', function () {
      clearTimeout(TIP_TIMER);
      showTip(nameWrap, col);
    });
    on(nameWrap, 'mouseleave', function () {
      TIP_TIMER = window.setTimeout(hideTip, 100);
    });
    on(nameWrap, 'focusin',  function () { clearTimeout(TIP_TIMER); showTip(nameWrap, col); });
    on(nameWrap, 'focusout', function () { TIP_TIMER = window.setTimeout(hideTip, 100); });

    /* Checkbox */
    on(chk, 'change', function () {
      var nowOn = chk.checked;
      if (!nowOn && col.isKey) {
        if (HQ.ui && HQ.ui.toast) {
          HQ.ui.toast(
            '⚠️ ' + col.name + ' est une clé : reste dans les JOIN, sort du SELECT.',
            'warn', 5000
          );
        }
      }
      store.patch(function (s) {
        return patchCol(s, nodeId, colIdx, { checked: nowOn });
      });
    });

    /* Filtre (input live → script se régénère, carte reste) */
    on(filterIn, 'input', function () {
      var v = filterIn.value;
      store.patch(function (s) {
        return patchCol(s, nodeId, colIdx, { filter: v });
      });
    });

    /* Alias */
    on(aliasIn, 'input', function () {
      var v = aliasIn.value;
      store.patch(function (s) {
        return patchCol(s, nodeId, colIdx, { alias: v });
      });
    });

    return row;
  }

  /* Immutable patch d'une colonne dans le state */
  function patchCol(s, nodeId, colIdx, delta) {
    var nodes = (s.nodes || []).map(function (n) {
      if (n.id !== nodeId) return n;
      return Object.assign({}, n, {
        columns: (n.columns || []).map(function (c, i) {
          if (i !== colIdx) return c;
          return Object.assign({}, c, delta);
        })
      });
    });
    return Object.assign({}, s, { nodes: nodes });
  }

  /* ============================================================
     CARTE DE TABLE
     ============================================================ */
  function makeCard(node) {
    var cols = node.columns || [];
    var checked = cols.filter(function (c) { return c.checked; }).length;
    var total = cols.length;

    var rel = relBadge(node.reliability);

    var badgeEls = [el('span.badge.' + rel.cls, { text: rel.text })];
    if (node.multiplier && node.multiplier.factor) {
      badgeEls.push(el('span.badge.badge--mult', {
        text: '⚠ ' + node.multiplier.factor
      }));
    }

    /* Infobulle d'en-tête : grain + multiplicateur */
    var tipChildren = [];
    if (node.grain) {
      tipChildren.push(el('b', { text: node.grain }));
    }
    if (node.multiplier && node.multiplier.reason) {
      tipChildren.push(el('span.tip__why', {
        text: 'Multiplicateur : ' + node.multiplier.reason
      }));
    }
    if (node.multiplier && node.multiplier.workaround) {
      tipChildren.push(el('span.tip__why', {
        text: 'Parade : ' + node.multiplier.workaround
      }));
    }

    /* Bouton « relier » : ouvre la modale d'ajout de jointure (LOT 4) */
    var addBtn = el('button.flow-card__add', {
      type: 'button', text: '+',
      title: 'Relier ' + node.name + ' à une autre table',
      'aria-label': 'Ajouter une jointure depuis ' + node.name
    });
    on(addBtn, 'click', function () {
      if (HQ.renderJoins) HQ.renderJoins.openAddJoin(node.id);
    });

    var headCls = 'flow-card__head' + (tipChildren.length ? ' has-tip' : '');
    var headChildren = [
      el('div.flow-card__title-row', {}, [
        el('span.flow-card__name', { text: node.kind === 'file' ? node.name : node.schema + '.' + node.name }),
        el('span.flow-card__count', { text: checked + ' / ' + total }),
        el('div.flow-card__badges', {}, badgeEls),
        addBtn
      ]),
      el('p.flow-card__meta', { text: node.source || '' })
    ];
    if (tipChildren.length) {
      headChildren.push(el('div.tip', {}, tipChildren));
    }
    var headEl = el(headCls, {}, headChildren);

    /* Corps : colonnes recommandées puis optionnelles */
    var bodyChildren = [];

    /* Trouver la frontière recommandées / optionnelles :
       les colonnes checked:true de départ viennent en premier dans le seed. */
    var firstUncheckedIdx = -1;
    for (var i = 0; i < cols.length; i++) {
      if (!cols[i].checked) { firstUncheckedIdx = i; break; }
    }

    cols.forEach(function (col, idx) {
      if (idx === firstUncheckedIdx) {
        bodyChildren.push(el('p.flow-card__sep-label', { text: 'Colonnes optionnelles' }));
        bodyChildren.push(el('div.flow-card__sep'));
      }
      bodyChildren.push(makeColRow(node.id, col, idx));
    });

    var bodyEl = el('div.flow-card__body', {}, bodyChildren);

    var extra = node.kind === 'file' ? '.flow-card--file' : '';
    return el('div.flow-card.' + connCls(node.conn) + extra, {}, [headEl, bodyEl]);
  }

  /* ============================================================
     RENDU PRINCIPAL
     ============================================================ */
  function renderSchema() {
    var state = store.getState();
    var nodes = state.nodes || [];
    var hash  = structHash(nodes, state.joins);

    /* Ne reconstruire les cartes que si la structure a changé */
    if (hash === lastHash) return;
    lastHash = hash;

    var flow  = byId('flow');
    var empty = byId('stage-empty');
    if (!flow) return;

    if (empty) empty.hidden = nodes.length > 0;
    hideTip();
    if (HQ.renderJoins) {
      D.replace(flow, HQ.renderJoins.build(state, makeCard));
      HQ.renderJoins.afterRender();
      if (HQ.renderFinal) HQ.renderFinal.render();
    } else {
      D.replace(flow, nodes.map(makeCard));
    }

    if (HQ.ui && HQ.ui.measureStage) HQ.ui.measureStage();
  }

  /* ============================================================
     EXPORT ET ABONNEMENT
     ============================================================ */
  HQ.renderSchema = {
    render: renderSchema,
    tip: { show: showHtml, hide: hideTip, hideSoon: hideSoon }
  };

  store.subscribe(function (what) {
    if (!what || what === 'state') renderSchema();
  });

})();
