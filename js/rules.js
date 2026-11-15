/* ============================================================
   rules.js — règles métier PMSI appliquées localement.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.rules
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var MULTIPLICATEURS = {
    TB_DIAG: { facteur: '×nb_diags ×nb_mvts', raison: 'Granularité = le mouvement (lien principal ID_MVT)' },
    TACCAM: { facteur: '×nb_actes', raison: 'Plusieurs actes CCAM par séjour' },
    TACCAM_MODIFICATEUR: { facteur: '×nb_modificateurs', raison: 'Joindre via CCA_ID, jamais sur le séjour' },
    TB_SYNTH_RUM: { facteur: '×nb_RUM', raison: 'Plusieurs RUM par RSS en multi-UM' },
    TMCOUVERTURE_PL: { facteur: '×2 ou plus', raison: 'Sécu + Mutuelle' },
    TMMOUVEMENT_PL: { facteur: '×nb_mouvements', raison: 'Plusieurs UF par venue' },
    PMSI_LIB_GHS_TARIF: { facteur: '×nb_versions', raison: 'Historique tarifaire — filtrer GET_LIBELLE=\'O\'' },
    CIM_HIERARCHIE: { facteur: '×nb_versions', raison: 'Filtrer ACTIF=\'O\'' },
    TB_ACTE: { facteur: '×nb_actes', raison: 'Plusieurs actes par séjour' },
    TAINTERVENTION: { facteur: '×nb_interventions', raison: 'Plusieurs interventions par séjour' }
  };

  var FILTRES_OBLIGATOIRES = {
    TB_SYNTH_RSS: [{ colonne: 'STATUT', filtre: "= 'T'" }],
    TMVENUE_PL: [{ colonne: 'ETAT_DOSS', filtre: "= 'A'" }],
    TMPATIENT_PL: [{ colonne: 'STATUT_IPP', filtre: "= '3'" }],
    PMSI_LIB_GHS_TARIF: [{ colonne: 'GET_LIBELLE', filtre: "= 'O'" }],
    CIM_HIERARCHIE: [{ colonne: 'ACTIF', filtre: "= 'O'" }]
  };
  var TRIMWS_REQUIS = ['NO_SEJOUR', 'IEP'];

  function multiplicateur(nom) {
    var regle = MULTIPLICATEURS[String(nom || '').toUpperCase()];
    return regle ? { factor: regle.facteur, reason: regle.raison } : null;
  }

  function appliquerFiltresObligatoires(noeuds) {
    noeuds.forEach(function (node) {
      (FILTRES_OBLIGATOIRES[node.name] || []).forEach(function (regle) {
        var column = node.columns.filter(function (c) {
          return c.name.toUpperCase() === regle.colonne;
        })[0];
        if (!column) {
          column = {
            name: regle.colonne,
            type: 'varchar',
            label: 'Filtre obligatoire',
            checked: true,
            filter: '',
            alias: '',
            isKey: false,
            note: 'Injecté automatiquement'
          };
          node.columns.push(column);
        }
        column.filter = regle.filtre;
        column.checked = true;
      });
    });
  }

  function avertissements(noeuds, joins, grain) {
    var result = [];
    noeuds.forEach(function (node) {
      var multiplierIsRequestedGrain =
        grain === 'acte' && node.name === 'TB_ACTE' ||
        grain === 'diagnostic' && node.name === 'TB_DIAG' ||
        grain === 'rum' && node.name === 'TB_SYNTH_RUM';
      var existenceOnly = (joins || []).some(function (join) {
        return join.to === node.id && join.type === 'semi';
      }) && !(joins || []).some(function (join) {
        return join.to === node.id && join.type !== 'semi';
      });
      if (node.multiplier && !existenceOnly && !multiplierIsRequestedGrain) {
        result.push({
          level: 'warn',
          text: node.name + ' multiplie les lignes (' + node.multiplier.factor + ') — '
            + node.multiplier.reason + '. Agréger AVANT de joindre.'
        });
      }
    });
    joins.forEach(function (join) {
      (join.on || []).forEach(function (pair) {
        if (TRIMWS_REQUIS.indexOf(String(pair[0]).toUpperCase()) >= 0 ||
            TRIMWS_REQUIS.indexOf(String(pair[1]).toUpperCase()) >= 0) {
          result.push({
            level: 'warn',
            text: 'trimws() obligatoire sur ' + pair.join(' = ')
              + ' — sans quoi la jointure peut renvoyer 0 ligne sans erreur.'
          });
        }
      });
    });
    return result;
  }

  HQ.rules = {
    MULTIPLICATEURS: MULTIPLICATEURS,
    FILTRES_OBLIGATOIRES: FILTRES_OBLIGATOIRES,
    TRIMWS_REQUIS: TRIMWS_REQUIS,
    multiplicateur: multiplicateur,
    appliquerFiltresObligatoires: appliquerFiltresObligatoires,
    avertissements: avertissements
  };
})();
