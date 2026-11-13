/* ============================================================
   render-chat.js — panneau Discussion (onglet chat du bandeau).
   Expose HQ.renderChat = { wire(toast), reset() }
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var D = HQ.dom;
  var el = D.el;

  /* ---- état local ------------------------------------------ */
  var _history   = [];
  var _streaming = false;
  var _listEl    = null;
  var _inputEl   = null;
  var _sendBtn   = null;
  var _welcomeEl = null;
  var _toast     = null;

  /* ============================================================
     RENDU MARKDOWN
     ============================================================ */

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInline(text) {
    var s = escHtml(text);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g,     '<em>$1</em>');
    s = s.replace(/`([^`\n]+)`/g,       '<code>$1</code>');
    return s;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    var lines = text.split('\n');
    var out   = '';
    var i = 0, n = lines.length;

    while (i < n) {
      var line = lines[i];

      /* ---- bloc de code ---- */
      if (/^```/.test(line)) {
        var lang = line.slice(3).trim();
        i++;
        var code = '';
        while (i < n && !/^```/.test(lines[i])) {
          code += escHtml(lines[i]) + '\n';
          i++;
        }
        out += '<pre class="md-code"><code' + (lang ? ' class="lang-' + escHtml(lang) + '"' : '') + '>' + code + '</code></pre>';
        i++;
        continue;
      }

      /* ---- règle horizontale ---- */
      if (/^---+\s*$/.test(line)) {
        out += '<hr class="md-hr">';
        i++;
        continue;
      }

      /* ---- titres ---- */
      var hm = line.match(/^(#{1,4})\s+(.+)$/);
      if (hm) {
        var hlvl = Math.min(hm[1].length + 2, 6);
        out += '<h' + hlvl + ' class="md-h">' + renderInline(hm[2]) + '</h' + hlvl + '>';
        i++;
        continue;
      }

      /* ---- citation ---- */
      if (/^>\s?/.test(line)) {
        var bqLines = [];
        while (i < n && /^>\s?/.test(lines[i])) {
          bqLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out += '<blockquote class="md-bq">' + renderMarkdown(bqLines.join('\n')) + '</blockquote>';
        continue;
      }

      /* ---- tableau (lookahead : ligne suivante = séparateur) ---- */
      var isTable = line.includes('|') && i + 1 < n && /^[\s|:=-]+$/.test(lines[i + 1]);
      if (isTable) {
        var thdrs = line.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
        out += '<table class="md-table"><thead><tr>';
        thdrs.forEach(function (h) { out += '<th>' + renderInline(h) + '</th>'; });
        out += '</tr></thead><tbody>';
        i += 2;
        while (i < n && lines[i].includes('|') && !/^#{1,4}\s/.test(lines[i]) && !/^---/.test(lines[i])) {
          var tcells = lines[i].split('|').map(function (c) { return c.trim(); }).filter(Boolean);
          out += '<tr>';
          tcells.forEach(function (c) { out += '<td>' + renderInline(c) + '</td>'; });
          out += '</tr>';
          i++;
        }
        out += '</tbody></table>';
        continue;
      }

      /* ---- liste non ordonnée ---- */
      if (/^[-*+]\s+/.test(line)) {
        out += '<ul class="md-ul">';
        while (i < n && /^[-*+]\s+/.test(lines[i])) {
          out += '<li>' + renderInline(lines[i].replace(/^[-*+]\s+/, '')) + '</li>';
          i++;
        }
        out += '</ul>';
        continue;
      }

      /* ---- liste ordonnée ---- */
      if (/^\d+\.\s+/.test(line)) {
        out += '<ol class="md-ol">';
        while (i < n && /^\d+\.\s+/.test(lines[i])) {
          out += '<li>' + renderInline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>';
          i++;
        }
        out += '</ol>';
        continue;
      }

      /* ---- ligne vide ---- */
      if (!line.trim()) { i++; continue; }

      /* ---- paragraphe : lignes consécutives non-spéciales ---- */
      var paraLines = [];
      while (i < n && lines[i].trim() &&
             !/^[#>`*+\-]/.test(lines[i]) &&
             !/^\d+\./.test(lines[i]) &&
             !/^```/.test(lines[i]) &&
             !/^---/.test(lines[i]) &&
             !(lines[i].includes('|') && i + 1 < n && /^[\s|:=-]+$/.test(lines[i + 1]))) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length) {
        out += '<p class="md-p">' + renderInline(paraLines.join(' ')) + '</p>';
      }
    }

    return out;
  }

  /* ============================================================
     CARTES Q&A INTERACTIVES
     ============================================================ */

  function hasQABlocks(text) {
    return /\*\*Q\d+/.test(text) || /^Q\d+\s*[—\-]/m.test(text);
  }

  function parseQABlocks(text) {
    var parts    = text.split(/(?=(?:^|\n)\*\*Q\d+\s*[—\-])/);
    var preamble = '';
    var blocks   = [];

    parts.forEach(function (part) {
      var part2 = part.replace(/^\n/, '');
      var qm    = part2.match(/^\*\*Q(\d+)\s*[—\-]\s*([^*\n]+)\*\*/);
      if (!qm) { preamble += part; return; }

      var qNum  = qm[1];
      var qTitle = qm[2].trim();
      var body  = part2.slice(qm[0].length).trim();

      /* Extraire la proposition */
      var propMatch   = body.match(/Proposition(?:\s+par\s+défaut)?\s*:\s*([^\n]+)/i);
      var proposition = propMatch ? propMatch[1].trim() : null;

      /* Nettoyer le body */
      var bodyClean = body;
      if (propMatch) {
        bodyClean = bodyClean.replace(propMatch[0], '').trim();
      }

      blocks.push({ num: qNum, title: qTitle, body: bodyClean, proposition: proposition });
    });

    return { preamble: preamble.trim(), blocks: blocks };
  }

  function buildQACards(parsed, onAllAnswered) {
    var container = el('div.qa-container', {});
    var answers   = {};

    if (parsed.preamble) {
      var preEl = el('div.qa-preamble', {});
      preEl.innerHTML = renderMarkdown(parsed.preamble);
      container.appendChild(preEl);
    }

    parsed.blocks.forEach(function (block) {
      var card = el('div.qa-card', {'data-q': block.num});

      /* En-tête */
      var header  = el('div.qa-card__header', {}, [
        el('span.qa-card__num',   {text: 'Q' + block.num}),
        el('span.qa-card__title', {text: block.title})
      ]);
      card.appendChild(header);

      /* Corps */
      if (block.body) {
        var bodyEl = el('div.qa-card__body', {});
        bodyEl.innerHTML = renderMarkdown(block.body);
        card.appendChild(bodyEl);
      }

      /* Proposition mise en avant */
      if (block.proposition) {
        var propEl = el('div.qa-card__proposition', {}, [
          el('span.qa-card__prop-label', {text: 'Proposition : '}),
          el('span', {text: block.proposition})
        ]);
        card.appendChild(propEl);
      }

      /* Boutons d'action */
      var valBtn   = el('button.btn.btn--sm.qa-btn-ok',              {type: 'button', text: '✓ Valider'});
      var autreBtn = el('button.btn.btn--sm.btn--ghost.qa-btn-autre', {type: 'button', text: '✗ Autre chose'});
      var actions  = el('div.qa-card__actions', {}, [valBtn, autreBtn]);
      card.appendChild(actions);

      /* Champ de réponse personnalisée (masqué par défaut) */
      var customInput = document.createElement('textarea');
      customInput.className   = 'qa-custom-input';
      customInput.placeholder = 'Décrivez votre préférence…';
      customInput.rows        = 2;
      var confirmBtn = el('button.btn.btn--sm.btn--primary', {type: 'button', text: 'Confirmer'});
      var customRow  = el('div.qa-card__custom.qa-card__custom--hidden', {}, [customInput, confirmBtn]);
      card.appendChild(customRow);

      /* Zone de confirmation */
      var validatedEl = el('div.qa-card__validated', {});
      card.appendChild(validatedEl);

      function markAnswered(answerText) {
        answers[block.num] = answerText;
        card.classList.add('qa-card--answered');
        actions.style.display      = 'none';
        customRow.style.display    = 'none';
        validatedEl.textContent    = '✓ ' + answerText;
        validatedEl.style.display  = 'block';
        if (Object.keys(answers).length === parsed.blocks.length) {
          if (onAllAnswered) onAllAnswered(answers);
        }
      }

      valBtn.addEventListener('click', function () {
        markAnswered(block.proposition || 'Proposition validée');
      });

      autreBtn.addEventListener('click', function () {
        customRow.classList.remove('qa-card__custom--hidden');
        customInput.focus();
      });

      confirmBtn.addEventListener('click', function () {
        var v = customInput.value.trim();
        if (v) markAnswered(v);
      });

      customInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          var v = customInput.value.trim();
          if (v) markAnswered(v);
        }
      });

      container.appendChild(card);
    });

    /* Bouton de lancement (apparaît quand tout est répondu) */
    var launchBtn = el('button.btn.btn--primary.qa-launch', {
      type: 'button',
      text: '→ Générer le schéma et le script R'
    });
    launchBtn.style.display = 'none';
    container.appendChild(launchBtn);

    return { container: container, launchBtn: launchBtn, answers: answers };
  }

  /* ============================================================
     BULLES DE MESSAGE
     ============================================================ */

  function appendBubble(role, text, streaming) {
    var inner  = el('div.chat-bubble__inner', {});
    var bubble = el('div.chat-bubble.chat-bubble--' + role, {}, [inner]);

    if (text) {
      if (role === 'user') {
        inner.textContent = text;
      } else {
        inner.innerHTML = renderMarkdown(text);
      }
    }
    if (streaming) inner.classList.add('is-streaming');

    _listEl.appendChild(bubble);
    _listEl.scrollTop = _listEl.scrollHeight;
    return inner;
  }

  /* ---- verrouiller l'UI pendant le streaming ---------------- */
  function setStreaming(flag) {
    _streaming = flag;
    if (_sendBtn) {
      _sendBtn.disabled    = flag;
      _sendBtn.textContent = flag ? '…' : '→';
    }
    if (_inputEl) _inputEl.disabled = flag;
  }

  /* ============================================================
     ENVOI DE MESSAGE
     ============================================================ */

  function sendMessage(text) {
    text = (text || '').trim();
    if (!text || _streaming) return;

    if (_inputEl) _inputEl.value = '';

    appendBubble('user', text);
    _history.push({ role: 'user', content: text });

    var state  = HQ.store.getState();
    var system = HQ.prompt.buildSystem(state);
    var msgs   = HQ.prompt.buildMessages(_history.slice(0, -1), text);

    var inner    = appendBubble('assistant', '', true);
    var fullText = '';

    setStreaming(true);

    HQ.api.stream(
      'chat.reply',
      { system: system, messages: msgs, maxTokens: 2048 },

      /* onChunk */ function (chunk) {
        fullText += chunk;
        inner.textContent = fullText;    /* textContent = sûr pendant le streaming */
        _listEl.scrollTop = _listEl.scrollHeight;
      },

      /* onDone */ function () {
        inner.classList.remove('is-streaming');
        setStreaming(false);

        var parsed      = HQ.prompt.parseResponse(fullText);
        var displayText = parsed.text;

        /* Rendu final : cartes Q&A ou markdown ordinaire */
        if (hasQABlocks(displayText)) {
          inner.textContent = '';
          inner.classList.add('has-qa');

          var qaParsed = parseQABlocks(displayText);
          var qaResult = buildQACards(qaParsed, function () {
            qaResult.launchBtn.style.display = 'block';
            _listEl.scrollTop = _listEl.scrollHeight;
          });

          qaResult.launchBtn.addEventListener('click', function () {
            var summary = qaParsed.blocks.map(function (b) {
              return 'Q' + b.num + ' — ' + b.title + ' : ' + (qaResult.answers[b.num] || '(validé)');
            }).join('\n');
            var msg = 'Voici mes réponses aux questions de cadrage :\n\n' + summary
                      + '\n\nProduis maintenant le schéma et le script R complet.';
            sendMessage(msg);
          });

          inner.appendChild(qaResult.container);
        } else {
          inner.innerHTML = renderMarkdown(displayText);
        }

        _history.push({ role: 'assistant', content: displayText });

        if (parsed.patch) {
          HQ.store.patch(function (copy) {
            return HQ.prompt.applyPatch(copy, parsed.patch);
          });
          HQ.store.setUI({ activeTab: 'script' });
          if (_toast) _toast('Schéma mis à jour', 'ok');
        }
      },

      /* onError */ function (err) {
        inner.classList.remove('is-streaming');
        inner.classList.add('has-error');
        inner.textContent = '✗ ' + (err.message || 'Erreur inconnue');
        setStreaming(false);
        _history.pop();
      }
    );
  }

  /* ============================================================
     RÉINITIALISATION
     ============================================================ */

  function reset() {
    _history = [];
    if (_listEl) {
      D.clear(_listEl);
      _listEl.appendChild(_welcomeEl);
    }
  }

  /* ============================================================
     CONSTRUCTION DU PANNEAU
     ============================================================ */

  function buildPane(toast) {
    _toast = toast;

    var pane = D.byId('pane-chat');
    if (!pane) return;
    D.clear(pane);

    _listEl = el('div.chat-list', {});

    _welcomeEl = el('div.chat-bubble.chat-bubble--system', {}, [
      el('div.chat-bubble__inner', {
        text: 'Décrivez votre extraction PMSI, posez une question, ou utilisez « 8 étapes » pour suivre la méthode du CLAUDE.md.'
      })
    ]);
    _listEl.appendChild(_welcomeEl);

    _inputEl             = document.createElement('textarea');
    _inputEl.className   = 'chat-input';
    _inputEl.placeholder = 'Votre message… (Entrée = envoyer, Maj+Entrée = saut de ligne)';
    _inputEl.rows        = 3;
    _inputEl.setAttribute('aria-label', 'Message à envoyer');

    _inputEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage(_inputEl.value);
      }
    });

    _sendBtn = el('button.btn.chat-send', {
      type: 'button', text: '→', 'aria-label': 'Envoyer'
    });
    _sendBtn.addEventListener('click', function () {
      sendMessage(_inputEl.value);
    });

    var eightBtn = el('button.btn.btn--ghost.chat-8step', {
      type: 'button', text: '8 étapes',
      title: 'Lancer la méthode en 8 étapes du CLAUDE.md'
    });
    eightBtn.addEventListener('click', function () {
      var req = (HQ.store.getState().request || _inputEl.value || '').trim();
      if (!req) {
        if (_toast) _toast('Saisissez ou décrivez d\'abord la demande', 'warn');
        if (_inputEl) _inputEl.focus();
        return;
      }
      var txt = HQ.prompt.buildEightStepText(req);
      _inputEl.value = '';
      sendMessage(txt);
    });

    var clearBtn = el('button.btn.btn--ghost.chat-clear', {
      type: 'button', text: '↺',
      title: 'Effacer la conversation', 'aria-label': 'Effacer la conversation'
    });
    clearBtn.addEventListener('click', function () { reset(); });

    var inputRow = el('div.chat-input-row', {}, [_inputEl, _sendBtn]);
    var toolbar  = el('div.chat-toolbar',  {}, [eightBtn, clearBtn]);
    var footer   = el('div.chat-footer',   {}, [toolbar, inputRow]);

    pane.appendChild(_listEl);
    pane.appendChild(footer);
  }

  function wire(toast) { buildPane(toast); }

  HQ.renderChat = { wire: wire, reset: reset };
})();
