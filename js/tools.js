/* ============================================================
   tools.js — schéma des sorties structurées du plan.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.tools
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var OUTIL_PLAN = {
    name: 'proposer_extraction',
    description: 'Propose les tables, filtres et codes pour une extraction PMSI.',
    input_schema: {
      type: 'object',
      properties: {
        granularite: {
          type: 'string',
          enum: ['sejour', 'rss', 'rum', 'diagnostic', 'acte', 'patient'],
          description: 'Ce que représente une ligne du résultat final'
        },
        tables: {
          type: 'array',
          description: 'Tables retenues, la première étant la table de départ',
          items: {
            type: 'object',
            properties: {
              nom: { type: 'string', description: 'Nom exact, ex. TB_SYNTH_RSS' },
              role: { type: 'string', enum: ['depart', 'enrichissement', 'filtre'] },
              pourquoi: { type: 'string', description: 'Une phrase de justification' }
            },
            required: ['nom', 'role']
          }
        },
        filtres: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              table: { type: 'string' },
              colonne: { type: 'string' },
              operateur: {
                type: 'string',
                enum: ['=', 'IN', 'LIKE', 'BETWEEN', '>=', '<=', 'IS NOT NULL']
              },
              valeur: { type: 'string' }
            },
            required: ['table', 'colonne', 'operateur', 'valeur']
          }
        },
        codes_metier: {
          type: 'array',
          description: 'Codes CIM-10, CCAM, GHM pertinents pour la demande',
          items: {
            type: 'object',
            properties: {
              nomenclature: { type: 'string', enum: ['CIM10', 'CCAM', 'GHM', 'CMD'] },
              motif: { type: 'string', description: 'Regex ou liste, ex. ^I50 ou LIKE C%' },
              libelle: { type: 'string' }
            },
            required: ['nomenclature', 'motif', 'libelle']
          }
        },
        incertitudes: {
          type: 'array',
          description: 'Points à confirmer avec l’utilisateur avant exécution',
          items: { type: 'string' }
        }
      },
      required: ['granularite', 'tables']
    }
  };

  HQ.tools = {
    OUTIL_PLAN: OUTIL_PLAN,
    nomPlan: OUTIL_PLAN.name
  };
})();
