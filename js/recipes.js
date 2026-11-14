/* ============================================================
   recipes.js — recettes d’extraction locales et paramétrées.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.recipes
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function hasSignal(text, alternatives) {
    return alternatives.some(function (value) {
      var needle = normalize(value);
      return needle && (' ' + text + ' ').indexOf(' ' + needle + ' ') >= 0;
    });
  }

  function matchingTable(patterns, fields) {
    var match = null;
    HQ.dictionary.chaqueTable(function (table) {
      if (match) return;
      var name = (table.name || '').toUpperCase();
      if (!patterns.some(function (pattern) { return pattern.test(name); })) return;
      if (fields && !fields.some(function (field) {
        return HQ.dictionary.getField(name, field);
      })) return;
      match = table.name;
    });
    return match;
  }

  function exactTable(name) {
    return HQ.dictionary.getTable(name) ? name : null;
  }

  function tableEntry(name, role, why) {
    return { nom: name, role: role, pourquoi: why };
  }

  function addFilter(filters, uncertainties, table, columns, operator, value) {
    var column = columns.filter(function (name) { return HQ.dictionary.getField(table, name); })[0];
    if (!column) {
      uncertainties.push('Filtre non appliqué : colonne ' + table + '.' + columns[0] + ' absente du dictionnaire.');
      return;
    }
    filters.push({ table: table, colonne: column, operateur: operator, valeur: value });
  }

  function addCodeFilter(filters, uncertainties, table, column, value) {
    var code = String(value || '').trim();
    if (!code) return;
    if (code.charAt(0) === '^') {
      addFilter(filters, uncertainties, table, [column], 'LIKE', code.slice(1) + '%');
    } else if (code.indexOf(',') >= 0) {
      addFilter(filters, uncertainties, table, [column], 'IN', code);
    } else {
      addFilter(filters, uncertainties, table, [column], 'LIKE', code + '%');
    }
  }

  function plan(granularite, tables, filters, uncertainties) {
    return {
      granularite: granularite,
      tables: tables,
      filtres: filters,
      codes_metier: [],
      incertitudes: uncertainties
    };
  }

  var RECETTES = [
    {
      id: 'sejours-diagnostic',
      libelle: 'Séjours portant un diagnostic CIM-10',
      motsCles: ['diagnostic', 'cim', 'pathologie', 'maladie'],
      groupes: [
        ['diagnostic', 'pathologie', 'maladie'],
        ['cim 10', 'cim10', 'code', 'dp', 'das', 'i50', 'j18', 'e11']
      ],
      parametres: [
        { nom: 'codes', libelle: 'Codes CIM-10 (préfixe ou liste)', type: 'texte', defaut: '^I50' },
        { nom: 'positions', libelle: 'Positions du diagnostic', type: 'multi', options: ['P', 'R', 'S'], defaut: ['P', 'R', 'S'] }
      ],
      construire: function (p) {
        var diagnosis = exactTable('TB_DIAG');
        if (!diagnosis) throw new Error('La recette diagnostic nécessite la table TB_DIAG.');
        var tables = [tableEntry(diagnosis, 'depart', 'Table des diagnostics PMSI.')];
        if (exactTable('TB_SEJOUR')) tables.push(tableEntry('TB_SEJOUR', 'enrichissement', 'Dates et identifiants du séjour.'));
        var filters = [], uncertainties = [];
        if (p.codes) addCodeFilter(filters, uncertainties, diagnosis, 'CODE_DIAG', p.codes);
        else uncertainties.push('Aucun code CIM-10 renseigné : tous les diagnostics sont conservés.');
        if (p.positions && p.positions.length) addFilter(filters, uncertainties, diagnosis, ['TYPE_DIAG'], 'IN', p.positions.join(','));
        return plan('diagnostic', tables, filters, uncertainties);
      }
    },
    {
      id: 'dms-comparee',
      libelle: 'Durée moyenne de séjour comparée',
      motsCles: ['dms', 'duree moyenne', 'reference nationale'],
      groupes: [
        ['dms', 'duree moyenne', 'durée moyenne'],
        ['reference', 'nationale', 'comparer', 'comparaison', 'ghm']
      ],
      parametres: [
        { nom: 'cmd', libelle: 'CMD ou GHM (facultatif)', type: 'texte', defaut: '' },
        { nom: 'seuil', libelle: 'Signaler les séjours dépassant (jours)', type: 'nombre', defaut: '30' }
      ],
      construire: function (p) {
        var rss = exactTable('TB_SYNTH_RSS');
        if (!rss) throw new Error('La recette DMS nécessite la table TB_SYNTH_RSS.');
        var tables = [tableEntry(rss, 'depart', 'Durée et groupage PMSI du RSS.')];
        if (exactTable('TB_SEJOUR')) tables.push(tableEntry('TB_SEJOUR', 'enrichissement', 'Période et identifiant séjour.'));
        var filters = [], uncertainties = [];
        if (p.cmd) addCodeFilter(filters, uncertainties, rss, 'CODE_CMD', p.cmd);
        if (p.seuil) addFilter(filters, uncertainties, rss, ['DUREE_SEJOUR'], '>=', p.seuil);
        uncertainties.push('La comparaison à une référence nationale requiert les valeurs de référence locales.');
        return plan('rss', tables, filters, uncertainties);
      }
    },
    {
      id: 'cohorte-uf',
      libelle: 'Cohorte de séjours passés par des UF',
      motsCles: ['cohorte', 'uf', 'unite fonctionnelle'],
      groupes: [
        ['cohorte', 'sejour', 'séjour'],
        ['uf', 'unite', 'unité', 'service', 'pole', 'pôle']
      ],
      parametres: [
        { nom: 'uf', libelle: 'Code(s) UF (séparés par des virgules)', type: 'texte', defaut: '' },
        { nom: 'mouvement', libelle: 'Inclure les mouvements internes', type: 'select', options: ['oui', 'non'], defaut: 'oui' }
      ],
      construire: function (p) {
        var movement = matchingTable([/^TMMOUVEMENT_PL$/, /^TB_MVT$/], ['UF_CODE', 'CODE_UF', 'ID_UNITE', 'ID_UF']);
        if (!movement) movement = matchingTable([/^TMMOUVEMENT_PL$/, /^TB_MVT$/]);
        if (!movement) throw new Error('Aucune table de mouvements/UF compatible trouvée dans le dictionnaire.');
        var tables = [tableEntry(movement, 'depart', 'Mouvements et unités fonctionnelles du séjour.')];
        if (exactTable('TB_SEJOUR')) tables.push(tableEntry('TB_SEJOUR', 'enrichissement', 'Dates et identifiant du séjour.'));
        var filters = [], uncertainties = [];
        if (p.uf) addFilter(filters, uncertainties, movement, ['UF_CODE', 'CODE_UF', 'ID_UNITE', 'ID_UF'], 'IN', String(p.uf).split(',').map(function (v) { return v.trim(); }).filter(Boolean).join(','));
        else uncertainties.push('Aucun code UF renseigné : la recette inclura toutes les unités trouvées.');
        if (p.mouvement === 'non') {
          uncertainties.push('L’exclusion des mutations internes doit être confirmée à partir du champ de mouvement disponible.');
        }
        return plan('sejour', tables, filters, uncertainties);
      }
    },
    {
      id: 'actes-ccam',
      libelle: 'Séjours avec actes enregistrés',
      granulariteFixe: 'sejour',
      motsCles: ['acte', 'ccam'],
      groupes: [
        ['acte', 'actes', 'ccam', 'intervention'],
        ['ccam', 'code', 'chirurgie', 'chirurgical', 'intervention', 'operatoire']
      ],
      parametres: [
        { nom: 'codes', libelle: 'Codes CCAM (facultatif)', type: 'texte', defaut: '' },
        { nom: 'extensions', libelle: 'Extension ATIH (facultatif)', type: 'texte', defaut: '' }
      ],
      construire: function (p) {
        var actes = exactTable('TB_ACTE');
        var sejour = exactTable('TB_SEJOUR');
        if (!actes) throw new Error('La recette CCAM nécessite la table TB_ACTE.');
        if (!sejour) throw new Error('La recette actes nécessite la table TB_SEJOUR pour garantir une ligne par séjour.');
        var tables = [
          tableEntry(sejour, 'depart', 'Table de base : une ligne par séjour.'),
          tableEntry(actes, 'filtre', 'Vérifie l’existence d’un acte sans multiplier les lignes de séjour.')
        ];
        var filters = [], uncertainties = [];
        var resultColumns = {};
        resultColumns[sejour] = ['ID_SEJOUR'];
        addFilter(filters, uncertainties, actes, ['CODE_ACTE'], 'IS NOT NULL', '');
        if (p.codes) addCodeFilter(filters, uncertainties, actes, 'CODE_ACTE', p.codes);
        if (p.extensions) addFilter(filters, uncertainties, actes, ['EXTENSION_ATIH'], 'IN', String(p.extensions).split(',').map(function (v) { return v.trim(); }).filter(Boolean).join(','));
        if (!p.codes) {
          uncertainties.push('TB_ACTE contient des actes CCAM et autres : sans codes CCAM chirurgicaux validés, le résultat couvre les actes codés, pas uniquement la chirurgie.');
        }
        var output = plan('sejour', tables, filters, uncertainties);
        output.colonnes_sortie = resultColumns;
        return output;
      }
    },
    {
      id: 'blocs-operatoires',
      libelle: 'Indicateurs de blocs opératoires',
      motsCles: ['bloc', 'bloc operatoire', 'intervention'],
      groupes: [
        ['bloc', 'salle'],
        ['intervention', 'acte', 'chirurgie', 'operatoire']
      ],
      parametres: [
        { nom: 'uf', libelle: 'Code(s) UF ou bloc (facultatif)', type: 'texte', defaut: '' },
        { nom: 'indicateur', libelle: 'Indicateur à préparer', type: 'select', options: ['volume', 'delai', 'duree'], defaut: 'volume' }
      ],
      construire: function (p) {
        var blocks = matchingTable([/^TAINDICATEURS_BLOCS_DETAILS$/]) ||
          matchingTable([/^TAINTERVENTION$/]);
        if (!blocks) throw new Error('Aucune table de détail de bloc/intervention trouvée dans le dictionnaire.');
        var tables = [tableEntry(blocks, 'depart', 'Détail des interventions/blocs opératoires.')];
        if (exactTable('TB_ACTE')) tables.push(tableEntry('TB_ACTE', 'enrichissement', 'Actes associés à l’intervention.'));
        var filters = [], uncertainties = [];
        if (p.uf) addFilter(filters, uncertainties, blocks, ['UF_CODE', 'INT_UF', 'CODE_UF'], 'IN', String(p.uf).split(',').map(function (v) { return v.trim(); }).filter(Boolean).join(','));
        uncertainties.push('L’indicateur « ' + p.indicateur + ' » doit être confirmé selon les colonnes disponibles.');
        return plan('acte', tables, filters, uncertainties);
      }
    },
    {
      id: 'germes-n2',
      libelle: 'Germes optimisables en sévérité 2',
      motsCles: ['germe', 'antibiotique', 'niveau 2'],
      groupes: [
        ['germe', 'germes', 'bacterie', 'bactéries', 'antibiotique', 'microbiologie'],
        ['niveau 2', 'severite 2', 'n2', 'niveau deux']
      ],
      parametres: [
        { nom: 'niveau', libelle: 'Niveau de sévérité', type: 'select', options: ['2'], defaut: '2' },
        { nom: 'germe', libelle: 'Germe ou famille (facultatif)', type: 'texte', defaut: '' }
      ],
      construire: function (p) {
        var germ = matchingTable([/ATB.*SYNTHESE/, /SYNTHESE.*ATB/]) ||
          matchingTable([/GERME/, /MICROBIO/]);
        if (!germ) throw new Error('Aucune table de synthèse ATB/germe trouvée dans le dictionnaire.');
        var tables = [tableEntry(germ, 'depart', 'Synthèse locale des germes et antibiotiques.')];
        var filters = [], uncertainties = [];
        var severityField = HQ.dictionary.getField(germ, 'NIVEAU_SEVERITE')
          ? 'NIVEAU_SEVERITE' : HQ.dictionary.getField(germ, 'SEVERITE')
            ? 'SEVERITE' : HQ.dictionary.getField(germ, 'NIVEAU') ? 'NIVEAU' : null;
        if (severityField) {
          addFilter(filters, uncertainties, germ, [severityField], '=', p.niveau || '2');
        } else {
          uncertainties.push('Niveau 2 demandé, mais aucune colonne de sévérité reconnue dans ' + germ + '.');
        }
        if (p.germe) addFilter(filters, uncertainties, germ, ['GERME', 'CODE_GERME', 'LIBELLE_GERME'], 'LIKE', '%' + p.germe + '%');
        if (exactTable('TB_SEJOUR')) tables.push(tableEntry('TB_SEJOUR', 'enrichissement', 'Rattachement au séjour.'));
        return plan('sejour', tables, filters, uncertainties);
      }
    },
    {
      id: 'precarite',
      libelle: 'Couverture sociale et précarité',
      motsCles: ['precarite', 'couverture sociale', 'ame', 'cmu'],
      groupes: [
        ['precarite', 'ame', 'cmu', 'complementaire sante solidaire'],
        ['couverture sociale', 'mutuelle', 'securite sociale', 'assurance maladie']
      ],
      parametres: [
        { nom: 'indicateur', libelle: 'Indicateur', type: 'select', options: ['tous', 'AME', 'CMU', 'mutuelle'], defaut: 'tous' },
        { nom: 'date', libelle: 'Date de référence (AAAAMMJJ, facultative)', type: 'date', defaut: '' }
      ],
      construire: function (p) {
        var coverage = exactTable('TMCOUVERTURE_PL') || matchingTable([/COUVERTURE/]);
        if (!coverage) throw new Error('Aucune table de couverture sociale trouvée dans le dictionnaire.');
        var tables = [tableEntry(coverage, 'depart', 'Couverture sociale et complémentaire.')];
        if (exactTable('TMPATIENT_PL')) tables.push(tableEntry('TMPATIENT_PL', 'enrichissement', 'Rattachement aux patients.'));
        var filters = [], uncertainties = [];
        if (p.indicateur && p.indicateur !== 'tous') {
          addFilter(filters, uncertainties, coverage, ['TYPE_COUVERTURE', 'TYPE', 'CODE_COUVERTURE'], 'LIKE', '%' + p.indicateur + '%');
        }
        if (p.date && !/^\d{8}$/.test(p.date)) throw new Error('La date doit respecter le format AAAAMMJJ.');
        if (p.date) uncertainties.push('La date de référence doit être reliée à la période de validité propre au dictionnaire.');
        return plan('patient', tables, filters, uncertainties);
      }
    }
  ];

  function detecter(request) {
    var text = normalize(request);
    if (!text) return null;
    return RECETTES.map(function (recipe) {
      var matched = recipe.groupes.filter(function (group) {
        return hasSignal(text, group);
      }).length;
      var score = matched / recipe.groupes.length;
      return { recette: recipe, score: score };
    }).sort(function (a, b) { return b.score - a.score; })[0] || null;
  }

  HQ.recipes = {
    liste: RECETTES,
    detecter: detecter
  };
})();
