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

  function hasSurgerySignal(query) {
    return /\b(chirurg|intervent.*chir|op[eé]r|bloc\s+op)\w*/i.test(String(query || ''));
  }

  function hasDiagnosisSignal(query) {
    return /\b[A-Z]\d{2}(?:\.\d{1,2})?\b/i.test(String(query || '')) ||
      /\b(diagnostic|cancer|cim.?10|pathologie|maladie)\b/i.test(
        String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      );
  }

  function hasActSignal(query) {
    return /\b(acte|actes|ccam|chirurg|intervent|oper|opere)\w*/i.test(
      String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
  }

  function diagnosticActRecipe(p, cadrage, request) {
    var surgery = hasSurgerySignal(request);
    var diagnosis = exactTable('TB_DIAG');
    var acts = exactTable('TB_ACTE');
    var stay = exactTable('TB_SEJOUR');
    var rss = exactTable('TB_SYNTH_RSS');
    if (!diagnosis || !acts || !stay || !rss) {
      throw new Error('La recette diagnostic et actes nécessite TB_SEJOUR, TB_DIAG et TB_ACTE dans le dictionnaire.');
    }

    var grain = cadrage && cadrage.granularite || 'sejour';
    var tables = grain === 'acte'
      ? [
          tableEntry(acts, 'depart', 'Une ligne de résultat par acte CCAM.'),
          tableEntry(rss, 'enrichissement', 'Chemin documenté vers le séjour.'),
          tableEntry(stay, 'enrichissement', 'Dates, identifiant et contexte du séjour.'),
          tableEntry(diagnosis, 'filtre', 'Vérifie le diagnostic CIM-10 sans multiplier les actes.')
        ].filter(function (entry) { return entry.nom; })
      : [
          tableEntry(stay, 'depart', 'Une ligne de résultat par séjour.'),
          tableEntry(rss, 'enrichissement', 'Groupage du séjour.'),
          tableEntry(diagnosis, 'filtre', 'Vérifie le diagnostic CIM-10 sans multiplier les séjours.'),
          tableEntry(acts, 'filtre', 'Vérifie l’existence d’un acte sans multiplier les séjours.')
        ].filter(function (entry) { return entry.nom; });
    var filters = [], uncertainties = [];
    var codesCIM = String(p.codesCIM || '').trim();
    if (!codesCIM) {
      throw new Error('Indiquez au moins un code CIM-10 (par exemple C61) pour combiner diagnostic et actes.');
    }
    addCodeFilter(filters, uncertainties, diagnosis, 'CODE_DIAG', codesCIM);
    addFilter(filters, uncertainties, diagnosis, ['TYPE_DIAG'], 'IN', 'P,R,S');

    var codesActes = String(p.codesActes || '').trim();
    if (codesActes) addCodeFilter(filters, uncertainties, acts, 'CODE_ACTE', codesActes);
    if (surgery) {
      if (!HQ.ccamChirurgie || HQ.ccamChirurgie.size !== 4698) {
        throw new Error('Le référentiel national CCAM ADC (4 698 codes) est absent ou incomplet.');
      }
      var ccamFilter = { source: 'ccam-adc', table: acts, colonne: 'CODE_ACTE' };
      var output = plan(grain, tables, filters, uncertainties);
      output.filtres_sql = [ccamFilter];
      output.colonnes_sortie = grain === 'acte' ? {
        TB_ACTE: ['ID_SEJOUR', 'ID_MVT', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'],
        TB_SEJOUR: ['NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'MODE_SORTIE'],
        TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM', 'CODE_GHS', 'CODE_DIAG_PRINC_RETENU']
      } : {
        TB_SEJOUR: ['ID_SEJOUR', 'NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'MODE_SORTIE'],
        TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM', 'CODE_GHS', 'CODE_DIAG_PRINC_RETENU']
      };
      uncertainties.push('Chirurgie définie par la classification officielle CCAM : 4 698 codes actifs ADC (activité 1), d’après le référentiel national fourni.');
      output.incertitudes = uncertainties;
      return output;
    }
    if (!codesActes && !surgery) {
      addFilter(filters, uncertainties, acts, ['CODE_ACTE'], 'IS NOT NULL', '');
      uncertainties.push('Aucun code CCAM ni terme chirurgical précis : tout acte codé est retenu, pas uniquement la chirurgie.');
    }

    var result = plan(grain, tables, filters, uncertainties);
    result.colonnes_sortie = grain === 'acte' ? {
      TB_ACTE: ['ID_SEJOUR', 'ID_MVT', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'],
      TB_SEJOUR: ['NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'MODE_SORTIE'],
      TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM', 'CODE_GHS', 'CODE_DIAG_PRINC_RETENU']
    } : {
      TB_SEJOUR: ['ID_SEJOUR', 'NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'MODE_SORTIE'],
      TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM', 'CODE_GHS', 'CODE_DIAG_PRINC_RETENU']
    };
    return result;
  }

  var RECETTES = [
    {
      id: 'diagnostic-et-actes',
      libelle: 'Séjours avec diagnostic CIM-10 et actes CCAM',
      requiresDiagnosticAndAct: true,
      motsCles: ['diagnostic', 'cim', 'cancer', 'acte', 'chirurgie', 'intervention'],
      groupes: [
        ['diagnostic', 'cim', 'cancer', 'pathologie', 'c61', 'i50', 'j18', 'e11'],
        ['acte', 'actes', 'ccam', 'chirurgie', 'chirurgical', 'intervention', 'opere']
      ],
      parametres: [
        { nom: 'codesCIM', libelle: 'Code(s) CIM-10', type: 'texte', defaut: '', extraireCIM: true },
        { nom: 'codesActes', libelle: 'Code(s) CCAM (facultatif)', type: 'texte', defaut: '' }
      ],
      construire: diagnosticActRecipe
    },
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
      libelle: 'Actes CCAM / séjours avec actes enregistrés',
      motsCles: ['acte', 'ccam'],
      groupes: [
        ['acte', 'actes', 'ccam', 'intervention'],
        ['ccam', 'code', 'chirurgie', 'chirurgical', 'intervention', 'operatoire']
      ],
      parametres: [
        { nom: 'codes', libelle: 'Codes CCAM (facultatif)', type: 'texte', defaut: '' },
        { nom: 'extensions', libelle: 'Extension ATIH (facultatif)', type: 'texte', defaut: '' }
      ],
      construire: function (p, cadrage, request) {
        var actes = exactTable('TB_ACTE');
        var sejour = exactTable('TB_SEJOUR');
        if (!actes) throw new Error('La recette CCAM nécessite la table TB_ACTE.');
        if (!sejour) throw new Error('La recette actes nécessite la table TB_SEJOUR pour garantir une ligne par séjour.');
        var grain = cadrage && cadrage.granularite || 'sejour';
        var surgery = hasSurgerySignal(request);
        var tables = grain === 'acte'
          ? [
              tableEntry(actes, 'depart', 'Table de base : une ligne par acte CCAM.'),
              tableEntry(sejour, 'enrichissement', 'Contexte et dates du séjour.')
            ]
          : [
              tableEntry(sejour, 'depart', 'Table de base : une ligne par séjour.'),
              tableEntry(actes, 'filtre', 'Vérifie l’existence d’un acte sans multiplier les lignes de séjour.')
            ];
        var filters = [], uncertainties = [];
        if (p.codes) addCodeFilter(filters, uncertainties, actes, 'CODE_ACTE', p.codes);
        if (p.extensions) addFilter(filters, uncertainties, actes, ['EXTENSION_ATIH'], 'IN', String(p.extensions).split(',').map(function (v) { return v.trim(); }).filter(Boolean).join(','));
        var resultColumns = {};
        if (grain === 'acte') {
          resultColumns.TB_ACTE = ['ID_SEJOUR', 'ID_MVT', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'];
          resultColumns.TB_SEJOUR = ['NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'];
        } else {
          resultColumns.TB_SEJOUR = ['ID_SEJOUR', 'NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'];
        }
        var output = plan(grain, tables, filters, uncertainties);
        if (surgery) {
          if (!HQ.ccamChirurgie || HQ.ccamChirurgie.size !== 4698) {
            throw new Error('Le référentiel national CCAM ADC (4 698 codes) est absent ou incomplet.');
          }
          output.filtres_sql = [{ source: 'ccam-adc', table: actes, colonne: 'CODE_ACTE' }];
          uncertainties.push('Chirurgie définie par la classification officielle CCAM : 4 698 codes actifs ADC (activité 1), d’après le référentiel national fourni.');
        } else if (!p.codes) {
          addFilter(filters, uncertainties, actes, ['CODE_ACTE'], 'IS NOT NULL', '');
          uncertainties.push('Sans code CCAM ni filtre ADC, le résultat couvre tous les actes codés et pas uniquement la chirurgie.');
        }
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

  function catalogueRecipe(config) {
    return {
      id: config.id,
      libelle: config.libelle,
      canonical: true,
      motsCles: config.motsCles,
      groupes: config.groupes,
      parametres: config.parametres || [],
      construire: function (p, cadrage) {
        var uncertainties = (config.avertissements || []).slice();
        var grain = config.aggregation && config.granularite ||
          cadrage && cadrage.granularite || config.granularite || 'sejour';
        var tableConfig = config.tables;
        if (config.ccamADC) {
          tableConfig = grain === 'acte'
            ? [
                { nom: 'TB_ACTE', role: 'depart', pourquoi: 'Une ligne de résultat par acte CCAM.' },
                { nom: 'TB_SEJOUR', role: 'enrichissement', pourquoi: 'Contexte du séjour associé à l’acte.' }
              ]
            : [
                { nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Une ligne de résultat par séjour.' },
                { nom: 'TB_ACTE', role: 'filtre', pourquoi: 'Vérifie l’existence d’un acte ADC sans multiplier les séjours.' }
              ];
        }
        var tables = tableConfig.map(function (entry) {
          var name = exactTable(entry.nom);
          if (!name) {
            uncertainties.push('Table demandée indisponible dans le dictionnaire : ' + entry.nom + '.');
            return null;
          }
          return tableEntry(name, entry.role, entry.pourquoi);
        }).filter(Boolean);
        if (!tables.length || !tables.some(function (entry) { return entry.role === 'depart'; })) {
          throw new Error('Aucune table de départ compatible pour la recette « ' + config.libelle + ' ».');
        }

        var filters = [];
        (config.filtres || []).forEach(function (filter) {
          addFilter(filters, uncertainties, filter.table, [filter.colonne], filter.operateur, filter.valeur);
        });
        if (config.codeField && p.code) {
          if (config.codeField.exact) {
            addFilter(filters, uncertainties, config.codeField.table, [config.codeField.colonne], '=', p.code);
          } else {
            addCodeFilter(filters, uncertainties, config.codeField.table, config.codeField.colonne, p.code);
          }
        }
        var requiredValue = config.requiredParam ? p[config.requiredParam] : p.code;
        if (config.codeRequired && !String(requiredValue || '').trim()) {
          throw new Error('Renseignez le code demandé pour la recette « ' + config.libelle + ' ».');
        }
        if (config.ufField && p.uf) {
          addCodeFilter(filters, uncertainties, config.ufField.table, config.ufField.colonne, p.uf);
        }
        if (config.ageField && p.age) {
          if (!/^\d{1,3}$/.test(p.age)) throw new Error('L’âge doit être un nombre entier positif.');
          addFilter(filters, uncertainties, config.ageField.table, [config.ageField.colonne], '>=', p.age);
        }
        if (config.sexeField && p.sexe) {
          if (['F', 'M', '1', '2'].indexOf(p.sexe.toUpperCase()) < 0) {
            throw new Error('Le sexe doit être F, M, 1 ou 2 selon le codage local.');
          }
          addFilter(filters, uncertainties, config.sexeField.table, [config.sexeField.colonne], '=', p.sexe.toUpperCase());
        }

        var result = plan(grain, tables, filters, uncertainties);
        var outputColumns = {};
        Object.keys(config.colonnes || {}).forEach(function (table) {
          outputColumns[table] = config.colonnes[table].filter(function (column) {
            if (HQ.dictionary.getField(table, column)) return true;
            uncertainties.push('Colonne recommandée absente du dictionnaire : ' + table + '.' + column + '.');
            return false;
          });
        });
        result.colonnes_sortie = outputColumns;
        if (config.ccamADC) {
          if (!HQ.ccamChirurgie || HQ.ccamChirurgie.size !== 4698) {
            throw new Error('Le référentiel national CCAM ADC (4 698 codes) est absent ou incomplet.');
          }
          result.filtres_sql = [{ source: 'ccam-adc', table: 'TB_ACTE', colonne: 'CODE_ACTE' }];
          uncertainties.push('Actes de chirurgie filtrés avec la classification officielle CCAM ADC (4 698 codes actifs).');
          result.colonnes_sortie = grain === 'acte' ? {
            TB_ACTE: ['ID_SEJOUR', 'ID_MVT', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'],
            TB_SEJOUR: ['NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE']
          } : {
            TB_SEJOUR: ['ID_SEJOUR', 'NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE']
          };
        }
        if (config.trustedFilter) {
          result.filtres_sql = [{
            source: config.trustedFilter,
            table: config.trustedFilter === 'hors-borne' ? 'TB_SYNTH_RSS' : 'TB_SEJOUR',
            colonne: '*'
          }];
        }
        if (config.aggregation) result.aggregation = config.aggregation;
        if (config.limit && p.limite) {
          if (!/^\d+$/.test(p.limite) || Number(p.limite) < 1 || Number(p.limite) > 10000) {
            throw new Error('La limite doit être comprise entre 1 et 10 000.');
          }
          uncertainties.push('La limite de lignes est notée, mais le plan actuel ne tronque pas automatiquement les résultats.');
        }
        result.incertitudes = uncertainties;
        return result;
      }
    };
  }

  var CATALOGUE_CANONIQUE = [
    { id: 'diag-dp', libelle: 'Séjours avec diagnostic principal', groupes: [['dp', 'diagnostic principal'], ['diagnostic', 'cim']], motsCles: ['dp', 'diagnostic principal'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Une ligne de base par séjour.' }, { nom: 'TB_DIAG', role: 'filtre', pourquoi: 'Position DP.' }], filtres: [{ table: 'TB_DIAG', colonne: 'TYPE_DIAG', operateur: '=', valeur: 'P' }], codeField: { table: 'TB_DIAG', colonne: 'CODE_DIAG' }, parametres: [{ nom: 'code', libelle: 'Code CIM-10 (facultatif)', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'NO_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_DIAG: ['CODE_DIAG', 'TYPE_DIAG'] } },
    { id: 'diag-das', libelle: 'Séjours avec diagnostic associé significatif', groupes: [['das', 'diagnostic associe'], ['comorbidite', 'diagnostic']], motsCles: ['das', 'diagnostic associé', 'comorbidité'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Une ligne par séjour.' }, { nom: 'TB_DIAG', role: 'filtre', pourquoi: 'Filtre sur les diagnostics associés.' }], filtres: [{ table: 'TB_DIAG', colonne: 'TYPE_DIAG', operateur: '=', valeur: 'S' }], codeField: { table: 'TB_DIAG', colonne: 'CODE_DIAG' }, parametres: [{ nom: 'code', libelle: 'Code CIM-10 (facultatif)', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_DIAG: ['CODE_DIAG', 'TYPE_DIAG'] } },
    { id: 'diag-chapitre-cim', libelle: 'Diagnostics d’un chapitre CIM-10', groupes: [['chapitre', 'cim'], ['cancer', 'maladie cardiovasculaire', 'code c']], motsCles: ['chapitre CIM', 'chapitre C', 'cancer', 'maladies cardiovasculaires'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Une ligne par séjour.' }, { nom: 'TB_DIAG', role: 'filtre', pourquoi: 'Filtre CIM-10.' }], filtres: [{ table: 'TB_DIAG', colonne: 'CODE_DIAG', operateur: 'LIKE', valeur: 'C%' }], codeField: { table: 'TB_DIAG', colonne: 'CODE_DIAG' }, parametres: [{ nom: 'code', libelle: 'Préfixe ou code CIM-10 (facultatif)', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_DIAG: ['CODE_DIAG', 'TYPE_DIAG'] }, avertissements: ['Le préfixe C% correspond aux tumeurs CIM-10, pas à une définition clinique des cancers actifs.'] },
    { id: 'diag-cma', libelle: 'Diagnostics associés avec CMA', groupes: [['cma', 'comorbidite associee'], ['diagnostic', 'cim']], motsCles: ['CMA', 'comorbidité associée'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours à qualifier.' }, { nom: 'TB_DIAG', role: 'filtre', pourquoi: 'Diagnostics associés.' }], filtres: [{ table: 'TB_DIAG', colonne: 'TYPE_DIAG', operateur: '=', valeur: 'S' }], codeField: { table: 'TB_DIAG', colonne: 'CODE_DIAG' }, parametres: [{ nom: 'code', libelle: 'Code CIM-10 (facultatif)', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR'], TB_DIAG: ['CODE_DIAG', 'TYPE_DIAG'] }, avertissements: ['La hiérarchie CMA doit être reliée à TB_DIAG avec une clé officielle avant d’interpréter un code comme CMA.'] },
    { id: 'diag-multiple', libelle: 'Séjours avec au moins deux diagnostics distincts', groupes: [['au moins 2 diagnostics', 'deux diagnostics', 'poly pathologie'], ['diagnostic', 'sejour']], motsCles: ['diagnostics multiples', 'polypathologie', 'au moins 2 diagnostics', 'deux diagnostics'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Clé de regroupement : séjour.' }, { nom: 'TB_DIAG', role: 'enrichissement', pourquoi: 'Comptage des codes diagnostic distincts.' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR'], TB_DIAG: ['ID_SEJOUR', 'CODE_DIAG'] }, aggregation: { groupBy: ['ID_SEJOUR'], summaries: [{ operation: 'n_distinct', column: 'CODE_DIAG', name: 'NB_DIAGNOSTICS' }], having: [{ column: 'NB_DIAGNOSTICS', operator: '>=', value: 2 }] } },

    { id: 'acte-chirurgie', libelle: 'Actes de chirurgie CCAM', groupes: [['chirurgie', 'chirurgical', 'opere'], ['acte', 'actes', 'intervention', 'bloc']], motsCles: ['chirurgie', 'opéré', 'opérés', 'intervention chirurgicale'], tables: [{ nom: 'TB_ACTE', role: 'depart', pourquoi: 'Une ligne par acte CCAM.' }], colonnes: { TB_ACTE: ['ID_SEJOUR', 'ID_MVT', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'] }, ccamADC: true },
    { id: 'acte-code-exact', libelle: 'Actes correspondant à un code CCAM', groupes: [['code ccam', 'code acte'], ['acte', 'intervention']], motsCles: ['code CCAM', 'code acte'], tables: [{ nom: 'TB_ACTE', role: 'depart', pourquoi: 'Actes CCAM.' }], codeField: { table: 'TB_ACTE', colonne: 'CODE_ACTE', exact: true }, codeRequired: true, parametres: [{ nom: 'code', libelle: 'Code CCAM exact', type: 'texte', defaut: '' }], colonnes: { TB_ACTE: ['ID_SEJOUR', 'CODE_ACTE', 'DATE_ACTE', 'ID_UNITE_EXEC'] }, granularite: 'acte' },
    { id: 'acte-liste', libelle: 'Actes correspondant à une liste CCAM', groupes: [['liste de codes ccam', 'codes ccam'], ['actes', 'interventions']], motsCles: ['liste CCAM', 'liste de codes CCAM', 'codes CCAM'], tables: [{ nom: 'TB_ACTE', role: 'depart', pourquoi: 'Une ligne par acte.' }], codeField: { table: 'TB_ACTE', colonne: 'CODE_ACTE' }, codeRequired: true, parametres: [{ nom: 'code', libelle: 'Codes CCAM (maximum 50)', type: 'texte', defaut: '' }], colonnes: { TB_ACTE: ['ID_SEJOUR', 'CODE_ACTE', 'DATE_ACTE'] }, granularite: 'acte' },
    { id: 'acte-imagerie', libelle: 'Actes d’imagerie médicale', groupes: [['imagerie', 'scanner', 'irm'], ['acte', 'radiologie']], motsCles: ['imagerie', 'scanner', 'IRM', 'radiologie'], tables: [{ nom: 'TB_ACTE', role: 'depart', pourquoi: 'Actes CCAM d’imagerie à filtrer.' }], codeField: { table: 'TB_ACTE', colonne: 'CODE_ACTE' }, codeRequired: true, parametres: [{ nom: 'code', libelle: 'Code(s) CCAM d’imagerie', type: 'texte', defaut: '' }], colonnes: { TB_ACTE: ['ID_SEJOUR', 'CODE_ACTE', 'DATE_ACTE'] }, granularite: 'acte', avertissements: ['Aucun référentiel national ADI n’est chargé : renseignez les codes CCAM d’imagerie pour éviter de retourner tous les actes.'] },
    { id: 'acte-endoscopie', libelle: 'Actes d’endoscopie', groupes: [['endoscopie', 'coloscopie'], ['acte', 'fibroscopie']], motsCles: ['endoscopie', 'coloscopie', 'fibroscopie'], tables: [{ nom: 'TB_ACTE', role: 'depart', pourquoi: 'Actes CCAM d’endoscopie à filtrer.' }], codeField: { table: 'TB_ACTE', colonne: 'CODE_ACTE' }, codeRequired: true, parametres: [{ nom: 'code', libelle: 'Code(s) CCAM d’endoscopie', type: 'texte', defaut: '' }], colonnes: { TB_ACTE: ['ID_SEJOUR', 'CODE_ACTE', 'DATE_ACTE'] }, granularite: 'acte', avertissements: ['Aucun référentiel national END n’est chargé : renseignez les codes CCAM d’endoscopie.'] },

    { id: 'par-uf', libelle: 'Activité par UF', groupes: [['par uf', 'par unite fonctionnelle'], ['activite uf', 'sejours']], motsCles: ['par UF', 'activité UF'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours classés par UF d’entrée.' }], colonnes: { TB_SEJOUR: ['UF_ENTREE', 'ID_SEJOUR'] }, aggregation: { groupBy: ['UF_ENTREE'], summaries: [{ operation: 'count', name: 'NB_SEJOURS' }] }, granularite: 'uf', avertissements: ['Le résultat utilise UF_ENTREE ; il ne reconstitue pas les passages successifs dans les unités.'] },
    { id: 'par-um', libelle: 'Activité par UM', groupes: [['par um', 'par unite medicale'], ['service', 'activite']], motsCles: ['par UM', 'activité du service'], tables: [{ nom: 'TB_SYNTH_RUM', role: 'depart', pourquoi: 'RUM et unité médicale.' }], colonnes: { TB_SYNTH_RUM: ['ID_UNITE_MEDICALE', 'ID_SEJOUR'] }, aggregation: { groupBy: ['ID_UNITE_MEDICALE'], summaries: [{ operation: 'n_distinct', column: 'ID_SEJOUR', name: 'NB_SEJOURS' }] }, granularite: 'um' },
    { id: 'par-pole', libelle: 'Activité regroupée par UF (pôle à vérifier)', groupes: [['par pole', 'activite du pole'], ['sejours', 'unite']], motsCles: ['pôle', 'activité du pôle'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours regroupés par UF d’entrée, faute de correspondance de pôle vérifiée.' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'UF_ENTREE'] }, aggregation: { groupBy: ['UF_ENTREE'], summaries: [{ operation: 'count', name: 'NB_SEJOURS' }] }, granularite: 'uf', avertissements: ['Aucune table de correspondance UF-pôle vérifiée dans le dictionnaire : ce résultat est par UF, pas par pôle.'] },
    { id: 'uf-specifique', libelle: 'Séjours d’une UF spécifique', groupes: [['uf specifique', 'uf'], ['sejours', 'neurologie', 'service']], motsCles: ['UF spécifique', 'séjours de neurologie'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours filtrés par UF d’entrée.' }], ufField: { table: 'TB_SEJOUR', colonne: 'UF_ENTREE' }, codeRequired: true, requiredParam: 'uf', parametres: [{ nom: 'uf', libelle: 'Code UF', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'UF_ENTREE', 'DATE_ENTREE', 'DATE_SORTIE'] } },

    { id: 'mco-standard', libelle: 'Séjours d’hospitalisation MCO', groupes: [['hospitalisation', 'sejour mco'], ['mco', 'standard']], motsCles: ['hospitalisations MCO', 'séjours MCO'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours hospitaliers.' }, { nom: 'TB_SYNTH_RSS', role: 'enrichissement', pourquoi: 'Groupage MCO.' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'MODE_SORTIE'], TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM', 'CODE_GHS'] } },
    { id: 'seances', libelle: 'Séances PMSI', groupes: [['seance', 'seances'], ['dialyse', 'chimiotherapie', 'radiotherapie']], motsCles: ['séances', 'dialyse', 'chimiothérapie'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours de type séance.' }, { nom: 'TB_SYNTH_RSS', role: 'filtre', pourquoi: 'Repérage par CMD.' }], filtres: [{ table: 'TB_SYNTH_RSS', colonne: 'CODE_CMD', operateur: '=', valeur: '28' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_SYNTH_RSS: ['CODE_CMD', 'CODE_GHM'] }, avertissements: ['Le filtre CMD 28 doit être confirmé selon le champ MCO et le millésime de groupage locaux.'] },
    { id: 'urgences', libelle: 'Séjours après passage aux urgences', groupes: [['urgences', 'urgence'], ['admission', 'sejour']], motsCles: ['urgences', 'admission après urgence'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours avec indicateur d’entrée par les urgences.' }], filtres: [{ table: 'TB_SEJOUR', colonne: 'ENTREE_URGENCE', operateur: '=', valeur: 'O' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'ENTREE_URGENCE'] }, avertissements: ['Le codage de ENTREE_URGENCE (O/N ou autre) doit être confirmé sur le dictionnaire métier.'] },
    { id: 'ambulatoire', libelle: 'Séjours ambulatoires', groupes: [['ambulatoire', 'sans nuit'], ['chirurgie ambulatoire', 'duree zero']], motsCles: ['ambulatoire', 'sans nuit'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours à durée nulle.' }, { nom: 'TB_SYNTH_RSS', role: 'filtre', pourquoi: 'Durée du RSS.' }], filtres: [{ table: 'TB_SYNTH_RSS', colonne: 'DUREE_SEJOUR', operateur: '=', valeur: '0' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_SYNTH_RSS: ['DUREE_SEJOUR', 'CODE_GHM'] }, avertissements: ['DUREE_SEJOUR doit être vérifié comme nombre de jours et selon la convention des entrées/sorties le même jour.'] },

    { id: 'ghm-specifique', libelle: 'Séjours selon un GHM', groupes: [['ghm specifique', 'code ghm'], ['sejour', 'ghm']], motsCles: ['GHM spécifique', 'code GHM'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Une ligne par séjour.' }, { nom: 'TB_SYNTH_RSS', role: 'filtre', pourquoi: 'Filtre du groupage GHM.' }], codeField: { table: 'TB_SYNTH_RSS', colonne: 'CODE_GHM', exact: true }, parametres: [{ nom: 'code', libelle: 'Code GHM exact', type: 'texte', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_SYNTH_RSS: ['CODE_GHM', 'CODE_CMD', 'CODE_GHS'] } },
    { id: 'valorisation-sejour', libelle: 'Valorisation GHS des séjours', groupes: [['valorisation', 'tarif'], ['ghs', 'sejour']], motsCles: ['valorisation', 'tarif GHS'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours valorisés.' }, { nom: 'TB_SYNTH_RSS', role: 'enrichissement', pourquoi: 'Montants PMSI du RSS.' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'], TB_SYNTH_RSS: ['CODE_GHS', 'MONTANT_GHS', 'MONTANT_DEP', 'MONTANT_COEF'] }, avertissements: ['Les tarifs nationaux doivent être joints au millésime tarifaire correspondant ; aucune jointure tarifaire n’est supposée ici.'] },
    { id: 'dms-par-ghm', libelle: 'Durée moyenne de séjour par GHM', groupes: [['dms', 'duree moyenne'], ['par ghm', 'ghm']], motsCles: ['DMS par GHM', 'durée moyenne par GHM'], tables: [{ nom: 'TB_SYNTH_RSS', role: 'depart', pourquoi: 'Durée et groupage du RSS.' }], colonnes: { TB_SYNTH_RSS: ['CODE_GHM', 'DUREE_SEJOUR'] }, aggregation: { groupBy: ['CODE_GHM'], summaries: [{ operation: 'mean', column: 'DUREE_SEJOUR', name: 'DMS' }] }, granularite: 'dms' },
    { id: 'hors-borne', libelle: 'Séjours hors bornes de durée', groupes: [['hors borne', 'exb', 'exh'], ['sejour', 'ghm']], motsCles: ['hors borne', 'EXB', 'EXH'], tables: [{ nom: 'TB_SYNTH_RSS', role: 'depart', pourquoi: 'Indicateurs de durée par RSS.' }], colonnes: { TB_SYNTH_RSS: ['ID_SEJOUR', 'CODE_GHM', 'DUREE_SEJOUR'] }, trustedFilter: 'hors-borne', avertissements: ['Un séjour est retenu si BORNE_BASSE=O ou NB_JOUR_EXB>0 ; confirmer cette règle avec le millésime PMSI local.'] },

    { id: 'age-entree', libelle: 'Séjours selon l’âge à l’entrée', groupes: [['age', 'patients de plus de'], ['pediatrie', 'personnes agees']], motsCles: ['âge à l’entrée', 'patients de plus de', 'pédiatrie', 'personnes âgées'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours patients.' }, { nom: 'TB_SYNTH_RSS', role: 'enrichissement', pourquoi: 'Âge au groupage.' }], ageField: { table: 'TB_SYNTH_RSS', colonne: 'AGE_ENTREE' }, parametres: [{ nom: 'age', libelle: 'Âge minimum (facultatif)', type: 'nombre', defaut: '' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE'], TB_SYNTH_RSS: ['AGE_ENTREE'] } },
    { id: 'sexe', libelle: 'Séjours selon le sexe', groupes: [['femmes', 'hommes'], ['sexe', 'sex ratio']], motsCles: ['femmes', 'hommes', 'sex ratio'], tables: [{ nom: 'TB_PATIENT', role: 'depart', pourquoi: 'Caractéristique démographique patient.' }, { nom: 'TB_SEJOUR', role: 'enrichissement', pourquoi: 'Séjours liés au patient.' }], sexeField: { table: 'TB_PATIENT', colonne: 'SEXE' }, parametres: [{ nom: 'sexe', libelle: 'Sexe (F, M, 1 ou 2)', type: 'texte', defaut: '' }], colonnes: { TB_PATIENT: ['ID_PATIENT', 'SEXE'], TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE'] }, avertissements: ['Le codage local du sexe doit être validé avant d’interpréter F/M ou 1/2.'] },
    { id: 'reentrees', libelle: 'Réhospitalisations à 30 jours', groupes: [['rehospitalisation', 're hospitalisation'], ['30 jours', 'retour']], motsCles: ['réhospitalisations', 'retour dans les 30 jours'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Séjours et indicateur de réhospitalisation.' }], filtres: [{ table: 'TB_SEJOUR', colonne: 'HOSPIT30', operateur: '=', valeur: 'O' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'DATE_SORTIE', 'HOSPIT30'] }, avertissements: ['Le sens, la période et le codage de HOSPIT30 doivent être vérifiés ; aucun auto-join de dates n’est supposé.'] },
    { id: 'patients-filtre', libelle: 'Séjours selon le code postal', groupes: [['domicilie', 'code postal'], ['patient', 'sejour']], motsCles: ['domiciliés à', 'code postal'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Code postal et séjour.' }], parametres: [{ nom: 'code', libelle: 'Code postal ou préfixe', type: 'texte', defaut: '' }], codeField: { table: 'TB_SEJOUR', colonne: 'CODE_POSTAL' }, colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'CODE_POSTAL', 'DATE_ENTREE', 'DATE_SORTIE'] } },

    { id: 'erreurs-groupage', libelle: 'RSS avec erreurs de groupage', groupes: [['erreur de groupage', 'code 90z'], ['rss', 'ghm']], motsCles: ['erreurs de groupage', 'code 90Z'], tables: [{ nom: 'TB_SYNTH_RSS', role: 'depart', pourquoi: 'Code d’erreur du RSS.' }], filtres: [{ table: 'TB_SYNTH_RSS', colonne: 'CODE_ERR', operateur: '<>', valeur: '000' }], colonnes: { TB_SYNTH_RSS: ['ID_SEJOUR', 'CODE_GHM', 'CODE_ERR'] } },
    { id: 'non-valides-dim', libelle: 'RSS non validés DIM', groupes: [['non valide dim', 'non valides dim'], ['a coder', 'validation']], motsCles: ['non validés DIM', 'à coder'], tables: [{ nom: 'TB_SYNTH_RSS', role: 'depart', pourquoi: 'État de validation DIM.' }], filtres: [{ table: 'TB_SYNTH_RSS', colonne: 'VALID_DIM', operateur: '=', valeur: 'N' }], colonnes: { TB_SYNTH_RSS: ['ID_SEJOUR', 'CODE_GHM', 'VALID_DIM'] } },
    { id: 'dossiers-incomplets', libelle: 'Dossiers administratifs incomplets', groupes: [['dossier incomplet', 'dossiers incomplets'], ['etat adm', 'sejour']], motsCles: ['dossiers incomplets', 'dossier incomplet', 'ETAT_ADM'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'État administratif du dossier.' }], filtres: [{ table: 'TB_SEJOUR', colonne: 'ETAT_ADM_DOSSIER', operateur: '=', valeur: 'I' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'DATE_ENTREE', 'ETAT_ADM_DOSSIER'] }, avertissements: ['Le code I doit être confirmé dans le dictionnaire métier avant d’interpréter un dossier comme incomplet.'] },
    { id: 'sejours-bloque', libelle: 'Séjours bloqués ou rejetés', groupes: [['sejour bloque', 'sejours bloques'], ['facturation rejetee', 'rejet']], motsCles: ['séjours bloqués', 'facturation rejetée'], tables: [{ nom: 'TB_SEJOUR', role: 'depart', pourquoi: 'Statut du séjour ou de facturation.' }], colonnes: { TB_SEJOUR: ['ID_SEJOUR', 'STATUT', 'ETAT_FACTURATION', 'DATE_ENTREE', 'DATE_SORTIE'] }, trustedFilter: 'sejours-bloque', avertissements: ['La condition est STATUT=T ou ETAT_FACTURATION=R ; valider le sens métier de ces codes avant exécution.'] }
  ];

  var recetteCombo = RECETTES.filter(function (recipe) {
    return recipe.id === 'diagnostic-et-actes';
  })[0];
  var recettesExistantes = RECETTES.filter(function (recipe) {
    return recipe.id !== 'diagnostic-et-actes';
  });
  RECETTES = [recetteCombo].concat(
    CATALOGUE_CANONIQUE.map(catalogueRecipe),
    recettesExistantes
  );

  function detecter(request) {
    var text = normalize(request);
    if (!text) return null;
    return RECETTES.map(function (recipe) {
      if (recipe.requiresDiagnosticAndAct &&
          (!hasDiagnosisSignal(request) || !hasActSignal(request))) return null;
      var matched = recipe.groupes.filter(function (group) {
        return hasSignal(text, group);
      }).length;
      var score = matched / recipe.groupes.length;
      if (recipe.canonical && hasSignal(text, recipe.motsCles)) score = 1;
      if (recipe.requiresDiagnosticAndAct) score = 1;
      return { recette: recipe, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; })[0] || null;
  }

  HQ.recipes = {
    liste: RECETTES,
    detecter: detecter
  };
})();
