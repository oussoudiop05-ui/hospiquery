/* ============================================================
   dictionary.js — chargement et indexation du JSON HospiTrack.
   AUCUN accès au DOM dans ce fichier.
   Expose HQ.dictionary
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var _index  = null;  // { tablesByName, linksByTable, linkCount, total }
  var _report = null;  // rapport du dernier load()

  /* ---- construction de l'index ----------------------------- */
  function buildIndex(data) {
    var tablesByName = {};
    var linksByTable = {};
    var linkCount    = 0;
    var tables       = data.tables || [];

    tables.forEach(function (tbl) {
      var uName = (tbl.name || '').toUpperCase();
      tablesByName[uName] = tbl;

      var links = [];

      (tbl.fields || []).forEach(function (field) {
        var desc = field.description || '';

        /* "Lien sur TABLE" / "Lien sur TABLE.CHAMP"
           "Lien avec TABLE" / "Lien avec TABLE.CHAMP"           */
        var re1 = /Lien\s+(?:sur|avec)\s+([\w]+)(?:\.([\w]+))?/gi;
        var m;
        while ((m = re1.exec(desc)) !== null) {
          links.push({
            fieldName:   field.name,
            targetTable: m[1].toUpperCase(),
            targetField: m[2] || null,
            type:        'principal'
          });
          linkCount++;
        }

        /* "Lien non principal (Lien principal = CHAMP)"          */
        var re2 = /Lien\s+non\s+principal\s*\(Lien\s+principal\s*=\s*([^)]+)\)/gi;
        while ((m = re2.exec(desc)) !== null) {
          links.push({
            fieldName: field.name,
            mainField: m[1].trim(),
            type:      'non-principal'
          });
          linkCount++;
        }

        /* "Lien obligatoire" seul (sans cible explicite)         */
        if (/Lien\s+obligatoire/i.test(desc) && !/Lien\s+(?:sur|avec)/i.test(desc)) {
          links.push({ fieldName: field.name, type: 'obligatoire' });
          linkCount++;
        }
      });

      if (links.length > 0) {
        linksByTable[uName] = links;
      }
    });

    return {
      tablesByName: tablesByName,
      linksByTable: linksByTable,
      linkCount:    linkCount,
      total:        tables.length
    };
  }

  /* ---- API publique ---------------------------------------- */

  /* load(data) — reçoit le JSON parsé, retourne le rapport */
  function load(data) {
    _index = buildIndex(data);

    /* rapport : comparer avec les nœuds du schéma courant */
    var schemaNames = [];
    if (window.HQ && HQ.store) {
      schemaNames = HQ.store.getState().nodes.map(function (n) {
        return (n.name || '').toUpperCase();
      });
    }

    var confirmed    = [];
    var stillSupposed = [];
    schemaNames.forEach(function (name) {
      if (_index.tablesByName[name]) {
        confirmed.push(name);
      } else {
        stillSupposed.push(name);
      }
    });

    _report = {
      total:        _index.total,
      linkCount:    _index.linkCount,
      confirmed:    confirmed,
      stillSupposed: stillSupposed
    };

    return _report;
  }

  function getTable(name) {
    if (!_index) return null;
    return _index.tablesByName[(name || '').toUpperCase()] || null;
  }

  function getField(tableName, fieldName) {
    var tbl = getTable(tableName);
    if (!tbl) return null;
    var fn  = (fieldName || '').toUpperCase();
    var hit = null;
    (tbl.fields || []).forEach(function (f) {
      if ((f.name || '').toUpperCase() === fn) hit = f;
    });
    return hit;
  }

  function getLinks(tableName) {
    if (!_index) return [];
    return _index.linksByTable[(tableName || '').toUpperCase()] || [];
  }

  function searchTables(query) {
    if (!_index || !query) return [];
    var q       = (query || '').toUpperCase();
    var results = [];
    var names   = Object.keys(_index.tablesByName);
    for (var i = 0; i < names.length && results.length < 20; i++) {
      var t = _index.tablesByName[names[i]];
      if (names[i].indexOf(q) >= 0 || (t.description || '').toUpperCase().indexOf(q) >= 0) {
        results.push(t);
      }
    }
    return results;
  }

  function isLoaded()       { return _index !== null; }
  function getStats()       { return _index ? { total: _index.total, linkCount: _index.linkCount } : null; }
  function getReport()      { return _report; }
  function getReliability(tableName) {
    if (!_index) return null;
    return _index.tablesByName[(tableName || '').toUpperCase()] ? 'dict' : null;
  }

  HQ.dictionary = {
    load:           load,
    getTable:       getTable,
    getField:       getField,
    getLinks:       getLinks,
    searchTables:   searchTables,
    isLoaded:       isLoaded,
    getStats:       getStats,
    getReport:      getReport,
    getReliability: getReliability
  };
})();
