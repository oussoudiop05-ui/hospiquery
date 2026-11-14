/* ============================================================
   noyau-pmsi.js — noyau distillé du CLAUDE.md pour l'API.
   ~3 500 tokens au lieu de 30 269 (−88 %).
   Expose HQ.NOYAU_PMSI
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  HQ.NOYAU_PMSI = [
    '# CONTEXTE PMSI — APHM / base HospiTrack',
    '',
    '## Hiérarchie MCO',
    'PATIENT (IPP) → SÉJOUR (IEP / NO_SEJOUR) → RSS → RUM → MOUVEMENTS → ACTES / DIAGNOSTICS',
    '',
    '## Sources et connexions',
    'con1 = Décisionnel, schéma `Q.`  |  con2 = CORA RECUEIL, schéma `dbo.`  |  axi = SPIM/DPI',
    'Règle : préférer CORA (dbo) quand la table existe des deux côtés.',
    '',
    '## Multiplicateurs de lignes — à signaler systématiquement',
    'TB_DIAG        ×nb_diags ×nb_mvts  (granularité = LE MOUVEMENT, lien principal ID_MVT)',
    'TACCAM         ×nb_actes',
    'TB_SYNTH_RUM   ×nb_RUM par RSS',
    'TMCOUVERTURE_PL ×2 (Sécu + Mutuelle)',
    'PMSI_LIB_GHS_TARIF ×nb_versions → filtrer GET_LIBELLE = \'O\'',
    'CIM_HIERARCHIE ×nb_versions → filtrer ACTIF = \'O\'',
    '*_ATB_SYNTHESE_* ×nb_germes',
    '',
    '## Filtres obligatoires',
    'TB_SYNTH_RSS  : STATUT = \'T\'',
    'TMVENUE_PL    : ETAT_DOSS = \'A\' ; TYP_PASS = \'2\' pour les hospitalisations',
    'TMPATIENT_PL  : STATUT_IPP = \'3\' (exclut les IPP fantômes)',
    'MCO standard  : exclure CODE_CMD 28 (séances) et 90 (erreurs de groupage)',
    '',
    '## Pièges confirmés',
    'NO_SEJOUR porte des espaces en fin → trimws() OBLIGATOIRE avant tout join sur IEP.',
    'Format date SQL Server : \'AAAAMMJJ\' et non \'AAAA-MM-JJ\'.',
    'SEXE vaut M/H/1 pour masculin, F/2 pour féminin → normaliser.',
    'TB_DIAG.VERSION_CIM = \'9\' → diagnostics CIM-9, à exclure d\'une regex CIM-10.',
    'TB_SYNTH_RSS : les DESCRIPTIONS de CODE_GHM et CODE_GHS sont inversées au dictionnaire.',
    '              Se fier au NOM du champ.',
    'CODE_POSTAL  : utiliser TB_SEJOUR, pas TB_PATIENT (obsolète).',
    'AGE_ENTREE   : déjà calculé dans TB_SYNTH_RSS, ne pas le recalculer.',
    'Biologie     : bascule Nexlabs(_LA) → GLIMS(_LM) en JUIN 2025. Période à cheval = UNION.',
    '',
    '## Jointures validées en production (✅)',
    'TB_SEJOUR.ID_SEJOUR      = TB_DIAG.ID_SEJOUR',
    'TB_SEJOUR.ID_SEJOUR      = TB_SYNTH_RSS.ID_SEJOUR',
    'TB_SYNTH_RSS.ID_RSS      = TB_SYNTH_RUM.ID_RSS',
    'TB_SYNTH_RUM.ID_UNITE_RESP_MED = TB_UNITE.ID_UNITE',
    'TB_SYNTH_RSS.ID_UM_RETENU = TB_UNITE_MEDICALE.ID_UNITE_MED',
    'CONCAT(TB_SYNTH_RSS.CODE_CMD, CODE_GHM) = PMSI_LIB_GHS_TARIF.GHS',
    'TMVENUE_PL.IEP           = TB_SEJOUR.NO_SEJOUR   ⚠️ trimws()',
    'TB_ACTE.ID_SEJOUR        = TB_SYNTH_RSS.ID_SEJOUR',
    'TB_ACTE.ID_UNITE_EXEC    = TB_UNITE.ID_UNITE',
    'TB_ACTE.ID_PATIENT       = TB_PATIENT.ID_PATIENT  ⚠️ ID_PATIENT ≠ IPP_PATIENT'
  ].join('\n');
})();
