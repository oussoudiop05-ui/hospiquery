/* ============================================================
   retrieval.js — index inversé + classement BM25 sur le dictionnaire.
   AUCUN accès au DOM, AUCUN appel réseau.
   Expose HQ.retrieval
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var K1 = 1.5, B = 0.75;          /* paramètres BM25 standard */
  var _index          = null;       /* terme → [{ table, tf }] */
  var _longueurs      = {};         /* table → nb de termes */
  var _longueurMoyenne = 0;
  var _nbDocs         = 0;

  /* ---- mots vides français --------------------------------- */
  var MOTS_VIDES = {
    'avec':1,'pour':1,'dans':1,'entre':1,'les':1,'des':1,'une':1,'sur':1,
    'par':1,'aux':1,'que':1,'qui':1,'est':1,'sont':1,'tous':1,'toutes':1,
    'veux':1,'voudrais':1,'faire':1,'avoir':1,'cette':1,'leur':1
  };

  /* ---- synonymes métier PMSI — comble l'écart vocabulaire DIM / noms tables */
  var SYNONYMES = {
    'chirurgie':    ['INTERVENTION','CCAM','ACTE','OPERATOIRE'],
    'chirurgical':  ['INTERVENTION','CCAM','ACTE','OPERATOIRE'],
    'operation':    ['INTERVENTION','ACTE','OPERATOIRE'],
    'diagnostic':   ['DIAG','CIM','DP','DAS'],
    'germe':        ['INFECTIEUX','ATB','MICROBIO','BACTERIO'],
    'bacterie':     ['INFECTIEUX','ATB','GERME'],
    'antibiotique': ['ATB','INFECTIEUX'],
    'sejour':       ['SEJOUR','RSS','VENUE'],
    'unite':        ['UF','MOUVEMENT','UNITE'],
    'patient':      ['PATIENT','IPP'],
    'mouvement':    ['MVT','MOUVEMENT','UF'],
    'uf':           ['UNITE','UF'],
    'service':      ['UNITE','UM','UF'],
    'pole':         ['PO','POLE'],
    'urgence':      ['URG','PASSAGE_UR'],
    'valorisation': ['SYNTH_RSS','GHS','MONTANT','TARIF'],
    'tarif':        ['GHS','TARIF','MONTANT'],
    'duree':        ['DUREE','DMS'],
    'bloc':         ['BLOCS','INTERVENTION','SALLE'],
    'biologie':     ['POLEBIO','LABO','ANALYSE'],
    'laboratoire':  ['LABO','POLEBIO','RESULTAT'],
    'couverture':   ['COUVERTURE','SECU','MUTUELLE'],
    'precarite':    ['COUVERTURE','AME','CMU'],
    'deces':        ['DECES','MODE_SORTIE'],
    'naissance':    ['NAIS','POIDS','PERINAT'],
    'accouchement': ['ACCOUCHEMENT','OBSTETRIQUE','IVG']
  };

  /* ---- tokeniseur : minuscules, sans accents, sans mots vides + synonymes */
  function tokeniser(texte) {
    var bruts = (texte || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') /* retire les accents */
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(function (m) { return (m.length > 2 || m === 'uf') && !MOTS_VIDES[m]; });

    var sortie = [];
    bruts.forEach(function (original) {
      var m = /^(actes|sejours|interventions|diagnostics|patients|unites|services|mouvements)$/.test(original)
        ? original.slice(0, -1) : original;
      if (/^chirurgicales?$/.test(m)) m = 'chirurgical';
      sortie.push(m.toUpperCase());
      (SYNONYMES[m] || []).forEach(function (s) { sortie.push(s); });
    });
    return sortie;
  }

  function ajusterScoreMetier(requete, nom, score) {
    var tokens = tokeniser(requete);
    var acte = tokens.indexOf('ACTE') >= 0 || tokens.indexOf('CCAM') >= 0 ||
      tokens.indexOf('INTERVENTION') >= 0 || tokens.indexOf('CHIRURGIE') >= 0;
    var sejour = tokens.indexOf('SEJOUR') >= 0;
    var diagnostic = tokens.indexOf('DIAGNOSTIC') >= 0 ||
      tokens.indexOf('CIM') >= 0 || tokens.indexOf('CODE_DIAG') >= 0;
    var duree = tokens.indexOf('DUREE') >= 0 || tokens.indexOf('DMS') >= 0;
    var unite = tokens.indexOf('UF') >= 0 || tokens.indexOf('UNITE') >= 0;
    var administratif = tokens.indexOf('FACTURATION') >= 0 ||
      tokens.indexOf('CREANCE') >= 0 || tokens.indexOf('PAIEMENT') >= 0;

    if (acte && nom === 'TB_ACTE') score += 12;
    if (acte && nom === 'TB_INTERVENTION') score += 8;
    if (sejour && nom === 'TB_SEJOUR') score += 12;
    if (acte && sejour && nom === 'TB_SYNTH_RSS') score += 10;
    if (diagnostic && nom === 'TB_DIAG') score += 14;
    if (diagnostic && sejour && nom === 'TB_SEJOUR') score += 8;
    if (duree && nom === 'TB_SYNTH_RSS') score += 32;
    if (duree && nom === 'TB_SEJOUR') score += 4;
    if (unite && /^(TB_MVT|TMMOUVEMENT_PL)$/.test(nom)) score += 14;
    if (!administratif && /CREANCE|FACTUR|PAIEMENT/.test(nom)) score *= 0.35;
    if (acte && /TYPE_INTERVENTION|LOG_DEPL|BLOC/.test(nom)) score *= 0.6;
    return score;
  }

  function domaineCompatible(requete, nom) {
    var tokens = tokeniser(requete);
    var acte = tokens.indexOf('ACTE') >= 0 || tokens.indexOf('CCAM') >= 0 ||
      tokens.indexOf('INTERVENTION') >= 0 || tokens.indexOf('CHIRURGIE') >= 0;
    var sejour = tokens.indexOf('SEJOUR') >= 0;
    var diagnostic = tokens.indexOf('DIAGNOSTIC') >= 0 ||
      tokens.indexOf('CIM') >= 0 || tokens.indexOf('CODE_DIAG') >= 0;
    var duree = tokens.indexOf('DUREE') >= 0 || tokens.indexOf('DMS') >= 0;
    var unite = tokens.indexOf('UF') >= 0 || tokens.indexOf('UNITE') >= 0;
    if (acte && sejour && diagnostic) return /^(TB_SEJOUR|TB_DIAG|TB_SYNTH_RSS|TB_MVT)$/.test(nom);
    if (acte && sejour && duree) return /^(TB_SEJOUR|TB_SYNTH_RSS|TB_SYNTH_RUM|TB_MVT)$/.test(nom) || /DMS|DUREE|GHM/.test(nom);
    if (acte && sejour && unite) return /^(TB_SEJOUR|TB_MVT|TMMOUVEMENT_PL)$/.test(nom);
    if (acte && sejour) return /^(TB_SEJOUR|TB_ACTE|TB_INTERVENTION|TB_SYNTH_RSS|TB_SYNTH_RUM|TB_MVT)$/.test(nom);
    if (diagnostic && sejour) return /^(TB_SEJOUR|TB_DIAG|TB_SYNTH_RSS|TB_MVT)$/.test(nom);
    if (duree) return /^(TB_SEJOUR|TB_SYNTH_RSS|TB_SYNTH_RUM|TB_MVT)$/.test(nom) || /DMS|DUREE|GHM/.test(nom);
    if (unite && sejour) return /^(TB_SEJOUR|TB_MVT|TMMOUVEMENT_PL|TB_UNITE|TB_UNITE_MEDICALE)$/.test(nom);
    return true;
  }

  /* ---- construction de l'index inversé --------------------- */
  function construireIndex() {
    if (!HQ.dictionary || !HQ.dictionary.isLoaded()) return false;

    _index     = {};
    _longueurs = {};
    var total  = 0;
    _nbDocs    = 0;

    HQ.dictionary.chaqueTable(function (tbl) {
      var nom = (tbl.name || '').toUpperCase();

      /* le nom de la table pèse 3×, la description 2×, les champs 1× */
      var termes = []
        .concat(tokeniser(nom), tokeniser(nom), tokeniser(nom))
        .concat(tokeniser(tbl.description || ''), tokeniser(tbl.description || ''));

      (tbl.fields || []).forEach(function (f) {
        termes = termes.concat(
          tokeniser(f.name),
          tokeniser((f.description || '').slice(0, 120))
        );
      });

      _longueurs[nom] = termes.length;
      total += termes.length;
      _nbDocs++;

      var freq = {};
      termes.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });

      Object.keys(freq).forEach(function (t) {
        (_index[t] = _index[t] || []).push({ table: nom, tf: freq[t] });
      });
    });

    _longueurMoyenne = total / Math.max(1, _nbDocs);
    return true;
  }

  /* ---- recherche BM25 -------------------------------------- */
  function chercher(requete, k) {
    if (!_index) return [];
    k = k || 5;

    var termes = tokeniser(requete);
    var scores = {};

    termes.forEach(function (terme) {
      var postings = _index[terme];
      if (!postings) return;

      var df  = postings.length;
      var idf = Math.log(1 + (_nbDocs - df + 0.5) / (df + 0.5));

      postings.forEach(function (p) {
        var norm        = 1 - B + B * (_longueurs[p.table] / _longueurMoyenne);
        var contrib     = idf * (p.tf * (K1 + 1)) / (p.tf + K1 * norm);
        scores[p.table] = (scores[p.table] || 0) + contrib;
      });
    });

    return Object.keys(scores)
      .filter(function (nom) { return domaineCompatible(requete, nom); })
      .map(function (nom) {
        return { nom: nom, score: ajusterScoreMetier(requete, nom, scores[nom]) };
      })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, k)
      .map(function (r) {
        return { table: HQ.dictionary.getTable(r.nom), score: r.score };
      })
      .filter(function (r) { return r.table; });
  }

  /* ---- classe les champs d'une table par pertinence -------- */
  function champsPertinents(table, requete, n) {
    var termes = {};
    tokeniser(requete).forEach(function (t) { termes[t] = true; });

    return (table.fields || [])
      .map(function (f) {
        var s      = 0;
        var nomMaj = (f.name || '').toUpperCase();
        if (nomMaj === 'ID_SEJOUR') s += 5;
        tokeniser(f.name).forEach(function (t)              { if (termes[t]) s += 8; });
        tokeniser(f.description || '').forEach(function (t) { if (termes[t]) s += 3; });
        return { f: f, s: s };
      })
      .sort(function (a, b) { return b.s - a.s; })
      .filter(function (x) { return x.s > 0; })
      .slice(0, n || 10)
      .map(function (x) { return x.f; });
  }

  /* ---- extrait compact pour le prompt ---------------------- */
  function extraitPourPrompt(requete, k) {
    var resultats = chercher(requete, k || 4);
    if (!resultats.length) return 'Aucune table pertinente trouvée.';

    return resultats.map(function (r) {
      var t      = r.table;
      var champs = champsPertinents(t, requete, 10)
        .map(function (f) {
          var d = (f.description || '').slice(0, 70);
          return '  ' + f.name + (d ? ' — ' + d : '');
        }).join('\n');

      var liens = (HQ.dictionary.getLinks(t.name) || [])
        .filter(function (l) { return l.targetTable; })
        .slice(0, 4)
        .map(function (l) { return l.fieldName + '→' + l.targetTable; })
        .join(', ');

      return '### ' + t.name
        + (t.description ? ' — ' + t.description.slice(0, 90) : '')
        + '\n' + champs
        + (liens ? '\n  Liens : ' + liens : '');
    }).join('\n\n');
  }

  HQ.retrieval = {
    construireIndex:   construireIndex,
    chercher:          chercher,
    extraitPourPrompt: extraitPourPrompt,
    champsPertinents:  champsPertinents,
    tokeniser:         tokeniser
  };
})();
