/* ============================================================
   prompt.js — construction des prompts et parsing des réponses.
   AUCUN accès au DOM dans ce fichier.
   Expose HQ.prompt
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var CLAUDEMD_KEY = 'hq.claudemd';

  /* ---- CLAUDE.md (stocké dans localStorage par ui-claudemd) */
  function getClaudemdText() {
    try { return localStorage.getItem(CLAUDEMD_KEY) || ''; } catch (e) { return ''; }
  }

  function setClaudemdText(text) {
    try { localStorage.setItem(CLAUDEMD_KEY, text || ''); } catch (e) {}
  }

  /* ---- Résumé compact de l'état courant -------------------- */
  function stateSummary(state) {
    if (!state || !state.nodes || !state.nodes.length) {
      return 'Aucune table sélectionnée pour l\'instant.';
    }
    var lines = [];
    lines.push('Demande : ' + (state.request || '(non définie)'));
    lines.push('Granularité : ' + (state.granularity || '(non définie)'));
    lines.push('');
    lines.push('Tables (' + state.nodes.length + ') :');
    state.nodes.forEach(function (n) {
      var checked = (n.columns || []).filter(function (c) { return c.checked; })
                                     .map(function (c) { return c.name + (c.filter ? '[' + c.filter + ']' : ''); });
      lines.push('  ' + n.id + ' — ' + (n.schema || 'dbo') + '.' + n.name + ' [' + (n.conn || 'con2') + '] — ' + (n.grain || '?'));
      if (checked.length) lines.push('    Colonnes : ' + checked.join(', '));
      if (n.multiplier) lines.push('    ⚠️ Multiplicateur : ' + n.multiplier.factor + ' — ' + n.multiplier.reason);
    });
    if (state.joins && state.joins.length) {
      lines.push('');
      lines.push('Jointures :');
      state.joins.forEach(function (j) {
        var onStr = (j.on || []).map(function (p) { return p[0] + '=' + p[1]; }).join(', ');
        lines.push('  ' + j.from + ' →[' + j.type + ']→ ' + j.to + ' sur ' + onStr + (j.note ? ' (' + j.note.slice(0, 80) + ')' : ''));
      });
    }
    if (state.derived && state.derived.length) {
      lines.push('');
      lines.push('Dérivées : ' + state.derived.map(function (d) { return d.name + ' = ' + d.expr; }).join(' | '));
    }
    return lines.join('\n');
  }

  /* ---- Extrait dictionnaire (tables pertinentes à la demande) */
  function dictExcerpt(request, nodes) {
    if (!HQ.dictionary || !HQ.dictionary.isLoaded()) {
      return 'Dictionnaire non chargé — les informations sur les tables viennent du CLAUDE.md.';
    }

    /* Moteur BM25 disponible → extrait optimisé par pertinence */
    if (HQ.retrieval && HQ.retrieval.extraitPourPrompt) {
      return HQ.retrieval.extraitPourPrompt(request, 5);
    }

    /* Fallback : ancienne recherche par mots-clés (indexOf) */
    var seen = {};
    var tables = [];

    (nodes || []).forEach(function (n) {
      var key = (n.name || '').toUpperCase();
      if (!seen[key]) {
        seen[key] = true;
        var t = HQ.dictionary.getTable(n.name);
        if (t) tables.push(t);
      }
    });

    var words = (request || '')
      .replace(/[^a-zA-Z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length > 3; });

    words.forEach(function (word) {
      if (tables.length >= 8) return;
      HQ.dictionary.searchTables(word).forEach(function (t) {
        var key = (t.name || '').toUpperCase();
        if (!seen[key]) { seen[key] = true; tables.push(t); }
      });
    });

    if (!tables.length) {
      return 'Aucune table trouvée dans le dictionnaire pour cette demande.';
    }

    return tables.map(function (t) {
      var fields = (t.fields || []).slice(0, 15).map(function (f) {
        var desc = (f.description || '').slice(0, 100);
        return '  - ' + f.name + (desc ? ' : ' + desc : '');
      }).join('\n');

      var links = HQ.dictionary.getLinks(t.name);
      var linkStr = '';
      if (links.length) {
        linkStr = '\n  Liens documentés : ' + links.slice(0, 5).map(function (l) {
          if (l.targetTable) return l.fieldName + ' → ' + l.targetTable + (l.targetField ? '.' + l.targetField : '');
          if (l.mainField)   return l.fieldName + ' (non-principal, principal=' + l.mainField + ')';
          return l.fieldName + ' (obligatoire)';
        }).join(', ');
      }

      var title = '### ' + t.name;
      if (t.description) title += ' — ' + t.description.slice(0, 120);
      return title + '\n' + fields + linkStr;
    }).join('\n\n');
  }

  var HARD_RULES = [
    '## RÈGLES ABSOLUES',
    '- Répondre TOUJOURS EN FRANÇAIS.',
    '- Les jointures sont construites localement depuis les preuves du graphe ; ne jamais en inventer.',
    '- Jamais un multiplicateur de lignes non signalé dans le node (champ "multiplier").',
    '- Toujours filtrer STATUT = \'T\' sur TB_SYNTH_RSS (séjours non terminés exclus).',
    '- trimws() obligatoire sur NO_SEJOUR avant tout join sur IEP.',
    '- Format date SQL Server : AAAAMMJJ (\'20240101\'), pas AAAA-MM-JJ.',
    '- Préférer CORA RECUEIL (con2 / dbo) au Décisionnel (con1 / Q) quand la table existe dans les deux.',
    '- Connexions con1/con2/con3 en encodage latin1, axi (SPIM/DPI) en UTF-8.',
    '- TB_DIAG granularité = le MOUVEMENT (ID_MVT = lien principal), pas le séjour.'
  ].join('\n');

  /* ---- mode complet (localStorage) ------------------------- */
  function getFullMode() {
    try { return localStorage.getItem('hq.fullClaudemd') === '1'; } catch(e) { return false; }
  }

  /* ---- Prompt système -------------------------------------- */
  /* Retourne { stable, variable } pour le prompt caching Anthropic.
     - stable   : intro + règles + contexte PMSI → mis en cache
     - variable : état du schéma + extrait dictionnaire → recalculé à chaque message
     Par défaut, utilise HQ.NOYAU_PMSI (~3 500 tokens).
     Si "mode complet" activé et CLAUDE.md chargé, envoie le CLAUDE.md complet (~30 000 tokens). */
  function buildSystem(state) {
    var claudemd  = getClaudemdText();
    var currentSt = stateSummary(state);
    var dict      = dictExcerpt(state ? state.request : '', state ? state.nodes : []);
    var useFullMode = getFullMode();

    var stableParts = [
      'Tu es l\'assistant DIM/Data Manager de HospiQuery, outil d\'extraction PMSI pour l\'APHM (base HospiTrack, R Studio).',
      HARD_RULES
    ];

    if (useFullMode && claudemd) {
      stableParts.push('## CLAUDE.md CHARGÉ\n\n' + claudemd);
    } else if (HQ.NOYAU_PMSI) {
      stableParts.push('## CONTEXTE PMSI (noyau)\n\n' + HQ.NOYAU_PMSI);
    } else if (claudemd) {
      stableParts.push('## CLAUDE.md CHARGÉ\n\n' + claudemd);
    } else {
      stableParts.push([
        '## CONTEXTE PMSI (CLAUDE.md non chargé)',
        'Tables principales : TB_SEJOUR, TB_DIAG, TB_SYNTH_RSS, TB_SYNTH_RUM, TB_PATIENT, TB_MVT.',
        'Jointures connues : TB_DIAG.ID_SEJOUR = TB_SEJOUR.ID_SEJOUR ; TMVENUE_PL.IEP = TB_SEJOUR.NO_SEJOUR (trimws()).',
        'Multiplicateurs : TB_DIAG ×nb_diags×nb_mvts, TACCAM ×nb_actes, TB_SYNTH_RUM ×nb_RUM, TMCOUVERTURE_PL ×2.',
        '→ Chargez le CLAUDE.md dans Réglages pour des réponses plus précises.'
      ].join('\n'));
    }

    return {
      stable:   stableParts.join('\n\n---\n\n'),
      variable: '## ÉTAT ACTUEL DU SCHÉMA\n\n' + currentSt
              + '\n\n---\n\n## EXTRAIT DU DICTIONNAIRE (tables pertinentes)\n\n' + dict
    };
  }

  /* ---- Construction du tableau messages -------------------- */
  function buildMessages(history, userText) {
    var msgs = (history || []).slice();
    msgs.push({ role: 'user', content: userText });
    return msgs;
  }

  function construirePromptCompact(request, cadrage, candidates) {
    var lines = [
      'Tu es assistant DIM/PMSI pour HospiQuery (base HospiTrack, APHM).',
      'Propose un plan, ne génère pas de code R et n’invente aucune colonne ou jointure.',
      '',
      'DEMANDE : ' + String(request || '').trim(),
      '',
      HQ.cadrage.enTexte(cadrage || {}),
      '',
      'TABLES CANDIDATES (vérifie les noms/champs dans cette liste) :'
    ];
    var tables = (candidates || []).slice(0, 5);
    if (!tables.length && HQ.dictionary && HQ.dictionary.isLoaded() &&
        HQ.retrieval && HQ.retrieval.chercher) {
      tables = HQ.retrieval.chercher(request, 5);
    }
    if (!tables.length) lines.push('- Aucune candidate BM25 ; choisir dans le dictionnaire joint.');
    tables.forEach(function (candidate) {
      var table = candidate.table || candidate;
      var fields = (table.fields || []).slice(0, 8).map(function (field) {
        return field.name + (field.description ? ' (' + field.description.slice(0, 70) + ')' : '');
      });
      lines.push('- ' + table.name + (table.description ? ' — ' + table.description.slice(0, 100) : ''));
      if (fields.length) lines.push('  Champs : ' + fields.join(', '));
    });
    lines.push(
      '',
      'RÈGLES : STATUT=\'T\' sur TB_SYNTH_RSS ; TYP_PASS selon le cadrage ; ' +
        'trimws() sur NO_SEJOUR avant jointure sur IEP ; dates SQL AAAAMMJJ ; ' +
        'signaler multiplicateurs et incertitudes.',
      'La table de départ doit être la première. Les jointures seront calculées localement.',
      '',
      'Réponds uniquement par un objet JSON valide, sans bloc markdown :',
      '{"granularite":"sejour|rss|rum|diagnostic|acte|patient",' +
        '"tables":[{"nom":"NOM_TABLE","role":"depart|enrichissement|filtre","pourquoi":"..."}],' +
        '"filtres":[{"table":"NOM_TABLE","colonne":"COL","operateur":"=|IN|LIKE|BETWEEN|>=|<=|IS NOT NULL","valeur":"..."}],' +
        '"codes_metier":[{"nomenclature":"CIM10|CCAM|GHM|CMD","motif":"...","libelle":"..."}],' +
        '"incertitudes":[]}'
    );
    return lines.join('\n');
  }

  HQ.prompt = {
    buildSystem:        buildSystem,
    buildMessages:      buildMessages,
    construirePromptCompact: construirePromptCompact,
    getClaudemdText:    getClaudemdText,
    setClaudemdText:    setClaudemdText
  };
})();
