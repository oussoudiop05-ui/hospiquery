/* ============================================================
   generator.js — génère le script R depuis l'état d'extraction
   Expose HQ.generator  (aucun accès DOM, aucun appel réseau)
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  /* ---- helpers -------------------------------------------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dashes(n) { var s = ''; for (var i = 0; i < n; i++) s += '-'; return s; }

  function sec(title, body) {
    var bar = '# ---- ' + title + ' ' + dashes(Math.max(2, 54 - title.length));
    return '\n\n' + bar + '\n' + body;
  }

  /* Retourne un tableau de clauses WHERE (sans mot-clé AND/WHERE) */
  function whereClauses(columns) {
    var out = [];
    columns.forEach(function (col) {
      var f = col.filter && col.filter.trim();
      if (!f) return;
      if (f.indexOf('RAW:') === 0) {
        out.push(f.slice(4).trim().replace(/@([A-Za-z_][A-Za-z0-9_]*)@/g, '$1')); /* condition SQL brute */
      } else {
        out.push(col.name + ' ' + f);       /* col LIKE 'X%' | col IN (...) */
      }
    });
    return out;
  }

  /* ---- construction du script ----------------------------- */
  function buildScript(state) {
    if (!state || !state.nodes || state.nodes.length === 0) {
      return '# Aucun état d\'extraction défini.';
    }

    var nodes    = state.nodes;
    var joins    = state.joins    || [];
    var derived  = state.derived  || [];
    var aggregation = state.aggregation || null;
    var warnings = state.warnings || [];

    /* index nodes par id */
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    /* connexions uniques dans l'ordre d'apparition */
    var connSeen = {}, connList = [];
    nodes.forEach(function (n) {
      if (!connSeen[n.conn]) { connSeen[n.conn] = true; connList.push(n.conn); }
    });

    /* noms des tables de lecture TB_1, TB_2 … */
    var tbRead = {};
    nodes.forEach(function (n, i) { tbRead[n.id] = 'TB_' + (i + 1); });

    /* colonnes-clés utilisées par les jointures : toujours lues, même décochées
       (cocher = « dans le résultat », pas « dans la lecture ») */
    var keyCols = {};
    joins.forEach(function (j) {
      (j.on || []).forEach(function (p) {
        (keyCols[j.from] = keyCols[j.from] || {})[p[0]] = true;
        (keyCols[j.to]   = keyCols[j.to]   || {})[p[1]] = true;
      });
    });
    function readCols(n) {
      var k = keyCols[n.id] || {};
      return (n.columns || []).filter(function (c) { return c.checked || k[c.name]; });
    }
    function isSemiTarget(node) {
      return joins.some(function (join) { return join.to === node.id && join.type === 'semi'; });
    }

    /* jointures qui exigent un copy_to() (CLAUDE.md §8.0.4) : la table de droite
       n'est pas rapatriée en entier, seulement les lignes qui correspondent
       aux clés copiées sur son serveur */
    var J = HQ.joins;
    var copyJoins = [];          // { j, info, semi }
    var deferred = {};           // nœuds lus en différé (via copy_to)
    joins.forEach(function (j) {
      var info = J ? J.copyInfo(state, j) : null;
      if (!info) return;
      var both = byId[j.from] && byId[j.to] &&
                 byId[j.from].kind !== 'file' && byId[j.to].kind !== 'file';
      var semi = j.type === 'inner' || j.type === 'left' || j.type === 'semi' || j.type === 'anti';
      var sourceDeferred = !!deferred[j.from];
      var deferSemi = !!(both && semi && !sourceDeferred);
      copyJoins.push({ j: j, info: info, semi: deferSemi, both: !!both });
      if (deferSemi) deferred[j.to] = true;
    });

    var out = [];

    /* ======= EN-TÊTE ======================================= */
    out.push([
      '# ================================================================',
      '# TITRE : ' + (state.request || 'Extraction PMSI'),
      '# DATE  : ' + today(),
      '# OBJET : ' + (state.granularity || ''),
      '# ================================================================',
    ].join('\n'));

    /* ======= AVERTISSEMENTS ================================= */
    if (warnings.length) {
      var wLines = ['', '# ---- Avertissements ' + dashes(49)];
      warnings.forEach(function (w) {
        wLines.push('# ' + (w.level === 'warn' ? '⚠️  ' : 'ℹ  ') + w.text);
      });
      out.push(wLines.join('\n'));
    }

    /* ======= 1. PACKAGES ==================================== */
    out.push(sec('1. Packages', [
      'library(DBI)',
      'library(odbc)',
      'library(dplyr)',
      'library(dbplyr)',
      'library(lubridate)',
      'library(stringr)',
    ].join('\n')));

    /* ======= 2. CONNEXIONS ================================== */
    var conLines = [];
    connList.forEach(function (cid) {
      var c = HQ.store.getConnection(cid);
      if (!c) { conLines.push('# ' + cid + ' — connexion non trouvée'); return; }
      if (conLines.length) conLines.push('');
      conLines.push(cid + ' <- dbConnect(odbc::odbc(),');
      conLines.push('             dsn      = "' + c.dsn + '",');
      conLines.push('             Driver   = "SQL Server Native Client 10.0",');
      conLines.push('             Server   = "' + c.server + '",');
      conLines.push('             Database = "' + c.database + '",');
      conLines.push('             Port     = 5432,');
      conLines.push('             encoding = "' + c.encoding + '")');
    });
    out.push(sec('2. Connexions', conLines.join('\n')));

    /* ======= 3. LECTURE DES TABLES (SQL coté serveur) ======= */
    /* Règle CLAUDE.md §8.4 : tbl(con, sql("SELECT ...")) + collect() une seule fois */
    var readLines = [];
    nodes.forEach(function (n, i) {
      var tb      = tbRead[n.id];
      var checked = readCols(n);
      var where   = whereClauses(n.columns);   /* filtre sur toutes colonnes */

      if (i > 0) readLines.push('');
      readLines.push('## ' + tb + ' — ' + n.name + '  [' + n.source + ']');
      if (n.multiplier && !isSemiTarget(n)) {
        readLines.push('## ⚠️  Multiplicateur : ' + n.multiplier.factor);
        readLines.push('## ⚠️  ' + n.multiplier.reason);
      }
      readLines.push(tb + '_SQL <- tbl(' + n.conn + ', sql("');
      readLines.push('    SELECT');
      checked.forEach(function (col, ci) {
        var comma = ci < checked.length - 1 ? ',' : '';
        readLines.push('           ' + col.name +
          (col.alias ? ' AS ' + col.alias : '') + comma);
      });
      readLines.push('    FROM ' + n.schema + '.' + n.name);
      if (where.length) {
        readLines.push('    WHERE ' + where[0]);
        where.slice(1).forEach(function (w) { readLines.push('      AND ' + w); });
      }
      readLines.push('"))');
      if (deferred[n.id]) {
        readLines.push('# Lecture différée : ' + tb + ' est filtrée côté serveur par copy_to() (étape 3b)');
        return;
      }
      readLines.push(tb + ' <- ' + tb + '_SQL %>% collect()');

      /* trimws obligatoire sur NO_SEJOUR (CLAUDE.md §8.0.7) */
      if (checked.some(function (c) { return c.name === 'NO_SEJOUR'; })) {
        readLines.push(tb + ' <- ' + tb + ' %>%');
        readLines.push('  mutate(NO_SEJOUR = trimws(NO_SEJOUR))  # ⚠️ espaces en fin de valeur CORA');
      }

      /* dédoublonnage des tables multiplicatrices (CLAUDE.md §6) */
      if (n.multiplier && !isSemiTarget(n)) {
        var allNames = checked.map(function (c) { return c.name; }).join(', ');
        readLines.push('');
        readLines.push('# Dédoublonnage (élimine les doublons inter-mouvements)');
        readLines.push(tb + '_DEDUP <- ' + tb + ' %>%');
        readLines.push('  distinct(' + allNames + ')');
        readLines.push('cat("Lignes ' + tb + '       :", nrow(' + tb + '), "\\n")');
        readLines.push('cat("Lignes ' + tb + '_DEDUP:", nrow(' + tb + '_DEDUP), "\\n")');
      }
    });
    out.push(sec('3. Lecture des tables (SQL serveur → R)', readLines.join('\n')));

    /* ======= 3b. COPY_TO (jointures entre serveurs) ========= */
    if (copyJoins.length) {
      var cpLines = [];
      copyJoins.forEach(function (cj, ci) {
        var j = cj.j, info = cj.info;
        var fromN = byId[j.from], toN = byId[j.to];
        var place = function (n) { return n.kind === 'file' ? 'fichier local' : n.conn; };
        if (ci > 0) cpLines.push('');
        cpLines.push('## ' + fromN.name + ' (' + place(fromN) + ')  →  ' + toN.name + ' (' + place(toN) + ')');
        cpLines.push('## ' + info.reason);
        if (!cj.both) {
          cpLines.push('# ⚠️  Fichier externe : sa lecture et son copy_to() complet arrivent au lot 9.');
          cpLines.push('# ' + info.tempName + ' <- copy_to(' + (info.targetConn || 'con2') +
                       ', <table locale>, name = "' + info.tempName + '", overwrite = TRUE)');
          return;
        }
        if (!cj.semi) {
          cpLines.push('# Jointure ' + j.type.toUpperCase() + ' : toutes les lignes de ' + toN.name +
                       ' sont nécessaires, la table est rapatriée en entier (copy_to inutile).');
          return;
        }
        var srcTB = tbRead[j.from];
        var fromKeys = (j.on || []).map(function (p) { return p[0]; });
        var byParts = (j.on || []).map(function (p) { return '"' + p[1] + '" = "' + p[0] + '"'; });
        cpLines.push(info.tempName + ' <- copy_to(' + toN.conn + ',');
        cpLines.push('                   ' + srcTB + ' %>% distinct(' + fromKeys.join(', ') + '),');
        cpLines.push('                   name = "' + info.tempName + '", overwrite = TRUE)  # temporaire : disparaît à la déconnexion');
        cpLines.push(tbRead[j.to] + ' <- ' + tbRead[j.to] + '_SQL %>%');
        cpLines.push('  inner_join(' + info.tempName + ', by = c(' + byParts.join(', ') + ')) %>%  # filtre côté serveur');
        cpLines.push('  collect()');
        if (readCols(toN).some(function (c) { return c.name === 'NO_SEJOUR'; })) {
          cpLines.push(tbRead[j.to] + ' <- ' + tbRead[j.to] + ' %>%');
          cpLines.push('  mutate(NO_SEJOUR = trimws(NO_SEJOUR))  # ⚠️ espaces en fin de valeur CORA');
        }
        cpLines.push('cat("Lignes ' + tbRead[j.to] + ' après copy_to :", nrow(' + tbRead[j.to] + '), "\\n")');
      });
      out.push(sec('3b. copy_to — passage d\'un serveur à l\'autre (§8.0.4)', cpLines.join('\n')));
    }

    /* ======= 4. JOINTURES =================================== */
    var typeMap = {
      'inner': 'inner_join', 'left': 'left_join',
      'right': 'right_join', 'full': 'full_join',
      'semi': 'semi_join', 'anti': 'anti_join'
    };
    var joinLines = [];

    joins.forEach(function (j, ji) {
      var fromNode = byId[j.from];
      /* côté gauche : première jointure = fromNode (DEDUP si multiplicateur),
         suivantes = résultat accumulé TB_J{n} */
      var leftTB = ji === 0
        ? tbRead[j.from] + (fromNode && fromNode.multiplier ? '_DEDUP' : '')
        : 'TB_J' + ji;
      var toNode   = byId[j.to];
      var rightTB  = tbRead[j.to] + (toNode && toNode.multiplier && !isSemiTarget(toNode) ? '_DEDUP' : '');
      var resultTB = 'TB_J' + (ji + 1);
      var joinFn   = typeMap[j.type] || 'left_join';
      var byParts  = j.on.map(function (p) { return '"' + p[0] + '" = "' + p[1] + '"'; });
      var byStr    = 'c(' + byParts.join(', ') + ')';

      if (ji > 0) joinLines.push('');
      joinLines.push('## Join ' + (ji + 1) + ' : ' + j.type.toUpperCase() + ' JOIN ' + rightTB);
      if (j.note) joinLines.push('## ' + j.note);
      joinLines.push(resultTB + ' <- ' + leftTB + ' %>%');
      joinLines.push('  ' + joinFn + '(' + rightTB + ', by = ' + byStr + ')');
      joinLines.push('cat("Après join ' + (ji + 1) + ' :", nrow(' + resultTB + '), "lignes\\n")');
    });

    /* tables lues mais reliées à rien : elles n'entrent pas dans le résultat */
    if (J) {
      J.orphans(state).forEach(function (n) {
        joinLines.push('');
        joinLines.push('# ⚠️  ' + tbRead[n.id] + ' (' + n.name + ') n\'est reliée à aucune table :');
        joinLines.push('#     elle est lue mais n\'entre pas dans TB_FINAL. Ajouter une jointure.');
      });
    }

    /* table de référence pour les étapes suivantes */
    var lastTB = joins.length > 0
      ? 'TB_J' + joins.length
      : tbRead[nodes[0].id] + (nodes[0].multiplier ? '_DEDUP' : '');

    out.push(sec('4. Jointures', joinLines.length ? joinLines.join('\n') : '# Aucune jointure.'));

    /* ======= 5. COLONNES CALCULÉES =========================== */
    var calcLines = [];
    if (derived.length) {
      calcLines.push('TB_CALC <- ' + lastTB + ' %>%');
      calcLines.push('  mutate(');
      derived.forEach(function (d, di) {
        var comma = di < derived.length - 1 ? ',' : '';
        calcLines.push('    # ' + d.why);
        calcLines.push('    ' + d.name + ' = ' + d.expr + comma);
      });
      calcLines.push('  )');
    } else {
      calcLines.push('TB_CALC <- ' + lastTB);
    }
    if (aggregation) {
      var groupBy = aggregation.groupBy || [];
      var summaries = aggregation.summaries || [];
      if (!Array.isArray(groupBy) || !Array.isArray(summaries) ||
          groupBy.some(function (name) { return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }) ||
          summaries.some(function (summary) {
            return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(summary.name || '') ||
              (summary.column && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(summary.column)) ||
              ['mean', 'sum', 'min', 'max', 'count', 'n_distinct'].indexOf(summary.operation) < 0 ||
              (summary.operation !== 'count' && !summary.column);
          })) {
        throw new Error('Agrégation invalide dans le plan.');
      }
      var having = aggregation.having || [];
      if (!Array.isArray(having) || having.some(function (condition) {
        return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(condition.column || '') ||
          ['=', '>', '>=', '<', '<='].indexOf(condition.operator) < 0 ||
          !/^\d+(?:\.\d+)?$/.test(String(condition.value));
      })) throw new Error('Condition HAVING invalide dans le plan.');
      if (!summaries.length) throw new Error('L’agrégation ne contient aucune mesure.');
      var aggregateLines = [];
      if (groupBy.length) aggregateLines.push('  group_by(' + groupBy.join(', ') + ') %>%');
      aggregateLines.push('  summarise(');
      var aggregateParts = summaries.map(function (summary) {
        var expression = summary.operation === 'count' && !summary.column ? 'n()'
          : summary.operation === 'count' ? 'sum(!is.na(' + summary.column + '))'
          : summary.operation === 'n_distinct' ? 'n_distinct(' + summary.column + ')'
            : summary.operation + '(' + summary.column + ', na.rm = TRUE)';
        return summary.name + ' = ' + expression;
      });
      aggregateParts.push('.groups = "drop"');
      aggregateParts.forEach(function (part, index) {
        aggregateLines.push('    ' + part + (index < aggregateParts.length - 1 ? ',' : ''));
      });
      aggregateLines.push('  )');
      calcLines.push('TB_CALC <- TB_CALC %>%');
      calcLines = calcLines.concat(aggregateLines);
      if (having.length) {
        calcLines.push('TB_CALC <- TB_CALC %>%');
        calcLines.push('  filter(' + having.map(function (condition) {
          return condition.column + ' ' + condition.operator + ' ' + condition.value;
        }).join(', ') + ')');
      }
    }
    out.push(sec('5. Colonnes calculées', calcLines.join('\n')));

    /* ======= 6. TABLE FINALE ================================ */
    /* ordre réconcilié : state.finalOrder d'abord, colonnes disponibles ensuite */
    var finalCols = finalColumns(state).map(function (c) { return c.name; });
    var finalLines = [];
    if (finalCols.length) {
      finalLines.push('TB_FINAL <- TB_CALC %>%');
      finalLines.push('  select(');
      finalCols.forEach(function (col, ci) {
        finalLines.push('    ' + col + (ci < finalCols.length - 1 ? ',' : ''));
      });
      finalLines.push('  )');
    } else {
      finalLines.push('TB_FINAL <- TB_CALC');
    }
    out.push(sec('6. Table finale', finalLines.join('\n')));

    /* ======= 7. CONTRÔLES QUALITÉ ============================= */
    var qualityLines = [
      'cat("=== CONTROLES QUALITE ===\\n")',
      'cat("Nb lignes      :", nrow(TB_FINAL), "\\n")'
    ];
    var qualityKeys = {
      '1 ligne = 1 séjour': ['ID_SEJOUR'],
      '1 ligne = 1 acte': ['ID_SEJOUR', 'CODE_ACTE', 'DATE_ACTE'],
      '1 ligne = 1 diagnostic': ['ID_SEJOUR', 'CODE_DIAG', 'TYPE_DIAG'],
      '1 ligne = 1 RUM': ['ID_SEJOUR', 'ID_UNITE_MEDICALE'],
      '1 ligne = 1 RSS': ['ID_RSS'],
      '1 ligne = 1 patient': ['ID_PATIENT']
    }[state.granularity] || [];
    var finalNames = finalColumns(state).map(function (column) { return column.name; });
    if (qualityKeys.length && qualityKeys.every(function (name) { return finalNames.indexOf(name) >= 0; })) {
      var keyArgs = qualityKeys.join(', ');
      qualityLines.push(
        'cat("Clés distinctes :", nrow(distinct(TB_FINAL, ' + keyArgs + ')), "\\n")',
        '',
        '# Contrôle des doublons sur la clé du grain demandé',
        'doublons <- TB_FINAL %>% group_by(' + keyArgs + ') %>% filter(n() > 1) %>% ungroup()',
        'if (nrow(doublons) > 0) {',
        '  cat("\\u26a0\\ufe0f DOUBLONS :", nrow(doublons), "lignes\\n"); print(head(doublons, 5))',
        '} else { cat("\\u2713 Aucun doublon\\n") }'
      );
    } else {
      qualityLines.push('# Contrôle d’unicité ignoré : la clé du grain demandé n’est pas dans le résultat.');
    }
    qualityLines.push('', 'glimpse(TB_FINAL)');
    out.push(sec('7. Contrôles qualité', qualityLines.join('\n')));

    /* ======= 8. EXPORT (commenté) =============================== */
    out.push(sec('8. Export (décommenter au besoin)', [
      '# path_sortie <- "<dossier projet>/sorties/"',
      '# dir.create(path_sortie, showWarnings = FALSE, recursive = TRUE)',
      '# writexl::write_xlsx(TB_FINAL,',
      '#   paste0(path_sortie, "extraction_' + today() + '.xlsx"))',
    ].join('\n')));

    /* ======= 9. DÉCONNEXION =================================== */
    out.push(sec('9. Déconnexion', connList.map(function (cid) {
      return 'DBI::dbDisconnect(' + cid + ')';
    }).join('\n')));

    return out.join('');
  }

  /* ---- colonnes de la table finale (LOT 5) ------------------
     Fonction pure. Liste ce qui sort réellement de TB_FINAL :
       - colonnes cochées (nom de sortie = alias sinon nom) ;
       - une clé de droite d'une jointure fusionne dans la clé de gauche
         (comportement de dplyr : by = c(a = b) garde a) ;
       - colonne « modifiée » (derived.col = colonne source) : prend la place
         de sa source, qui disparaît du résultat ;
       - colonnes « créées » / « agrégées » : ajoutées, n'existent qu'ici.
     Puis l'ordre : celui de state.finalOrder pour les noms connus, les
     autres à la suite dans l'ordre naturel. Les noms inconnus sont ignorés.
     Retour : [{ name, origin, nodeId, nodeName, col, label, expr, why,
                 renamedFrom, collision }]                                 */
  function finalColumns(state) {
    var nodes = (state && state.nodes) || [];
    var joins = (state && state.joins) || [];
    var derived = (state && state.derived) || [];
    var byIdN = {};
    nodes.forEach(function (n) { byIdN[n.id] = n; });

    function outName(c) { return (c.alias && c.alias.trim()) || c.name; }
    function findCol(n, name) {
      var cs = (n && n.columns) || [];
      for (var i = 0; i < cs.length; i++) if (cs[i].name === name) return cs[i];
      return null;
    }

    /* clés de droite fusionnées dans la clé de gauche */
    var merged = {};                 // merged[toId][colName] = { nodeId, col }
    joins.forEach(function (j) {
      (j.on || []).forEach(function (p) {
        (merged[j.to] = merged[j.to] || {})[p[1]] = { nodeId: j.from, col: p[0] };
      });
    });

    var list = [], seen = {};
    function push(entry) {
      if (seen[entry.name] !== undefined) {
        var prev = list[seen[entry.name]];
        if (prev.nodeId !== entry.nodeId) prev.collision = true;
        return;
      }
      seen[entry.name] = list.length;
      list.push(entry);
    }

    nodes.forEach(function (n) {
      if ((joins || []).some(function (join) { return join.to === n.id && join.type === 'semi'; })) return;
      (n.columns || []).forEach(function (c) {
        if (!c.checked) return;
        var m = merged[n.id] && merged[n.id][c.name];
        if (m) {
          /* la colonne survit sous le nom de la clé de gauche */
          var ln = byIdN[m.nodeId], lc = findCol(ln, m.col);
          push({ name: lc ? outName(lc) : m.col, origin: 'kept', nodeId: m.nodeId,
                 nodeName: ln ? ln.name : '', col: m.col, label: lc ? lc.label : c.label,
                 expr: '', why: 'Clé de jointure : fusionnée avec ' + n.name + '.' + c.name + '.',
                 renamedFrom: '', collision: false });
          return;
        }
        var nm = outName(c);
        push({ name: nm, origin: 'kept', nodeId: n.id, nodeName: n.name, col: c.name,
               label: c.label || '', expr: '', why: c.note || '',
               renamedFrom: nm !== c.name ? c.name : '', collision: false });
      });
    });

    var aggregation = state && state.aggregation;
    if (aggregation) {
      list = [];
      seen = {};
      (aggregation.groupBy || []).forEach(function (name) {
        var source = nodes.filter(function (node) {
          return (node.columns || []).some(function (column) {
            return column.name === name && column.checked;
          });
        })[0];
        if (!source) throw new Error('Colonne de regroupement absente du résultat : ' + name);
        var column = findCol(source, name);
        push({
          name: (column.alias && column.alias.trim()) || name, origin: 'kept',
          nodeId: source.id, nodeName: source.name, col: name,
          label: column.label || '', expr: '', why: 'Colonne de regroupement.',
          renamedFrom: '', collision: false
        });
      });
      (aggregation.summaries || []).forEach(function (summary) {
        push({
          name: summary.name, origin: 'aggregated', nodeId: '', nodeName: '',
          col: summary.column || '', label: summary.label || '',
          expr: summary.operation + (summary.column ? '(' + summary.column + ')' : '()'),
          why: summary.why || 'Mesure agrégée selon la recette.',
          renamedFrom: '', collision: false
        });
      });
    } else {
      derived.forEach(function (d) {
        var origin = d.origin === 'created' || d.origin === 'aggregated' ? d.origin : 'modified';
        var src = byIdN[d.from];
        var entry = { name: d.name, origin: origin, nodeId: d.from || '', nodeName: src ? src.name : '',
                      col: d.col || '', label: '', expr: d.expr || '', why: d.why || '',
                      renamedFrom: '', collision: false };
        if (origin === 'modified' && d.col && seen[d.col] !== undefined) {
          var at = seen[d.col];
          delete seen[d.col];
          list[at] = entry;
          seen[d.name] = at;
          return;
        }
        push(entry);
      });
    }

    /* ordre : finalOrder d'abord, puis le reste */
    /* un nom de l'ordre enregistré peut viser l'ancien nom d'une colonne
       renommée (alias) ou remplacée (modifiée) : elle garde sa place */
    var alt = {};
    list.forEach(function (e) {
      if (e.renamedFrom && seen[e.renamedFrom] === undefined) alt[e.renamedFrom] = e.name;
      if (e.origin === 'modified' && e.col && seen[e.col] === undefined) alt[e.col] = e.name;
    });
    var order = (state && state.finalOrder) || [];
    var out = [], used = {};
    order.forEach(function (name) {
      if (seen[name] === undefined) name = alt[name];
      if (name !== undefined && seen[name] !== undefined && !used[name]) { used[name] = true; out.push(list[seen[name]]); }
    });
    list.forEach(function (e) { if (!used[e.name]) out.push(e); });
    return out;
  }

  /* ---- buildSQL : SQL minimal SELECT / FROM / LEFT JOIN / WHERE ---- */
  function buildSQL(state) {
    if (!state || !state.nodes || !state.nodes.length) return '-- Aucun état défini.';
    var nodes = state.nodes;
    var joins = state.joins || [];

    /* alias : t1, t2, t3 … */
    var alias = {};
    nodes.forEach(function (n, i) { alias[n.id] = 't' + (i + 1); });

    /* SELECT */
    var selects = [];
    var aggregation = state.aggregation;
    if (aggregation) {
      var groupBy = aggregation.groupBy || [];
      var summaries = aggregation.summaries || [];
      if (!Array.isArray(groupBy) || !Array.isArray(summaries) ||
          groupBy.some(function (name) { return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }) ||
          summaries.some(function (summary) {
            return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(summary.name || '') ||
              (summary.column && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(summary.column)) ||
              ['mean', 'sum', 'min', 'max', 'count', 'n_distinct'].indexOf(summary.operation) < 0 ||
              (summary.operation !== 'count' && !summary.column);
          })) throw new Error('Agrégation invalide dans le plan SQL.');
      groupBy.forEach(function (name) {
        var source = nodes.filter(function (node) {
          return (node.columns || []).some(function (column) { return column.name === name; });
        })[0];
        if (!source) throw new Error('Colonne de regroupement absente : ' + name);
        selects.push('    ' + alias[source.id] + '.' + name);
      });
      summaries.forEach(function (summary) {
        var operation = summary.operation;
        var source = summary.column && nodes.filter(function (node) {
          return (node.columns || []).some(function (column) { return column.name === summary.column; });
        })[0];
        if (summary.column && !source) throw new Error('Colonne de mesure absente : ' + summary.column);
        var columnRef = source ? alias[source.id] + '.' + summary.column : '';
        var expression = operation === 'count' && !summary.column ? 'COUNT(*)'
          : operation === 'count' ? 'COUNT(' + columnRef + ')'
            : operation === 'n_distinct' ? 'COUNT(DISTINCT ' + columnRef + ')'
              : ({ mean: 'AVG', sum: 'SUM', min: 'MIN', max: 'MAX' }[operation] || operation) +
                '(' + columnRef + ')';
        selects.push('    ' + expression + ' AS ' + summary.name);
      });
    } else {
      nodes.forEach(function (n) {
        if (joins.some(function (join) { return join.to === n.id && join.type === 'semi'; })) return;
        var a = alias[n.id];
        (n.columns || []).forEach(function (c) {
          if (!c.checked) return;
          var col = a + '.' + c.name;
          if (c.alias) col += ' AS ' + c.alias;
          selects.push('    ' + col);
        });
      });
    }
    if (!selects.length) selects = ['    *'];

    /* FROM */
    var first = nodes[0];
    var sql = 'SELECT\n' + selects.join(',\n') + '\nFROM ' +
      (first.schema ? first.schema + '.' : '') + first.name + ' AS ' + alias[first.id];

    function filtersFor(node, nodeAlias) {
      var clauses = [];
      (node.columns || []).forEach(function (column) {
        var filter = column.filter && column.filter.trim();
        if (!filter) return;
        clauses.push(filter.indexOf('RAW:') === 0
          ? filter.slice(4).trim().replace(/@([A-Za-z_][A-Za-z0-9_]*)@/g, nodeAlias + '.$1')
          : nodeAlias + '.' + column.name + ' ' + filter);
      });
      return clauses;
    }

    function existsFor(join, parentAlias) {
      var child = nodes.filter(function (node) { return node.id === join.to; })[0];
      if (!child) return '';
      var childAlias = alias[child.id];
      var conditions = (join.on || []).map(function (pair) {
        return parentAlias + '.' + pair[0] + ' = ' + childAlias + '.' + pair[1];
      });
      conditions = conditions.concat(filtersFor(child, childAlias));
      joins.forEach(function (next) {
        if (next.from === child.id && next.type === 'semi') {
          conditions.push(existsFor(next, childAlias));
        }
      });
      return 'EXISTS (SELECT 1 FROM ' + (child.schema ? child.schema + '.' : '') +
        child.name + ' AS ' + childAlias + '\n    WHERE ' + conditions.join('\n      AND ') + ')';
    }

    /* Jointures normales et filtres d'existence (SEMI) */
    var semiTargets = {};
    joins.forEach(function (join) {
      if (join.type === 'semi') semiTargets[join.to] = true;
    });
    joins.forEach(function (j) {
      if (j.type === 'semi') return;
      var fromN = nodes.filter(function (n) { return n.id === j.from; })[0];
      var toN   = nodes.filter(function (n) { return n.id === j.to;   })[0];
      if (!fromN || !toN) return;
      var aFrom = alias[fromN.id], aTo = alias[toN.id];
      var onPairs = (j.on || []).map(function (p) {
        return aFrom + '.' + p[0] + ' = ' + aTo + '.' + p[1];
      }).join('\n    AND ');
      sql += '\nLEFT JOIN ' + (toN.schema ? toN.schema + '.' : '') + toN.name + ' AS ' + aTo +
        '\n    ON ' + onPairs;
    });

    /* WHERE */
    var clauses = [];
    joins.forEach(function (join) {
      if (join.type !== 'semi') return;
      if (semiTargets[join.from]) return;
      var parent = nodes.filter(function (node) { return node.id === join.from; })[0];
      if (parent) clauses.push(existsFor(join, alias[parent.id]));
    });
    nodes.forEach(function (n) {
      var semiTarget = joins.some(function (join) { return join.to === n.id && join.type === 'semi'; });
      if (!semiTarget) clauses = clauses.concat(filtersFor(n, alias[n.id]));
    });
    if (clauses.length) {
      sql += '\nWHERE ' + clauses.join('\n  AND ');
    }
    if (aggregation && aggregation.groupBy && aggregation.groupBy.length) {
      sql += '\nGROUP BY ' + aggregation.groupBy.map(function (name) {
        var source = nodes.filter(function (node) {
          return (node.columns || []).some(function (column) { return column.name === name; });
        })[0];
        return alias[source.id] + '.' + name;
      }).join(', ');
    }
    if (aggregation && aggregation.having && aggregation.having.length) {
      sql += '\nHAVING ' + aggregation.having.map(function (condition) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(condition.column || '') ||
            ['=', '>', '>=', '<', '<='].indexOf(condition.operator) < 0 ||
            !/^\d+(?:\.\d+)?$/.test(String(condition.value))) {
          throw new Error('Condition HAVING invalide dans le plan SQL.');
        }
        var summary = (aggregation.summaries || []).filter(function (item) {
          return item.name === condition.column;
        })[0];
        if (!summary) throw new Error('Mesure HAVING absente : ' + condition.column);
        var source = summary.column && nodes.filter(function (node) {
          return (node.columns || []).some(function (column) { return column.name === summary.column; });
        })[0];
        if (summary.column && !source) throw new Error('Colonne de mesure absente : ' + summary.column);
        var columnRef = source ? alias[source.id] + '.' + summary.column : '';
        var expression = summary.operation === 'count' && !summary.column ? 'COUNT(*)'
          : summary.operation === 'count' ? 'COUNT(' + columnRef + ')'
            : summary.operation === 'n_distinct' ? 'COUNT(DISTINCT ' + columnRef + ')'
              : ({ mean: 'AVG', sum: 'SUM', min: 'MIN', max: 'MAX' }[summary.operation] ||
                summary.operation) + '(' + columnRef + ')';
        return expression + ' ' + condition.operator + ' ' + condition.value;
      }).join('\n  AND ');
    }

    return sql + '\n;';
  }

  /* ---- buildMarkdown : liste colonnes par table pour le CLAUDE.md ---- */
  function buildMarkdown(state) {
    if (!state || !state.nodes || !state.nodes.length) return '*(Aucun état défini.)*';
    var lines = [];
    if (state.request) lines.push('# ' + state.request, '');
    if (state.granularity) lines.push('**Granularité :** ' + state.granularity, '');
    state.nodes.forEach(function (n) {
      var title = (n.schema ? n.schema + '.' : '') + n.name;
      lines.push('## ' + title);
      if (n.grain) lines.push('*' + n.grain + '*');
      lines.push('');
      (n.columns || []).forEach(function (c) {
        if (!c.checked) return;
        var parts = ['- **' + c.name + '**'];
        if (c.type) parts.push(' `' + c.type + '`');
        if (c.label) parts.push(' — ' + c.label);
        if (c.isKey) parts.push(' *(clé)*');
        lines.push(parts.join(''));
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  HQ.generator = { buildScript: buildScript, finalColumns: finalColumns, buildSQL: buildSQL, buildMarkdown: buildMarkdown };
})();
