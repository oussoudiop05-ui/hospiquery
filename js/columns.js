/* ============================================================
   columns.js — sélection des colonnes depuis le dictionnaire.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.columns
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var MAX_COLUMNS = 6;

  function isKey(name) {
    return /^(ID_|IEP$|IPP|NO_|NUM_|CODE_)/i.test(name || '');
  }

  function isSensitive(name) {
    return /(^|_)(ID_PATIENT|ID_PERSONNE|NO_SEJOUR|IEP|IPP|NIR|NOM|PRENOM|NOM_NAISSANCE|ADRESSE|CODE_POSTAL|TELEPHONE|EMAIL|DATE_NAIS|DATE_NAISSANCE)(_|$)/i.test(name || '');
  }

  function explicitlyRequestedSensitiveField(name, request) {
    var field = String(name || '').toUpperCase();
    var text = String(request || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/^(IPP|NIR|IEP|ID_PATIENT|ID_PERSONNE)/.test(field)) {
      return /\b(ipp|nir|iep|id patient|identifiant patient|numero de sejour)\b/.test(text);
    }
    if (/(^|_)(NOM|PRENOM|NOM_NAISSANCE)(_|$)/.test(field)) {
      return /\b(nom|prenom|identite)\b/.test(text);
    }
    if (/ADRESSE|CODE_POSTAL/.test(field)) return /\b(adresse|code postal)\b/.test(text);
    if (/TELEPHONE|MOBILE/.test(field)) return /\b(telephone|mobile)\b/.test(text);
    if (/EMAIL|COURRIEL/.test(field)) return /\b(email|courriel)\b/.test(text);
    if (/DATE_NAIS/.test(field)) return /\b(date de naissance|naissance)\b/.test(text);
    if (/^NO_SEJOUR$/.test(field)) return /\b(iep|numero de sejour)\b/.test(text);
    return false;
  }

  function choisir(nom, sortieOutil, cadrage, requete, champsRequis) {
    var table = HQ.dictionary && HQ.dictionary.getTable(nom);
    if (!table) return [];

    var fields = table.fields || [];
    var required = {};
    (champsRequis || []).forEach(function (name) {
      required[String(name).toUpperCase()] = true;
    });
    var outputFields = sortieOutil.colonnes_sortie && sortieOutil.colonnes_sortie[nom];
    (outputFields || []).forEach(function (name) {
      required[String(name).toUpperCase()] = true;
    });
    (sortieOutil.filtres || []).forEach(function (filter) {
      if ((filter.table || '').toUpperCase() === nom.toUpperCase()) {
        required[(filter.colonne || '').toUpperCase()] = true;
      }
    });

    var ranked = HQ.retrieval && HQ.retrieval.champsPertinents
      ? HQ.retrieval.champsPertinents(table, requete || '', MAX_COLUMNS)
      : fields.slice(0, MAX_COLUMNS);
    var selected = {};
    ranked.forEach(function (field) { selected[field.name.toUpperCase()] = true; });
    Object.keys(required).forEach(function (name) { selected[name] = true; });

    return fields.filter(function (field) {
      var fieldName = (field.name || '').toUpperCase();
      return !!selected[fieldName] &&
        (!isSensitive(fieldName) || explicitlyRequestedSensitiveField(fieldName, requete) || !!required[fieldName]);
    }).map(function (field) {
      return {
        name: field.name,
        type: field.type || field.dataType || 'varchar',
        label: field.description || field.label || '',
        checked: true,
        filter: '',
        alias: '',
        isKey: isKey(field.name),
        note: ''
      };
    });
  }

  HQ.columns = { choisir: choisir };
})();
