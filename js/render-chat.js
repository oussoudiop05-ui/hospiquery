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
  var _streaming  = false;
  var _rafPending = false;
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

  /* ---- rendu markdown via marked.js (CDN) ------------------- */
  var _renderer = null;

  function _buildRenderer() {
    if (_renderer) return _renderer;
    _renderer = new marked.Renderer();
    _renderer.paragraph  = function (text)         { return '<p class="md-p">' + text + '</p>\n'; };
    _renderer.heading    = function (text, level)  {
      var l = Math.min(level + 2, 6);
      return '<h' + l + ' class="md-h">' + text + '</h' + l + '>\n';
    };
    _renderer.hr         = function ()             { return '<hr class="md-hr">\n'; };
    _renderer.blockquote = function (quote)        { return '<blockquote class="md-bq">' + quote + '</blockquote>\n'; };
    _renderer.list       = function (body, ordered) {
      var tag = ordered ? 'ol' : 'ul';
      return '<' + tag + ' class="md-' + tag + '">' + body + '</' + tag + '>\n';
    };
    _renderer.code       = function (code, lang) {
      var cls = lang ? ' class="lang-' + escHtml(lang) + '"' : '';
      return '<pre class="md-code"><code' + cls + '>' + escHtml(code) + '</code></pre>\n';
    };
    _renderer.table      = function (header, body) {
      return '<table class="md-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table>\n';
    };
    return _renderer;
  }

  function renderMd(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      return marked.parse(text, { renderer: _buildRenderer(), gfm: true });
    }
    /* fallback sans librairie */
    return '<p class="md-p">' + escHtml(text).replace(/\n\n+/g, '</p><p class="md-p">') + '</p>';
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
      preEl.innerHTML = renderMd(parsed.preamble);
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
        bodyEl.innerHTML = renderMd(block.body);
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
        inner.innerHTML = renderMd(text);
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
        if (!_rafPending) {
          _rafPending = true;
          requestAnimationFrame(function () {
            _rafPending = false;
            inner.textContent = fullText;
            _listEl.scrollTop = _listEl.scrollHeight;
          });
        }
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
          inner.innerHTML = renderMd(displayText);
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
