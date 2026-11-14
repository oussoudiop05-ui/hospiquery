/* ============================================================
   planner.js — transforme le résultat structuré en état HospiQuery.
   Les jointures sont calculées localement par joingraph.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.planner
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var GRANULARITES = {
    sejour: 'séjour',
    rss: 'RSS',
    rum: 'RUM',
    diagnostic: 'diagnostic',
    acte: 'acte',
    patient: 'patient'
  };
  var GRAINS = {
    TB_SEJOUR: '1 ligne = 1 séjour',
    TB_SYNTH_RSS: '1 ligne = 1 RSS',
    TB_SYNTH_RUM: '1 ligne = 1 RUM',
    TB_MVT: '1 ligne = 1 mouvement',
    TB_DIAG: '1 ligne = 1 diagnostic par mouvement',
    TB_ACTE: '1 ligne = 1 acte'
  };
  var CHAMPS_CODE = { CIM10: 'CODE_DIAG', CCAM: 'CODE_ACTE', GHM: 'CODE_GHM', CMD: 'CODE_CMD' };

  function tableName(name) {
    return String(name || '').trim().toUpperCase();
  }

  function metadata(name, id, role, why, fieldsRequis) {
    var table = HQ.dictionary.getTable(name);
    var schema = table && (table.schema || table.schemaName);
    var conn = table && (table.conn || table.connection);
    if (schema) schema = String(schema).replace(/\.$/, '');
    if (!conn && schema && schema.toUpperCase() === 'Q') conn = 'con1';
    if (!conn && /_PL$/.test(name)) conn = 'axi';
    if (!conn) conn = 'con2';
    if (!schema) schema = conn === 'con1' ? 'Q' : 'dbo';

    var source = table && (table.source || table.database);
    if (!source) {
      source = conn === 'con1' ? 'DECISIONNEL'
        : conn === 'axi' ? 'SPIM / DPI' : 'CORA RECUEIL';
    }
    return {
      id: id,
      kind: 'table',
      name: name,
      schema: schema,
      conn: conn,
      source: source,
      reliability: table ? 'dict' : 'supposed',
      grain: (table && table.grain) || GRAINS[name] || 'Granularité à confirmer',
      multiplier: HQ.rules.multiplicateur(name),
      branchOf: null,
      role: role || '',
      why: why || '',
      columns: HQ.columns.choisir(name, { filtres: [] }, null, '', fieldsRequis || [])
    };
  }

  function findNode(nodes, name) {
    var key = tableName(name);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].name === key) return nodes[i];
    }
    return null;
  }

  function ensureJoinColumn(node, name) {
    if (!node.columns.some(function (column) {
      return column.name.toUpperCase() === name.toUpperCase();
    })) {
      var field = HQ.dictionary.getField(node.name, name);
      node.columns.push({
        name: name,
        type: field && (field.type || field.dataType) || 'varchar',
        label: field && (field.description || field.label) || 'Clé de jointure',
        checked: false,
        filter: '',
        alias: '',
        isKey: true,
        note: ''
      });
    }
  }

  function addFilter(nodes, warnings, filter) {
    var node = findNode(nodes, filter.table);
    if (!node) {
      warnings.push({ level: 'warn', text: 'Filtre ignoré : table absente du plan (' + filter.table + ').' });
      return;
    }
    var column = node.columns.filter(function (item) {
      return item.name.toUpperCase() === filter.colonne.toUpperCase();
    })[0];
    if (!column) {
      warnings.push({
        level: 'warn',
        text: 'Filtre ignoré : colonne inconnue ' + node.name + '.' + filter.colonne + '.'
      });
      return;
    }
    column.filter = filter.sql;
    column.checked = true;
  }

  function sqlLiteral(value) {
    var text = String(value == null ? '' : value).trim();
    if (text.length >= 2 && text.charAt(0) === "'" && text.charAt(text.length - 1) === "'") {
      text = text.slice(1, -1).replace(/''/g, "'");
    }
    return "'" + text.replace(/'/g, "''") + "'";
  }

  function sqlFilter(operator, value) {
    var op = String(operator || '').toUpperCase();
    var text = String(value == null ? '' : value).trim();
    if (op === 'IS NOT NULL') return 'IS NOT NULL';
    if (op === 'IN') {
      var items = text.replace(/^\s*\(/, '').replace(/\)\s*$/, '').split(',');
      if (!items.length || items.length > 50 || items.some(function (item) { return !item.trim(); })) {
        throw new Error('Liste IN invalide.');
      }
      return 'IN (' + items.map(sqlLiteral).join(', ') + ')';
    }
    if (op === 'BETWEEN') {
      var bounds = text.split(/\s+AND\s+/i);
      if (bounds.length !== 2 || !bounds[0].trim() || !bounds[1].trim()) {
        throw new Error('Le filtre BETWEEN doit contenir deux bornes séparées par AND.');
      }
      return 'BETWEEN ' + sqlLiteral(bounds[0]) + ' AND ' + sqlLiteral(bounds[1]);
    }
    if (['=', 'LIKE', '>=', '<='].indexOf(op) < 0) {
      throw new Error('Opérateur de filtre non autorisé : ' + operator);
    }
    return op + ' ' + sqlLiteral(text);
  }

  function codeFilter(code) {
    var motif = String(code.motif || '').trim();
    if (!motif) throw new Error('Un motif de code métier est vide.');
    if (motif.indexOf('^') === 0) {
      return { operateur: 'LIKE', valeur: motif.slice(1).replace(/\.\*/g, '%').replace(/\.\+/g, '%').replace(/\$$/, '') };
    }
    if (motif.indexOf('LIKE ') === 0) {
      return { operateur: 'LIKE', valeur: motif.slice(5).trim() };
    }
    if (motif.indexOf('%') >= 0 || motif.indexOf('_') >= 0) {
      return { operateur: 'LIKE', valeur: motif };
    }
    return { operateur: motif.indexOf(',') >= 0 ? 'IN' : '=', valeur: motif };
  }

  function semiPath(edges, start, target) {
    var graph = {};
    edges.forEach(function (edge, index) {
      (graph[edge.de] = graph[edge.de] || []).push({ name: edge.vers, index: index });
      (graph[edge.vers] = graph[edge.vers] || []).push({ name: edge.de, index: index });
    });
    var queue = [start], previous = {};
    previous[start] = null;
    while (queue.length) {
      var current = queue.shift();
      if (current === target) break;
      (graph[current] || []).forEach(function (next) {
        if (previous[next.name] !== undefined) return;
        previous[next.name] = { name: current, edge: next.index };
        queue.push(next.name);
      });
    }
    if (previous[target] === undefined) return [];
    var path = [], cursor = target;
    while (previous[cursor]) {
      path.unshift(previous[cursor].edge);
      cursor = previous[cursor].name;
    }
    return path;
  }

  function applyDateRange(nodes, cadrage, warnings) {
    if (!cadrage || !cadrage.periode || !cadrage.periode.debut || !cadrage.periode.fin) return;
    var preferred = cadrage.bornes === 'entree'
      ? ['DATE_ENTREE', 'DATE_DEBUT']
      : cadrage.bornes === 'acte'
        ? ['DATE_ACTE', 'DATE_INTERVENTION', 'DATE_DEBUT_INTERVENTION']
        : ['DATE_SORTIE', 'DATE_FIN'];
    var target = null;
    var fieldName = null;
    for (var p = 0; p < preferred.length && !target; p++) {
      for (var i = 0; i < nodes.length && !target; i++) {
        if (HQ.dictionary.getField(nodes[i].name, preferred[p])) {
          target = nodes[i];
          fieldName = preferred[p];
        }
      }
    }
    if (!target) {
      warnings.push({ level: 'warn', text: 'Période non appliquée : aucune colonne de date compatible dans les tables retenues.' });
      return;
    }
    var column = target.columns.filter(function (item) { return item.name === fieldName; })[0];
    if (!column) {
      var field = HQ.dictionary.getField(target.name, fieldName);
      column = {
        name: field.name,
        type: field.type || field.dataType || 'date',
        label: field.description || field.label || 'Borne de période',
        checked: true,
        filter: '',
        alias: '',
        isKey: false,
        note: ''
      };
      target.columns.push(column);
    }
    var range = fieldName + ' BETWEEN ' + sqlLiteral(cadrage.periode.debut)
      + ' AND ' + sqlLiteral(cadrage.periode.fin);
    if (cadrage.bornes === 'sortie' && cadrage.enCours === 'inclure') {
      column.filter = 'RAW:(' + range + ' OR ' + fieldName + ' IS NULL)';
    } else {
      column.filter = 'BETWEEN ' + sqlLiteral(cadrage.periode.debut) + ' AND ' + sqlLiteral(cadrage.periode.fin);
    }

    column.checked = true;
  }

  function applyCadrageRules(nodes, cadrage, warnings, requestedFilters) {
    if (!cadrage) return;
    var venue = findNode(nodes, 'TMVENUE_PL');
    if (venue && Array.isArray(cadrage.typePassage) && cadrage.typePassage.length) {
      var typeField = HQ.dictionary.getField(venue.name, 'TYP_PASS');
      if (typeField) {
        var typeColumn = venue.columns.filter(function (column) { return column.name === 'TYP_PASS'; })[0];
        if (!typeColumn) {
          typeColumn = {
            name: typeField.name, type: typeField.type || 'varchar',
            label: typeField.description || '', checked: true, filter: '',
            alias: '', isKey: false, note: ''
          };
          venue.columns.push(typeColumn);
        }
        typeColumn.filter = sqlFilter('IN', cadrage.typePassage.join(','));
        typeColumn.checked = true;
      } else {
        warnings.push({ level: 'warn', text: 'Type de passage non appliqué : TMVENUE_PL.TYP_PASS est absent du dictionnaire.' });
      }
    }

    var mco = Array.isArray(cadrage.champ) && cadrage.champ.indexOf('MCO') >= 0;
    var rss = findNode(nodes, 'TB_SYNTH_RSS');
    var codeCmdField = rss && HQ.dictionary.getField(rss.name, 'CODE_CMD');
    if (mco && rss && codeCmdField) {
      var cmdColumn = rss.columns.filter(function (column) { return column.name === 'CODE_CMD'; })[0];
      if (!cmdColumn) {
        cmdColumn = {
          name: codeCmdField.name, type: codeCmdField.type || 'varchar',
          label: codeCmdField.description || '', checked: true, filter: '',
          alias: '', isKey: false, note: ''
        };
        rss.columns.push(cmdColumn);
      }
      if (cmdColumn && !cmdColumn.filter) {
        cmdColumn.filter = "NOT IN ('28','90')";
        cmdColumn.checked = true;
      }
    }

    if (cadrage.mutations === 'exclure' &&
        !requestedFilters.some(function (filter) { return filter.colonne.toUpperCase() === 'MODE_ENTREE'; })) {
      warnings.push({ level: 'warn', text: 'Exclusion des mutations internes non appliquée : vérifiez le filtre MODE_ENTREE.' });
    }
    if (String(cadrage.perimetre || '').trim() &&
        !requestedFilters.some(function (filter) { return /UF|POLE|SERVICE/i.test(filter.colonne); })) {
      warnings.push({ level: 'warn', text: 'Périmètre structurel non appliqué automatiquement : vérifiez les codes UF, pôle ou service.' });
    }
  }

  function construirePlan(sortieOutil, cadrage, requete) {
    if (!sortieOutil || !Array.isArray(sortieOutil.tables) || !sortieOutil.tables.length) {
      throw new Error('Le modèle n’a proposé aucune table.');
    }
    if (!HQ.dictionary || !HQ.dictionary.isLoaded()) {
      throw new Error('Chargez le dictionnaire avant de construire le plan.');
    }

    var selected = [];
    sortieOutil.tables.forEach(function (item) {
      var name = tableName(item.nom);
      if (!name || selected.some(function (entry) { return entry.nom === name; })) return;
      if (!HQ.dictionary.getTable(name)) throw new Error('Table absente du dictionnaire : ' + name);
      selected.push({ nom: name, role: item.role, pourquoi: item.pourquoi || '' });
    });
    if (!selected.length) throw new Error('Aucune table valide dans le plan proposé.');
    if (sortieOutil.granularite === 'sejour') {
      var stayIndex = selected.map(function (entry) { return entry.nom; }).indexOf('TB_SEJOUR');
      if (stayIndex > 0) selected.unshift(selected.splice(stayIndex, 1)[0]);
    }

    var warnings = (sortieOutil.incertitudes || []).map(function (text) {
      return { level: 'warn', text: 'À confirmer : ' + text };
    });
    var names = selected.map(function (entry) { return entry.nom; });
    var relevantFilters = [];
    (sortieOutil.filtres || []).forEach(function (filter) {
      var operator = String(filter.operateur || '').toUpperCase();
      relevantFilters.push({
        table: tableName(filter.table),
        colonne: String(filter.colonne || '').trim(),
        sql: sqlFilter(operator, filter.valeur)
      });
    });
    (sortieOutil.codes_metier || []).forEach(function (code) {
      var column = CHAMPS_CODE[String(code.nomenclature || '').toUpperCase()];
      if (!column) {
        warnings.push({ level: 'warn', text: 'Nomenclature non reconnue : ' + code.nomenclature });
        return;
      }
      var target = selected.filter(function (entry) {
        return HQ.dictionary.getField(entry.nom, column);
      })[0];
      if (!target) {
        warnings.push({ level: 'warn', text: 'Code ' + code.nomenclature + ' non appliqué : colonne ' + column + ' absente.' });
        return;
      }
      var converted = codeFilter(code);
      relevantFilters.push({
        table: target.nom,
        colonne: column,
        sql: sqlFilter(converted.operateur, converted.valeur)
      });
    });
    var venueSelected = selected.filter(function (entry) { return entry.nom === 'TMVENUE_PL'; })[0];
    if (venueSelected && Array.isArray(cadrage && cadrage.typePassage) && cadrage.typePassage.length &&
        HQ.dictionary.getField(venueSelected.nom, 'TYP_PASS')) {
      relevantFilters.push({
        table: venueSelected.nom,
        colonne: 'TYP_PASS',
        sql: sqlFilter('IN', cadrage.typePassage.join(','))
      });
    }

    var requiredByTable = {};
    relevantFilters.forEach(function (filter) {
      (requiredByTable[filter.table] = requiredByTable[filter.table] || []).push(filter.colonne);
    });

    var nodes = selected.map(function (entry, index) {
      var node = metadata(entry.nom, 'n' + (index + 1), entry.role, entry.pourquoi, requiredByTable[entry.nom]);
      node.columns = HQ.columns.choisir(entry.nom, sortieOutil, cadrage, requete, requiredByTable[entry.nom]);
      var outputColumns = sortieOutil.colonnes_sortie && sortieOutil.colonnes_sortie[entry.nom];
      if (Array.isArray(outputColumns)) {
        node.columns.forEach(function (column) {
          column.checked = outputColumns.indexOf(column.name) >= 0;
        });
      }
      if (entry.role === 'filtre') node.columns.forEach(function (column) { column.checked = false; });
      return node;
    });

    var tree = HQ.joingraph.relier(names);
    var graphEdges = [];
    tree.forEach(function (branch) {
      (branch.hops || []).forEach(function (hop) {
        var exists = graphEdges.some(function (edge) {
          return edge.de === hop.de && edge.vers === hop.vers &&
            edge.cleDe === hop.cleDe && edge.cleVers === hop.cleVers;
        });
        if (!exists) graphEdges.push(hop);
      });
    });

    graphEdges.forEach(function (edge) {
      [edge.de, edge.vers].forEach(function (name) {
        if (!findNode(nodes, name)) {
          var node = metadata(name, 'n' + (nodes.length + 1), 'intermediaire', 'Table ajoutée pour relier les tables retenues.', []);
          nodes.push(node);
          warnings.push({
            level: 'info',
            text: 'Table intermédiaire ' + name + ' ajoutée par le graphe de jointures.'
          });
        }
      });
      var fromNode = findNode(nodes, edge.de);
      var toNode = findNode(nodes, edge.vers);
      ensureJoinColumn(fromNode, edge.cleDe);
      ensureJoinColumn(toNode, edge.cleVers);
    });

    var semiEdges = {};
    selected.filter(function (entry) { return entry.role === 'filtre'; }).forEach(function (entry) {
      semiPath(graphEdges, selected[0].nom, entry.nom).forEach(function (index) {
        semiEdges[index] = true;
      });
    });

    var joins = graphEdges.map(function (edge) {
      var proof = edge.preuve === 'ok' ? '✅ validée'
        : edge.preuve === 'dict' ? '📖 documentée' : '❓ à confirmer';
      return {
        from: findNode(nodes, edge.de).id,
        to: findNode(nodes, edge.vers).id,
        type: semiEdges[graphEdges.indexOf(edge)] ? 'semi' : 'left',
        on: [[edge.cleDe, edge.cleVers]],
        note: (edge.note ? edge.note + ' ' : '') + proof
      };
    });
    var connected = {};
    graphEdges.forEach(function (edge) { connected[edge.de] = true; connected[edge.vers] = true; });
    selected.forEach(function (entry) {
      if (names.length > 1 && !connected[entry.nom]) {
        warnings.push({ level: 'warn', text: 'Aucun chemin de jointure connu vers ' + entry.nom + '.' });
      }
    });

    relevantFilters.forEach(function (filter) { addFilter(nodes, warnings, filter); });
    applyDateRange(nodes, cadrage, warnings);
    HQ.rules.appliquerFiltresObligatoires(nodes, cadrage);
    applyCadrageRules(nodes, cadrage, warnings, relevantFilters);
    warnings = warnings.concat(HQ.rules.avertissements(nodes, joins));
    joins.forEach(function (join) {
      if (join.type !== 'semi') return;
      var target = nodes.filter(function (node) { return node.id === join.to; })[0];
      if (target) target.columns.forEach(function (column) { column.checked = false; });
    });

    var granularity = GRANULARITES[sortieOutil.granularite];
    if (!granularity) throw new Error('Granularité inconnue : ' + sortieOutil.granularite);
    if (sortieOutil.granularite === 'sejour' && selected[0].nom !== 'TB_SEJOUR') {
      warnings.push({ level: 'warn', text: 'Le plan demande une ligne par séjour sans table de départ TB_SEJOUR : l’unicité ne peut pas être garantie.' });
    }
    if (sortieOutil.granularite === 'sejour' && joins.some(function (join) {
      var target = nodes.filter(function (node) { return node.id === join.to; })[0];
      return join.type !== 'semi' && target && target.multiplier;
    })) {
      warnings.push({ level: 'warn', text: 'Une jointure multiplicatrice reste présente : le résultat peut contenir plusieurs lignes par séjour.' });
    }
    return {
      request: requete || '',
      granularity: '1 ligne = 1 ' + granularity,
      cadrage: cadrage || {},
      nodes: nodes,
      joins: joins,
      derived: [],
      finalOrder: [],
      warnings: warnings
    };
  }

  function resumer(plan) {
    var lines = [
      'Plan proposé — ' + plan.granularity,
      'Tables : ' + plan.nodes.map(function (node) { return node.name; }).join(', ')
    ];
    var joins = plan.joins || [];
    if (joins.length) {
      lines.push('Jointures : ' + joins.map(function (join) {
        var from = plan.nodes.filter(function (node) { return node.id === join.from; })[0];
        var to = plan.nodes.filter(function (node) { return node.id === join.to; })[0];
        return from.name + '.' + join.on[0][0] + ' → ' + to.name + '.' + join.on[0][1];
      }).join(' ; '));
    }
    var filters = [];
    plan.nodes.forEach(function (node) {
      node.columns.forEach(function (column) {
        if (column.filter) filters.push(node.name + '.' + column.name + ' ' + column.filter);
      });
    });
    if (filters.length) lines.push('Filtres : ' + filters.join(' ; '));
    var uncertainties = (plan.warnings || []).map(function (warning) { return warning.text; });
    if (uncertainties.length) lines.push('À vérifier : ' + uncertainties.join(' ; '));
    lines.push('Vérifiez les colonnes et les jointures avant d’exécuter le script.');
    return lines.join('\n');
  }

  HQ.planner = { construirePlan: construirePlan, resumer: resumer };
})();
