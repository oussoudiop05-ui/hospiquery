/* ============================================================
   joingraph.js — graphe de jointures déterministe + Dijkstra.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.joingraph = { construire, chemin, relier, chercherRegistre, REGISTRE }
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  /* Poids par niveau de preuve (CLAUDE.md §0.2) */
  var POIDS = { ok: 1, dict: 3, suppose: 10 };

  /* ----------------------------------------------------------------
     REGISTRE — 12 jointures validées en production (CLAUDE.md §12.3)
     Source unique de vérité : un script qui tourne donne le ✅
  ---------------------------------------------------------------- */
  var REGISTRE = [
    { de:'TB_SEJOUR',    vers:'TB_DIAG',          cleDe:'ID_SEJOUR',         cleVers:'ID_SEJOUR',    preuve:'ok' },
    { de:'TB_SEJOUR',    vers:'TB_SYNTH_RSS',      cleDe:'ID_SEJOUR',         cleVers:'ID_SEJOUR',    preuve:'ok' },
    { de:'TB_SYNTH_RSS', vers:'TB_SYNTH_RUM',      cleDe:'ID_RSS',            cleVers:'ID_RSS',       preuve:'ok' },
    { de:'TB_SYNTH_RUM', vers:'TB_UNITE',          cleDe:'ID_UNITE_RESP_MED', cleVers:'ID_UNITE',     preuve:'ok' },
    { de:'TB_SYNTH_RSS', vers:'TB_UNITE_MEDICALE', cleDe:'ID_UM_RETENU',      cleVers:'ID_UNITE_MED', preuve:'ok' },
    { de:'TB_SEJOUR',    vers:'TB_PATIENT',        cleDe:'ID_PATIENT',        cleVers:'ID_PATIENT',   preuve:'ok' },
    { de:'TMVENUE_PL',   vers:'TB_SEJOUR',         cleDe:'IEP',               cleVers:'NO_SEJOUR',    preuve:'ok', note:'trimws() obligatoire sur NO_SEJOUR' },
    { de:'TB_ACTE',      vers:'TB_SYNTH_RSS',      cleDe:'ID_SEJOUR',         cleVers:'ID_SEJOUR',    preuve:'ok' },
    { de:'TB_ACTE',      vers:'TB_UNITE',          cleDe:'ID_UNITE_EXEC',     cleVers:'ID_UNITE',     preuve:'ok' },
    { de:'TB_ACTE',      vers:'TB_PATIENT',        cleDe:'ID_PATIENT',        cleVers:'ID_PATIENT',   preuve:'ok' },
    { de:'TB_MVT',       vers:'TB_DIAG',           cleDe:'ID_MVT',            cleVers:'ID_MVT',       preuve:'ok', note:'lien PRINCIPAL de TB_DIAG' },
    { de:'TB_MVT',       vers:'TB_SYNTH_RSS',      cleDe:'ID_RSS',            cleVers:'ID_RSS',       preuve:'ok' }
  ];

  /* Graphe non-orienté : table → [ { voisin, poids, registre } ] */
  var _graphe = null;
  var _version = 0;

  function ajouterArete(g, a, b, poids, reg) {
    if (!g[a]) g[a] = [];
    if (!g[b]) g[b] = [];
    g[a].push({ voisin: b, poids: poids, registre: reg });
    g[b].push({
      voisin: a,
      poids: poids,
      registre: {
        de: reg.vers,
        vers: reg.de,
        cleDe: reg.cleVers,
        cleVers: reg.cleDe,
        preuve: reg.preuve,
        note: reg.note || ''
      }
    });
  }

  function memeCle(a, b) {
    return String(a || '').toUpperCase() === String(b || '').toUpperCase();
  }

  /* Construit le graphe depuis REGISTRE, étendu par le dictionnaire si chargé */
  function construire() {
    var g = {};

    REGISTRE.forEach(function (r) {
      ajouterArete(g, r.de.toUpperCase(), r.vers.toUpperCase(), POIDS[r.preuve] || 1, r);
    });

    if (HQ.dictionary && HQ.dictionary.isLoaded()) {
      HQ.dictionary.chaqueTable(function (tbl) {
        var nom = (tbl.name || '').toUpperCase();
        var liens = HQ.dictionary.getLinks(tbl.name);
        liens.forEach(function (l) {
          if (!l.targetTable) return;
          var cible = l.targetTable.toUpperCase();
          var cibleChamp = l.targetField || l.fieldName;
          var deja = g[nom] && g[nom].some(function (a) {
            return a.voisin === cible &&
              memeCle(a.registre.cleDe, l.fieldName) &&
              memeCle(a.registre.cleVers, cibleChamp);
          });
          if (!deja) {
            var reg = {
              de: nom,
              vers: cible,
              cleDe: l.fieldName,
              cleVers: cibleChamp,
              preuve: 'dict',
              note: 'Lien documenté dans le dictionnaire.'
            };
            ajouterArete(g, nom, cible, POIDS.dict, reg);
          }
        });
      });
    }

    _graphe = g;
    _version++;
    return g;
  }

  /* ----------------------------------------------------------------
     Dijkstra
     Retourne un tableau de sauts :
       [ { de, vers, cleDe, cleVers, preuve, note }, … ]
     Retourne [] si aucun chemin trouvé.
     chemin('TB_DIAG','TB_PATIENT').length === 2  ← test de validation Lot 5
  ---------------------------------------------------------------- */
  function chemin(depart, arrivee, sautsMax) {
    var A = (depart  || '').toUpperCase();
    var B = (arrivee || '').toUpperCase();
    if (A === B) return [];
    var max = sautsMax || 6;
    var g = _graphe || construire();

    var file   = [{ noeud: A, dist: 0, sauts: 0, chemin: [] }];
    var visite = {};

    while (file.length) {
      file.sort(function (x, y) { return x.dist - y.dist || x.sauts - y.sauts; });
      var courant = file.shift();
      if (visite[courant.noeud]) continue;
      visite[courant.noeud] = true;

      if (courant.noeud === B) return courant.chemin;
      if (courant.sauts >= max) continue;

      (g[courant.noeud] || []).forEach(function (a) {
        if (visite[a.voisin]) return;
        file.push({
          noeud:  a.voisin,
          dist:   courant.dist + a.poids,
          sauts:  courant.sauts + 1,
          chemin: courant.chemin.concat([{
            de:      courant.noeud,
            vers:    a.voisin,
            cleDe:   a.registre.cleDe,
            cleVers: a.registre.cleVers,
            preuve:  a.registre.preuve,
            note:    a.registre.note || null
          }])
        });
      });
    }

    return [];
  }

  /* Niveau de preuve d'une clé directe, dans le sens demandé. */
  function preuveLien(depart, arrivee, champDe, champVers) {
    var A = (depart || '').toUpperCase();
    var B = (arrivee || '').toUpperCase();
    if (!A || !B || !champDe || !champVers) return null;
    var g = _graphe || construire();
    var aretes = g[A] || [];

    for (var i = 0; i < aretes.length; i++) {
      var a = aretes[i], r = a.registre;
      if (a.voisin === B &&
          memeCle(r.cleDe, champDe) &&
          memeCle(r.cleVers, champVers)) {
        return {
          preuve: r.preuve,
          note: r.note || (r.preuve === 'ok'
            ? 'Jointure validée en production.'
            : 'Lien documenté dans le dictionnaire.')
        };
      }
    }
    return null;
  }

  /* Arbre couvrant approximatif pour relier N tables (Prim greedy) */
  function relier(tables) {
    if (!tables || tables.length < 2) return [];
    var restant = tables.map(function (t) { return t.toUpperCase(); });
    var places  = [restant.shift()];
    var aretes  = [];

    while (restant.length) {
      var meilleurDist = Infinity, source = null, cible = null, meilleurChemin = null;

      places.forEach(function (p) {
        restant.forEach(function (r) {
          var c = chemin(p, r, 4);
          if (!c.length) return;
          var dist = c.reduce(function (s, e) { return s + (POIDS[e.preuve] || 1); }, 0);
          if (dist < meilleurDist) { meilleurDist = dist; source = p; cible = r; meilleurChemin = c; }
        });
      });

      if (!cible) break;
      aretes.push({ source: source, cible: cible, hops: meilleurChemin });
      places.push(cible);
      restant.splice(restant.indexOf(cible), 1);
    }

    return aretes;
  }

  /* Cherche dans REGISTRE l'entrée correspondant à deux noms de table */
  function chercherRegistre(tableA, tableB) {
    var A = (tableA || '').toUpperCase();
    var B = (tableB || '').toUpperCase();
    for (var i = 0; i < REGISTRE.length; i++) {
      var r = REGISTRE[i];
      if ((r.de === A && r.vers === B) || (r.de === B && r.vers === A)) return r;
    }
    return null;
  }

  function getVersion() { return _version; }

  HQ.joingraph = {
    construire:       construire,
    chemin:           chemin,
    relier:           relier,
    chercherRegistre: chercherRegistre,
    preuveLien:       preuveLien,
    getVersion:       getVersion,
    REGISTRE:         REGISTRE
  };
})();
