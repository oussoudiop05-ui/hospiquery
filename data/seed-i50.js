/* ============================================================
   data/seed-i50.js — état initial I50 (insuffisance cardiaque)
   Exemple de référence pour 3 tables CORA RECUEIL, 2 jointures,
   2 colonnes calculées. Chargé par store.js si aucun état n'est
   sauvegardé dans localStorage.
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  window.HQ.SEED_I50 = {
    request: 'Séjours 2023-2025 avec diagnostic I50 (insuffisance cardiaque)',
    granularity: '1 ligne = 1 séjour',
    nodes: [
      {
        id: 'n1',
        kind: 'table',
        name: 'TB_DIAG',
        schema: 'dbo',
        conn: 'con2',
        source: 'CORA RECUEIL',
        reliability: 'ok',
        grain: '1 ligne = 1 diagnostic par mouvement',
        multiplier: {
          factor: '×nb_diags ×nb_mvts',
          reason: 'granularité réelle = le mouvement (voir CLAUDE.md §6 et §4.2.1)'
        },
        branchOf: null,
        columns: [
          { name: 'ID_SEJOUR',   type: 'int',     label: 'Lien vers TB_SEJOUR (non principal — principal = ID_MVT)', checked: true,  filter: '',                                                   alias: '', isKey: true,  note: '⚠️ Lien non principal. ⚠️ trimws() si jointure sur NO_SEJOUR' },
          { name: 'ID_PATIENT',  type: 'int',     label: 'Lien non principal vers TB_PATIENT.ID_PATIENT',           checked: true,  filter: '',                                                   alias: '', isKey: false, note: '⚠️ Différent de IPP_PATIENT' },
          { name: 'CODE_DIAG',   type: 'varchar', label: 'Code de la nomenclature CIM',                             checked: true,  filter: "LIKE 'I50%'",                                        alias: '', isKey: false, note: '' },
          { name: 'TYPE_DIAG',   type: 'varchar', label: "P=Principal, R=Relié, S=Associé Significatif, D=Doc",    checked: true,  filter: "IN ('P','R','S')",                                    alias: '', isKey: false, note: '' },
          { name: 'VERSION_CIM', type: 'varchar', label: "9 = récupéré en CIM-9 (codes invalides)",                checked: true,  filter: "RAW:(VERSION_CIM IS NULL OR VERSION_CIM <> '9')",    alias: '', isKey: false, note: '⚠️ Exclure les diagnostics en CIM-9' },
          { name: 'ID_MVT',      type: 'int',     label: 'Lien principal vers TB_MVT (granularité réelle)',        checked: false, filter: '',                                                   alias: '', isKey: true,  note: 'Clé principale de la table' }
        ]
      },
      {
        id: 'n2',
        kind: 'table',
        name: 'TB_SYNTH_RSS',
        schema: 'dbo',
        conn: 'con2',
        source: 'CORA RECUEIL',
        reliability: 'ok',
        grain: '1 ligne = 1 RSS',
        multiplier: null,
        branchOf: null,
        columns: [
          { name: 'ID_SEJOUR',    type: 'int',     label: 'Lien obligatoire vers TB_SEJOUR',               checked: false, filter: '',                               alias: '', isKey: true,  note: 'Clé de jointure' },
          { name: 'NO_SEJOUR',    type: 'varchar', label: "N° de séjour officiel",                        checked: true,  filter: '',                               alias: '', isKey: false, note: '⚠️ trimws() obligatoire avant jointure sur IEP' },
          { name: 'STATUT',       type: 'varchar', label: 'T = terminé et groupé',                        checked: false, filter: "= 'T'",                          alias: '', isKey: false, note: 'Filtre obligatoire — exclure les RSS en cours' },
          { name: 'DATE_DEBUT',   type: 'date',    label: 'Date début du RSS',                            checked: true,  filter: "BETWEEN '20230101' AND '20251231'", alias: '', isKey: false, note: 'Borne de la période en AAAAMMJJ' },
          { name: 'DATE_FIN',     type: 'date',    label: 'Date fin du RSS',                              checked: true,  filter: '',                               alias: '', isKey: false, note: '' },
          { name: 'DUREE_SEJOUR', type: 'int',     label: 'Durée du RSS en jours',                        checked: true,  filter: '',                               alias: '', isKey: false, note: '' },
          { name: 'AGE_ENTREE',   type: 'int',     label: 'Âge à l\'entrée — déjà calculé par le groupeur', checked: true, filter: '',                               alias: '', isKey: false, note: 'Ne pas recalculer par difftime()' },
          { name: 'CODE_CMD',     type: 'varchar', label: 'Catégorie Majeure de Diagnostic',              checked: true,  filter: "NOT IN ('28','90')",              alias: '', isKey: false, note: 'Exclure séances (28) et erreurs de groupage (90)' },
          { name: 'CODE_GHM',     type: 'varchar', label: 'Code GHM (⚠️ NOM correct — description inversée dans dico)', checked: true, filter: '', alias: '', isKey: false, note: '⚠️ CLAUDE.md §11.3 — libellés GHM/GHS inversés dans le dictionnaire' },
          { name: 'DP_RETENU',    type: 'varchar', label: 'Code DP retenu par le groupeur',               checked: true,  filter: '',                               alias: '', isKey: false, note: '' },
          { name: 'MONTANT_GHS',  type: 'decimal', label: 'Valorisation GHS (€)',                         checked: false, filter: '',                               alias: '', isKey: false, note: '' },
          { name: 'MODE_SORTIE',  type: 'varchar', label: 'Mode de sortie (9 = décès)',                   checked: false, filter: '',                               alias: '', isKey: false, note: '' }
        ]
      },
      {
        id: 'n3',
        kind: 'table',
        name: 'TB_PATIENT',
        schema: 'dbo',
        conn: 'con2',
        source: 'CORA RECUEIL',
        reliability: 'ok',
        grain: '1 ligne = 1 patient',
        multiplier: null,
        branchOf: 'n1',
        columns: [
          { name: 'ID_PATIENT',  type: 'int',     label: 'Clé technique patient',                               checked: false, filter: '', alias: '', isKey: true,  note: '⚠️ Différent de IPP_PATIENT — jointure via TB_DIAG.ID_PATIENT' },
          { name: 'IPP_PATIENT', type: 'varchar', label: 'Identifiant Permanent Patient',                       checked: true,  filter: '', alias: '', isKey: false, note: '' },
          { name: 'SEXE',        type: 'varchar', label: 'M/H/1 = masculin · F/2 = féminin',                   checked: true,  filter: '', alias: '', isKey: false, note: '⚠️ Trois codes masculin : M, H, 1 — normaliser en SEXE_N' },
          { name: 'DATE_NAIS',   type: 'date',    label: 'Date de naissance',                                   checked: true,  filter: '', alias: '', isKey: false, note: '' },
          { name: 'DATE_DECES',  type: 'date',    label: 'Date de décès',                                       checked: false, filter: '', alias: '', isKey: false, note: '' },
          { name: 'CODE_POSTAL', type: 'varchar', label: '⚠️ Préférer TB_SEJOUR.CODE_POSTAL (plus à jour)',     checked: false, filter: '', alias: '', isKey: false, note: 'Données géographiques au moment du séjour dans TB_SEJOUR' }
        ]
      }
    ],
    joins: [
      {
        from: 'n1',
        to: 'n2',
        type: 'inner',
        on: [['ID_SEJOUR', 'ID_SEJOUR']],
        note: 'Remonter au RSS pour groupage, durée, GHM. ⚠️ TB_DIAG est par mouvement — agréger avant (voir étape 4).'
      },
      {
        from: 'n1',
        to: 'n3',
        type: 'left',
        on: [['ID_PATIENT', 'ID_PATIENT']],
        note: 'Données démographiques. ID_PATIENT provient de TB_DIAG (lien non principal).'
      }
    ],
    derived: [
      {
        name: 'SEXE_N',
        origin: 'modified',
        expr: "if_else(SEXE %in% c('M', 'H', '1'), 'M', 'F')",
        from: 'n3',
        col: 'SEXE',
        why: "Normaliser les trois codes masculin (M, H, 1) — CLAUDE.md §11.3"
      },
      {
        name: 'AGE_CLASSE',
        origin: 'created',
        expr: "case_when(AGE_ENTREE < 65 ~ '<65', AGE_ENTREE < 75 ~ '65-74', AGE_ENTREE < 85 ~ '75-84', TRUE ~ '≥85')",
        from: 'n2',
        col: 'AGE_ENTREE',
        why: 'Classes d\'âge standard pour analyse cardiologique'
      }
    ],
    finalOrder: [
      'ID_SEJOUR', 'NO_SEJOUR',
      'CODE_DIAG', 'TYPE_DIAG',
      'DATE_DEBUT', 'DATE_FIN', 'DUREE_SEJOUR',
      'AGE_ENTREE', 'AGE_CLASSE',
      'CODE_CMD', 'CODE_GHM', 'DP_RETENU',
      'IPP_PATIENT', 'SEXE_N', 'DATE_NAIS'
    ],
    warnings: [
      { level: 'warn', text: 'TB_DIAG est par mouvement (×nb_diags ×nb_mvts) — distinct(ID_SEJOUR, ID_PATIENT, CODE_DIAG, TYPE_DIAG) obligatoire avant la jointure au RSS' },
      { level: 'warn', text: 'SEXE a trois valeurs masculin (M, H, 1) — utiliser SEXE_N normalisé dans toutes les analyses' },
      { level: 'info', text: 'AGE_ENTREE est déjà calculé dans TB_SYNTH_RSS (règle PMSI) — ne pas recalculer par difftime()' }
    ]
  };
})();
