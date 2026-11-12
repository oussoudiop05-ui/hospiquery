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
    var seen = {};
    var tables = [];

    /* Tables déjà dans le schéma en priorité */
    (nodes || []).forEach(function (n) {
      var key = (n.name || '').toUpperCase();
      if (!seen[key]) {
        seen[key] = true;
        var t = HQ.dictionary.getTable(n.name);
        if (t) tables.push(t);
      }
    });

    /* Mots-clés extraits de la demande */
    var words = (request || '')
      .replace(/[^a-zA-Z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length > 3; });

    words.forEach(function (word) {
      if (tables.length >= 8) return;
      HQ.dictionary.searchTables(word).forEach(function (t) {
        var key = (t.name || '').toUpperCase();
        if (!seen[key]) {
          seen[key] = true;
          tables.push(t);
        }
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

  /* ---- Instructions de format pour la réponse -------------- */
  var FORMAT_INSTRUCTIONS = [
    '## FORMAT DE RÉPONSE',
    'Commence par ton analyse en français.',
    'Si ta réponse modifie le schéma d\'extraction, termine par un bloc JSON entre ces balises exactes :',
    '',
    '---HQ_STATE_BEGIN---',
    '{ ... }',
    '---HQ_STATE_END---',
    '',
    '**Mode "full"** — remplace tout l\'état (nouvelle extraction ou refonte complète) :',
    '{',
    '  "mode": "full",',
    '  "request": "Description de l\'extraction",',
    '  "granularity": "1 ligne = ...",',
    '  "nodes": [',
    '    {',
    '      "id": "n1", "kind": "table", "name": "NOM_TABLE",',
    '      "schema": "dbo", "conn": "con2", "source": "CORA RECUEIL",',
    '      "reliability": "ok", "grain": "1 ligne = ...",',
    '      "multiplier": null, "branchOf": null,',
    '      "columns": [',
    '        {"name":"COL","type":"varchar","label":"...","checked":true,"filter":"","alias":"","isKey":false,"note":""}',
    '      ]',
    '    }',
    '  ],',
    '  "joins": [{"from":"n1","to":"n2","type":"inner","on":[["COL_A","COL_B"]],"note":"..."}],',
    '  "derived": [],',
    '  "finalOrder": []',
    '}',
    '',
    '**Mode "patch"** — pour une correction courte (préférer ce mode) :',
    '{',
    '  "mode": "patch",',
    '  "requestUpdate": "...",',
    '  "nodePatches": [{"nodeId":"n1","columnPatches":[{"name":"MONTANT_GHS","checked":false}]}],',
    '  "addColumns": [{"nodeId":"n2","column":{"name":"CODE_CMD","checked":true,"type":"varchar","label":"...","filter":"","alias":"","isKey":false,"note":""}}],',
    '  "joinPatches": [{"from":"n1","to":"n2","type":"left","note":"..."}],',
    '  "addJoins": [{"from":"n2","to":"n3","type":"left","on":[["ID","ID"]],"note":"..."}]',
    '}'
  ].join('\n');

  var HARD_RULES = [
    '## RÈGLES ABSOLUES',
    '- Répondre TOUJOURS EN FRANÇAIS.',
    '- Jamais de jointure sans vérification — déclarer son marqueur ✅/📖/❓.',
    '- Jamais un multiplicateur de lignes non signalé dans le node (champ "multiplier").',
    '- Toujours filtrer STATUT = \'T\' sur TB_SYNTH_RSS (séjours non terminés exclus).',
    '- trimws() obligatoire sur NO_SEJOUR avant tout join sur IEP.',
    '- Format date SQL Server : AAAAMMJJ (\'20240101\'), pas AAAA-MM-JJ.',
    '- Préférer CORA RECUEIL (con2 / dbo) au Décisionnel (con1 / Q) quand la table existe dans les deux.',
    '- Connexions con1/con2/con3 en encodage latin1, axi (SPIM/DPI) en UTF-8.',
    '- TB_DIAG granularité = le MOUVEMENT (ID_MVT = lien principal), pas le séjour.'
  ].join('\n');

  /* ---- Prompt système -------------------------------------- */
  function buildSystem(state) {
    var claudemd   = getClaudemdText();
    var currentSt  = stateSummary(state);
    var dict       = dictExcerpt(state ? state.request : '', state ? state.nodes : []);

    var parts = [
      'Tu es l\'assistant DIM/Data Manager de HospiQuery, outil d\'extraction PMSI pour l\'APHM (base HospiTrack, R Studio).',
      HARD_RULES,
      FORMAT_INSTRUCTIONS
    ];

    if (claudemd) {
      parts.push('## CLAUDE.md CHARGÉ\n\n' + claudemd);
    } else {
      parts.push([
        '## CONTEXTE PMSI (CLAUDE.md non chargé)',
        'Tables principales : TB_SEJOUR, TB_DIAG, TB_SYNTH_RSS, TB_SYNTH_RUM, TB_PATIENT, TB_MVT.',
        'Jointures connues : TB_DIAG.ID_SEJOUR = TB_SEJOUR.ID_SEJOUR ; TMVENUE_PL.IEP = TB_SEJOUR.NO_SEJOUR (trimws()).',
        'Multiplicateurs : TB_DIAG ×nb_diags×nb_mvts, TACCAM ×nb_actes, TB_SYNTH_RUM ×nb_RUM, TMCOUVERTURE_PL ×2.',
        '→ Chargez le CLAUDE.md dans Réglages pour des réponses plus précises.'
      ].join('\n'));
    }

    parts.push('## ÉTAT ACTUEL DU SCHÉMA\n\n' + currentSt);
    parts.push('## EXTRAIT DU DICTIONNAIRE (tables pertinentes)\n\n' + dict);

    return parts.join('\n\n---\n\n');
  }

  /* ---- Construction du tableau messages -------------------- */
  function buildMessages(history, userText) {
    var msgs = (history || []).slice();
    msgs.push({ role: 'user', content: userText });
    return msgs;
  }

  /* ---- Prompt « méthode en 8 étapes » ---------------------- */
  function buildEightStepText(request) {
    var req = (request || '').trim() || 'Extraction PMSI (précisez la demande)';
    return [
      'Applique la **méthode en 8 étapes** du CLAUDE.md (section 1.1) pour cette demande :',
      '',
      '**Demande :** ' + req,
      '',
      'Présente chaque étape dans l\'ordre (ne code rien, questionne si ambigu) :',
      '1. Questions de cadrage (période ? champ MCO/SSR/HAD/PSY ? type passage ? granularité ?)',
      '2. Granularité de la table finale (1 ligne = ?)',
      '3. Librairies R nécessaires et pourquoi',
      '4. Connexion(s) à utiliser (con1/con2/con3/axi) et pourquoi',
      '5. Tables retenues avec marqueur ✅/📖/❓, granularité propre, multiplicateur s\'il y en a un',
      '6. Colonnes recommandées (Bloc A indispensables) puis additionnelles disponibles (Bloc B)',
      '7. Enchaînement séquentiel des jointures étape par étape (clé, type, risque, contrôle)',
      '8. Contrôles qualité attendus et ordre de grandeur',
      '',
      'Si tu peux déjà proposer un schéma préliminaire, termine par le bloc HQ_STATE_BEGIN.'
    ].join('\n');
  }

  /* ---- Parsing de la réponse de Claude --------------------- */
  function parseResponse(raw) {
    var BEGIN = '---HQ_STATE_BEGIN---';
    var END   = '---HQ_STATE_END---';
    var iB = raw.indexOf(BEGIN);
    var iE = raw.indexOf(END);
    var text  = raw;
    var patch = null;

    if (iB >= 0 && iE > iB) {
      text = raw.slice(0, iB).trim();
      var jsonStr = raw.slice(iB + BEGIN.length, iE).trim();
      try {
        patch = JSON.parse(jsonStr);
      } catch (e) {
        text += '\n\n⚠️ Bloc état invalide (JSON malformé) — aucune modification du schéma appliquée.';
      }
    }

    return { text: text, patch: patch };
  }

  /* ---- Application d'un patch à l'état -------------------- */
  function applyPatch(state, patch) {
    if (!patch) return state;
    var s = JSON.parse(JSON.stringify(state));

    if (patch.mode === 'full') {
      return {
        request:    patch.request     || s.request,
        granularity:patch.granularity || s.granularity,
        nodes:      patch.nodes       || s.nodes,
        joins:      patch.joins       || s.joins,
        derived:    patch.derived     || [],
        finalOrder: patch.finalOrder  || [],
        warnings:   patch.warnings    || []
      };
    }

    if (patch.mode === 'patch') {
      if (patch.requestUpdate)     s.request     = patch.requestUpdate;
      if (patch.granularityUpdate) s.granularity = patch.granularityUpdate;

      /* Patcher des colonnes existantes */
      (patch.nodePatches || []).forEach(function (np) {
        var node = null;
        for (var i = 0; i < s.nodes.length; i++) {
          if (s.nodes[i].id === np.nodeId) { node = s.nodes[i]; break; }
        }
        if (!node) return;
        (np.columnPatches || []).forEach(function (cp) {
          for (var j = 0; j < node.columns.length; j++) {
            if (node.columns[j].name === cp.name) {
              Object.keys(cp).forEach(function (k) {
                if (k !== 'name') node.columns[j][k] = cp[k];
              });
              break;
            }
          }
        });
      });

      /* Ajouter des colonnes */
      (patch.addColumns || []).forEach(function (ac) {
        var node = null;
        for (var i = 0; i < s.nodes.length; i++) {
          if (s.nodes[i].id === ac.nodeId) { node = s.nodes[i]; break; }
        }
        if (!node || !ac.column) return;
        var exists = node.columns.some(function (c) { return c.name === ac.column.name; });
        if (!exists) node.columns.push(ac.column);
      });

      /* Patcher des jointures existantes */
      (patch.joinPatches || []).forEach(function (jp) {
        for (var i = 0; i < s.joins.length; i++) {
          if (s.joins[i].from === jp.from && s.joins[i].to === jp.to) {
            Object.keys(jp).forEach(function (k) {
              if (k !== 'from' && k !== 'to') s.joins[i][k] = jp[k];
            });
            break;
          }
        }
      });

      /* Ajouter des jointures */
      (patch.addJoins || []).forEach(function (aj) {
        var exists = s.joins.some(function (j) { return j.from === aj.from && j.to === aj.to; });
        if (!exists) s.joins.push(aj);
      });
    }

    return s;
  }

  HQ.prompt = {
    buildSystem:        buildSystem,
    buildMessages:      buildMessages,
    buildEightStepText: buildEightStepText,
    parseResponse:      parseResponse,
    applyPatch:         applyPatch,
    getClaudemdText:    getClaudemdText,
    setClaudemdText:    setClaudemdText
  };
})();
