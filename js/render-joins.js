/* ============================================================
   render-joins.js — flèches de jointure, nœuds copy_to, branches
   LOT 4. Aucune règle métier ici : tout vient de HQ.joins.
   Expose HQ.renderJoins = { build, openAddJoin }
   ============================================================ */
(function () {
  'use strict';

  var D = HQ.dom;
  var store = HQ.store;
  var J = HQ.joins;
  var el = D.el, on = D.on;

  var TYPE_LABEL = { inner: 'INNER', left: 'LEFT', right: 'RIGHT', full: 'FULL', semi: 'SEMI', anti: 'ANTI' };

  /* Après un clic sur une pastille, le schéma est reconstruit :
     on remet le focus sur la même pastille (navigation clavier). */
  var pendingFocus = null;

  function tip() { return HQ.renderSchema && HQ.renderSchema.tip; }

  function bindTip(anchor, htmlFn) {
    function show() { var t = tip(); if (t) t.show(anchor, htmlFn()); }
    function hide() { var t = tip(); if (t) t.hideSoon(); }
    on(anchor, 'mouseenter', show);
    on(anchor, 'mouseleave', hide);
    on(anchor, 'focus', show);
    on(anchor, 'blur', hide);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function nodeById(state, id) {
    var ns = state.nodes || [];
    for (var i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i];
    return null;
  }

  /* ---------------- actions (écrivent dans le store) -------- */

  function cycleType(idx) {
    pendingFocus = idx;
    store.patch(function (s) {
      var j = s.joins[idx];
      if (j) j.type = J.nextType(j.type);
      return s;
    });
  }

  function removeJoin(idx) {
    var s0 = store.getState();
    var j0 = s0.joins[idx];
    if (!j0) return;
    store.patch(function (s) {
      var j = s.joins[idx];
      s.joins.splice(idx, 1);
      (s.nodes || []).forEach(function (n) {
        if (n.id === j.to && n.branchOf === j.from) n.branchOf = null;
        if (n.id === j.from && n.branchOf === j.to) n.branchOf = null;
      });
      return s;
    });
    if (HQ.ui) HQ.ui.toast('Jointure supprimée. La table reste lue mais n\'entre plus dans le résultat.', 'warn', 4500);
  }

  /* ---------------- connecteur (horizontal ou vertical) ----- */

  function keyText(j) {
    return (j.on || []).map(function (p) {
      return p[0] === p[1] ? p[0] : p[0] + ' = ' + p[1];
    }).join(' · ') || '(clé manquante)';
  }

  function proofInfo(state, join) {
    var from = nodeById(state, join.from);
    var to = nodeById(state, join.to);
    var keys = join.on || [];
    var weakest = null;
    var note = '';

    if (!from || !to || !keys.length) {
      return { proof: 'suppose', note: 'Clé non documentée : à confirmer.' };
    }

    keys.forEach(function (pair) {
      var found = J.preuveLien(from.name, to.name, pair[0], pair[1]);
      if (!found) {
        weakest = 'suppose';
        note = 'Au moins une clé de cette jointure n’est pas documentée : à confirmer.';
        return;
      }
      if (!weakest || (found.preuve === 'dict' && weakest === 'ok')) {
        weakest = found.preuve;
        note = found.note;
      }
    });

    return { proof: weakest || 'suppose', note: note || 'Clé non documentée : à confirmer.' };
  }

  function proofLabel(proof) {
    if (proof === 'ok') return { mark: '✅', label: 'validée', cls: 'ok' };
    if (proof === 'dict') return { mark: '📖', label: 'documentée', cls: 'dict' };
    return { mark: '❓', label: 'à confirmer', cls: 'suppose' };
  }

  function makeProofBadge(state, join) {
    var info = proofInfo(state, join);
    var label = proofLabel(info.proof);
    var from = nodeById(state, join.from);
    var to = nodeById(state, join.to);
    var badge = el('span.join__proof.join__proof--' + label.cls, {
      title: info.note,
      'aria-label': 'Preuve de jointure : ' + label.label,
      text: label.mark + ' ' + label.label
    });
    bindTip(badge, function () {
      return '<b>Preuve de la jointure</b>' +
        '<span class="col-tip__type">' + esc(from.name + ' → ' + to.name) + '</span>' +
        '<span class="col-tip__why">' + esc(info.note) + '</span>';
    });
    return badge;
  }

  function makePill(j, idx) {
    var pill = el('button.join__pill.join__pill--' + j.type, {
      type: 'button',
      text: TYPE_LABEL[j.type] || j.type,
      'data-join': String(idx),
      'aria-label': 'Type de jointure : ' + j.type + '. Cliquer pour changer.'
    });
    on(pill, 'click', function () { cycleType(idx); });
    bindTip(pill, function () {
      return '<b>' + esc((TYPE_LABEL[j.type] || j.type) + ' JOIN') + '</b>' +
        '<span class="col-tip__why">' + esc(J.EFFECT[j.type] || '') + '</span>' +
        (j.note ? '<span class="col-tip__type">' + esc(j.note) + '</span>' : '') +
        '<span class="col-tip__type">Cliquer : inner → left → right → full → semi → anti</span>';
    });
    return pill;
  }

  function makeDel(idx) {
    var b = el('button.join__del', {
      type: 'button', text: '✕',
      title: 'Supprimer cette jointure',
      'aria-label': 'Supprimer cette jointure'
    });
    on(b, 'click', function () { removeJoin(idx); });
    return b;
  }

  function makeCopy(state, info) {
    var src = info.source, tgt = info.target;
    var where = function (n) { return n.kind === 'file' ? 'fichier local' : n.conn; };
    var box = el('div.copy-node', { tabindex: '0', 'aria-label': 'Copie copy_to vers ' + where(tgt) }, [
      el('span.copy-node__fn', { text: 'copy_to()' }),
      el('span.copy-node__dir', { text: where(src) + ' → ' + where(tgt) }),
      el('span.copy-node__tmp', { text: info.tempName })
    ]);
    bindTip(box, function () {
      return '<b>copy_to() automatique</b>' +
        '<span class="col-tip__why">' + esc(info.reason) + '</span>' +
        '<span class="col-tip__type">Les clés de ' + esc(src.name) + ' sont copiées sur ' +
        esc(where(tgt)) + ' dans la table temporaire ' + esc(info.tempName) +
        ', puis ' + esc(tgt.name) + ' est filtrée côté serveur (CLAUDE.md §8.0.4).</span>';
    });
    return box;
  }

  /* orient : 'h' (épine) ou 'v' (branche) */
  function makeConnector(state, entry, orient, prevId) {
    var j = entry.join, idx = entry.joinIdx;
    var info = J.copyInfo(state, j);
    var kids = [];

    var lineA = el('span.join__line');
    var lineB = el('span.join__line.join__line--arrow');

    var meta = [makeProofBadge(state, j), makePill(j, idx), makeDel(idx)];
    var labels = [el('code.join__key', { text: keyText(j) })];
    if (entry.via && prevId && entry.via !== prevId) {
      var viaNode = nodeById(state, entry.via);
      if (viaNode) labels.push(el('span.join__via', { text: 'depuis ' + viaNode.name }));
    }
    if (j.from !== entry.via) {
      labels.push(el('span.join__via', { text: 'sens inversé (' + nodeById(state, j.from).name + ' à gauche)' }));
    }

    if (orient === 'h') {
      kids.push(el('div.join__track', {}, info
        ? [lineA, makeCopy(state, info), lineB]
        : [lineA, lineB]));
      kids.push(el('div.join__meta', {}, meta));
      kids.push(el('div.join__labels', {}, labels));
      return el('div.join-h' + (info ? '.join-h--copy' : ''), { role: 'group', 'aria-label': 'Jointure ' + j.type }, kids);
    }

    /* branche verticale : la boîte copy_to va à côté du trait, pas dessus */
    kids.push(el('div.join__track', {}, [lineA, lineB]));
    kids.push(el('div.join__side', {}, [
      el('div.join__meta', {}, meta),
      el('div.join__labels', {}, labels),
      info ? makeCopy(state, info) : null
    ]));
    return el('div.join-v' + (info ? '.join-v--copy' : ''), { role: 'group', 'aria-label': 'Jointure ' + j.type }, kids);
  }

  function makeOrphanGap() {
    return el('div.join-h.join-h--none', { 'aria-label': 'Table non reliée' }, [
      el('div.join__track', {}, [el('span.join__line.join__line--dashed')]),
      el('div.join__labels', {}, [el('span.join__via', { text: 'non reliée' })])
    ]);
  }

  /* ---------------- construction du flux -------------------- */

  function build(state, makeCard) {
    var lay = J.layout(state);
    var out = [];
    var prevId = null;

    lay.columns.forEach(function (col, ci) {
      if (ci > 0) {
        out.push(col.join ? makeConnector(state, col, 'h', prevId) : makeOrphanGap());
      }
      var colKids = [makeCard(col.node)];
      col.branches.forEach(function (br) {
        colKids.push(el('div.flow-branch', {}, [
          makeConnector(state, br, 'v', null),
          makeCard(br.node)
        ]));
      });
      out.push(el('div.flow-col', {}, colKids));
      prevId = col.node.id;
    });

    if (lay.extras.length) {
      out.push(el('div.flow-extras', {}, [el('p.flow-extras__title', { text: 'Jointures en boucle' })]
        .concat(lay.extras.map(function (x) {
          var a = nodeById(state, x.join.from), b = nodeById(state, x.join.to);
          return el('div.flow-extras__row', {}, [
            el('code.join__key', { text: a.name + ' → ' + b.name + ' : ' + keyText(x.join) }),
            makeProofBadge(state, x.join), makePill(x.join, x.joinIdx), makeDel(x.joinIdx)
          ]);
        }))));
    }

    /* LOT 5 : flèche « select() » + emplacement de la table finale */
    if (HQ.renderFinal && lay.columns.length) out = out.concat(HQ.renderFinal.slot());

    return out;
  }

  function afterRender() {
    if (pendingFocus === null) return;
    var p = document.querySelector('.join__pill[data-join="' + pendingFocus + '"]');
    pendingFocus = null;
    if (p) p.focus();
  }

  /* ---------------- ajout d'une jointure (modale) ----------- */

  function option(value, text, selected) {
    var o = el('option', { value: value, text: text });
    if (selected) o.selected = true;
    return o;
  }

  function openAddJoin(srcId) {
    var state = store.getState();
    var src = nodeById(state, srcId);
    var others = (state.nodes || []).filter(function (n) { return n.id !== srcId; });
    if (!src) return;
    if (!others.length) {
      HQ.ui.toast('Aucune autre table dans le schéma à relier.', 'warn');
      return;
    }

    var selTarget = el('select#aj-target', {}, others.map(function (n, i) {
      return option(n.id, n.schema ? n.schema + '.' + n.name + ' (' + n.conn + ')' : n.name, i === 0);
    }));
    var selSuggest = el('select#aj-suggest');
    var selFrom = el('select#aj-from', {}, (src.columns || []).map(function (c) {
      return option(c.name, c.name + (c.type ? '  · ' + c.type : ''));
    }));
    var selTo = el('select#aj-to');
    var selType = el('select#aj-type', {}, J.TYPES.map(function (t) {
      return option(t, TYPE_LABEL[t] + ' — ' + J.EFFECT[t].split('.')[0], t === 'left');
    }));
    var hasSpineOut = (state.joins || []).some(function (j) {
      if (j.from !== srcId) return false;
      var t = nodeById(state, j.to);
      return t && t.branchOf !== srcId;
    });
    var chkBranch = el('input#aj-branch', { type: 'checkbox' });
    chkBranch.checked = hasSpineOut;
    var hint = el('p.field__hint#aj-hint');
    var effect = el('p.field__hint#aj-effect');
    var pathPreview = el('div.join-proof-path#aj-proof-path', {
      'aria-live': 'polite',
      'aria-label': 'Chemin de jointure proposé'
    });

    function target() { return nodeById(state, selTarget.value); }

    function refreshTarget() {
      var tgt = target();
      var sugg = J.suggestKeys(src, tgt);
      D.replace(selSuggest, sugg.length
        ? sugg.map(function (k, i) {
            return option(k.from + '|' + k.to,
              k.from + ' = ' + k.to + (k.typeClash ? '  ⚠ types différents' : ''), i === 0);
          }).concat([option('', '— choisir à la main —')])
        : [option('', 'aucune colonne homonyme — choisir à la main')]);
      D.replace(selTo, (tgt.columns || []).map(function (c) {
        return option(c.name, c.name + (c.type ? '  · ' + c.type : ''));
      }));
      applySuggest();
      var info = J.copyInfo(state, { from: srcId, to: tgt.id });
      hint.textContent = info
        ? '⚠ ' + info.reason + ' Un copy_to() vers ' + (info.targetConn || 'le serveur') +
          ' (table ' + info.tempName + ') sera ajouté automatiquement.'
        : 'Même serveur : jointure directe, pas de copy_to().';
      hint.className = 'field__hint' + (info ? ' field__hint--warn' : '');

      var path = J.trouverChemin(src.name, tgt.name);
      if (path.length) {
        var pathItems = path.map(function (step) {
          var proof = proofLabel(step.preuve);
          return el('li', {}, [
            el('span.join__proof.join__proof--' + proof.cls, {
              text: proof.mark + ' ' + proof.label
            }),
            el('span', {
              text: step.de + '.' + step.cleDe + ' → ' +
                step.vers + '.' + step.cleVers
            })
          ]);
        });
        D.replace(pathPreview, [
          el('p.join-proof-path__title', { text: 'Chemin documenté proposé (' + path.length + ' saut' + (path.length > 1 ? 's' : '') + ')' }),
          el('ol.join-proof-path__list', {}, pathItems)
        ]);
      } else {
        D.replace(pathPreview, [
          el('p.join-proof-path__title', { text: '❓ Aucun chemin documenté trouvé — la clé par homonymie reste à confirmer.' })
        ]);
      }
    }

    function applySuggest() {
      var v = selSuggest.value;
      if (!v) return;
      var parts = v.split('|');
      selFrom.value = parts[0];
      selTo.value = parts[1];
    }

    function refreshEffect() { effect.textContent = J.EFFECT[selType.value]; }

    on(selTarget, 'change', refreshTarget);
    on(selSuggest, 'change', applySuggest);
    on(selType, 'change', refreshEffect);

    function field(label, ctrl, extra) {
      return el('label.field', {}, [el('span.field__label', { text: label }), ctrl].concat(extra || []));
    }

    var body = [
      el('p.field__hint', { text: 'Depuis ' + src.name + '. La clé est proposée par homonymie de colonnes (sans appel réseau) : c\'est une proposition, à valider avant usage.' }),
      field('Table à relier', selTarget, [hint]),
      pathPreview,
      field('Clé proposée', selSuggest),
      el('div.aj-keys', {}, [
        field('Colonne de ' + src.name, selFrom),
        field('Colonne de la table reliée', selTo)
      ]),
      field('Type de jointure', selType, [effect]),
      el('label.aj-branch', {}, [chkBranch, el('span', { text: 'Empiler sous ' + src.name + ' (branche verticale)' })])
    ];

    var btnAdd = el('button.btn.btn--primary', { type: 'button', text: 'Ajouter la jointure' });
    var foot = [el('button.btn', { type: 'button', text: 'Annuler', 'data-close': '1' }), btnAdd];

    on(btnAdd, 'click', function () {
      var tgt = target();
      var a = selFrom.value, b = selTo.value;
      if (!a || !b) { HQ.ui.toast('Choisis une colonne de chaque côté.', 'warn'); return; }
      if (J.findBetween(store.getState(), srcId, tgt.id) > -1) {
        HQ.ui.toast('Ces deux tables sont déjà reliées : change la jointure existante.', 'warn', 4500);
        return;
      }
      var branch = chkBranch.checked;
      var type = selType.value;
      store.patch(function (s) {
        s.joins = s.joins || [];
        s.joins.push({
          from: srcId, to: tgt.id, type: type, on: [[a, b]],
          note: 'Ajoutée à la main — clé proposée par homonymie, à valider.'
        });
        (s.nodes || []).forEach(function (n) {
          if (n.id === tgt.id) n.branchOf = branch ? srcId : null;
          (n.columns || []).forEach(function (c) {
            if ((n.id === srcId && c.name === a) || (n.id === tgt.id && c.name === b)) c.isKey = true;
          });
        });
        return s;
      });
      HQ.ui.closeModal();
      HQ.ui.toast('Jointure ajoutée : ' + src.name + ' → ' + tgt.name, 'ok');
    });

    HQ.ui.openModal('Ajouter une jointure', body, foot);
    refreshTarget();
    refreshEffect();
  }

  HQ.renderJoins = { build: build, afterRender: afterRender, openAddJoin: openAddJoin };
})();
