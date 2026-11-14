/* ============================================================
   joins.js — logique des jointures. AUCUN accès au DOM.
   Expose HQ.joins
   ------------------------------------------------------------
   - types de jointure et leur effet sur le résultat
   - copyInfo()   : faut-il un copy_to() entre deux nœuds ? (CLAUDE.md §8.0.4)
   - suggestKeys(): clés candidates par homonymie de colonnes (CLAUDE.md §0.3 étape 3)
   - layout()     : épine dorsale horizontale + branches verticales
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var TYPES = ['inner', 'left', 'right', 'full', 'semi', 'anti'];

  var EFFECT = {
    inner: "Ne garde que les lignes trouvées des deux côtés. Les lignes sans correspondance disparaissent.",
    left:  "Garde toutes les lignes de gauche. Quand la droite ne correspond pas, ses colonnes valent NA.",
    right: "Garde toutes les lignes de droite. Quand la gauche ne correspond pas, ses colonnes valent NA.",
    full:  "Garde toutes les lignes des deux côtés, appariées quand c'est possible, NA sinon.",
    semi:  "Garde les lignes de gauche qui ont au moins une correspondance à droite, sans ajouter les colonnes de droite ni multiplier les lignes.",
    anti:  "Garde les lignes de gauche qui n'ont AUCUNE correspondance à droite. Sert à exclure ; n'ajoute aucune colonne."
  };

  function nextType(t) {
    var i = TYPES.indexOf(t);
    return TYPES[(i + 1) % TYPES.length];
  }

  function indexNodes(state) {
    var by = {};
    (state.nodes || []).forEach(function (n) { by[n.id] = n; });
    return by;
  }

  /* Deux nœuds partagent-ils le même environnement serveur ?
     con2 et con3 pointent sur le même serveur et la même base :
     ils se joignent sans copie. Un fichier local n'est jamais « sur » un serveur. */
  function sameEnv(a, b) {
    if (!a || !b) return true;
    if (a.kind === 'file' || b.kind === 'file') return false;
    if (a.conn === b.conn) return true;
    var ca = HQ.store && HQ.store.getConnection(a.conn);
    var cb = HQ.store && HQ.store.getConnection(b.conn);
    if (!ca || !cb) return false;
    return ca.server === cb.server && ca.database === cb.database;
  }

  function tempName(node) {
    return 'TEMP_' + String(node.name || node.id).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }

  /* Renvoie null si aucune copie n'est nécessaire, sinon :
     { source, target, targetConn, tempName, reason }
     Règle : on copie la liste de clés du côté « source » (le fichier local s'il y
     en a un, sinon le côté gauche de la jointure) vers le serveur de l'autre côté. */
  function copyInfo(state, join) {
    var by = indexNodes(state);
    var a = by[join.from], b = by[join.to];
    if (!a || !b || sameEnv(a, b)) return null;

    var source = a, target = b;
    if (b.kind === 'file' && a.kind !== 'file') { source = b; target = a; }

    var reason = (a.kind === 'file' || b.kind === 'file')
      ? 'Un fichier local ne peut pas être joint côté serveur : sa liste de clés est copiée sur le serveur.'
      : 'Les deux tables sont sur des serveurs différents : une jointure directe est impossible.';

    return {
      source: source,
      target: target,
      targetConn: target.kind === 'file' ? null : target.conn,
      tempName: tempName(source),
      reason: reason
    };
  }

  /* Clés candidates par homonymie : colonnes de même nom des deux côtés.
     Tri : clé déclarée d'abord, puis identifiants usuels, puis le reste. */
  var ID_RX = /^(ID_|IEP$|IPP|NO_|NUM_|CODE_)/;

  function suggestKeys(nodeA, nodeB) {
    if (!nodeA || !nodeB) return [];
    var colsB = {};
    (nodeB.columns || []).forEach(function (c) { colsB[c.name] = c; });
    var out = [];
    (nodeA.columns || []).forEach(function (c) {
      var m = colsB[c.name];
      if (!m) return;
      var score = 0;
      if (c.isKey) score += 4;
      if (m.isKey) score += 4;
      if (ID_RX.test(c.name)) score += 2;
      if (c.type && m.type && c.type !== m.type) score -= 3;
      out.push({ from: c.name, to: m.name, score: score,
                 typeClash: !!(c.type && m.type && c.type !== m.type) });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }

  /* Jointure existante entre deux nœuds (dans un sens ou dans l'autre) */
  function findBetween(state, idA, idB) {
    var js = state.joins || [];
    for (var i = 0; i < js.length; i++) {
      var j = js[i];
      if ((j.from === idA && j.to === idB) || (j.from === idB && j.to === idA)) return i;
    }
    return -1;
  }

  /* Nœuds qui ne participent à aucune jointure */
  function orphans(state) {
    var used = {};
    (state.joins || []).forEach(function (j) { used[j.from] = true; used[j.to] = true; });
    var nodes = state.nodes || [];
    if (nodes.length < 2) return [];
    return nodes.filter(function (n) { return !used[n.id]; });
  }

  /* ----------------------------------------------------------
     layout(state) — disposition du flux
     Retour :
       { columns: [ { node, join, joinIdx, via, orphan,
                      branches: [ { node, join, joinIdx, via } ] } ],
         extras:  [ { join, joinIdx } ] }      // jointures qui referment une boucle
     - join/joinIdx : la jointure qui amène ce nœud (null pour la racine)
     - via          : id du nœud déjà placé d'où part cette jointure
     ---------------------------------------------------------- */
  function layout(state) {
    var nodes = state.nodes || [];
    var joins = state.joins || [];
    var by = indexNodes(state);
    var columns = [], extras = [];
    var colOf = {};         // id du nœud → index de colonne
    var used = {};          // index de jointure déjà placée

    if (!nodes.length) return { columns: columns, extras: extras };

    function isTarget(id) {
      return joins.some(function (j) { return j.to === id && by[j.from]; });
    }

    function addSpine(node, join, joinIdx, via, orphan) {
      colOf[node.id] = columns.length;
      columns.push({ node: node, join: join, joinIdx: joinIdx, via: via,
                     orphan: !!orphan, branches: [] });
    }

    function place(node, join, joinIdx, via) {
      var pivot = node.branchOf;
      if (pivot && colOf[pivot] !== undefined && pivot === via) {
        var ci = colOf[pivot];
        colOf[node.id] = ci;
        columns[ci].branches.push({ node: node, join: join, joinIdx: joinIdx, via: via });
      } else {
        addSpine(node, join, joinIdx, via, false);
      }
    }

    var root = null;
    for (var r = 0; r < nodes.length; r++) {
      if (!isTarget(nodes[r].id)) { root = nodes[r]; break; }
    }
    addSpine(root || nodes[0], null, -1, null, false);

    var guard = 0;
    while (Object.keys(colOf).length < nodes.length && guard++ < 500) {
      var progressed = false;
      joins.forEach(function (j, idx) {
        if (used[idx]) return;
        var a = by[j.from], b = by[j.to];
        if (!a || !b) { used[idx] = true; return; }
        var pa = colOf[a.id] !== undefined, pb = colOf[b.id] !== undefined;
        if (pa && !pb)      { place(b, j, idx, a.id); used[idx] = true; progressed = true; }
        else if (pb && !pa) { place(a, j, idx, b.id); used[idx] = true; progressed = true; }
      });
      if (!progressed) {
        /* composante non reliée : on la pose au bout de l'épine */
        for (var k = 0; k < nodes.length; k++) {
          if (colOf[nodes[k].id] === undefined) {
            addSpine(nodes[k], null, -1, null, true);
            break;
          }
        }
      }
    }

    joins.forEach(function (j, idx) {
      if (!used[idx] && by[j.from] && by[j.to]) extras.push({ join: j, joinIdx: idx });
    });

    return { columns: columns, extras: extras };
  }

  /* Chemin optimal entre deux noms de table via le graphe (Lot 5) */
  function trouverChemin(depart, arrivee, sautsMax) {
    if (!HQ.joingraph) return [];
    return HQ.joingraph.chemin(depart, arrivee, sautsMax);
  }

  function preuveLien(depart, arrivee, champDe, champVers) {
    if (!HQ.joingraph || !HQ.joingraph.preuveLien) return null;
    return HQ.joingraph.preuveLien(depart, arrivee, champDe, champVers);
  }

  HQ.joins = {
    TYPES: TYPES,
    EFFECT: EFFECT,
    nextType: nextType,
    sameEnv: sameEnv,
    copyInfo: copyInfo,
    suggestKeys: suggestKeys,
    findBetween: findBetween,
    orphans: orphans,
    layout: layout,
    trouverChemin: trouverChemin,
    preuveLien: preuveLien
  };
})();
