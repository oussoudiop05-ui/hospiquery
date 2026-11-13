/* ============================================================
   render-chat.js — panneau Discussion (onglet chat du bandeau).
   DOM-facing : construit l'UI, gère le streaming, applique les
   patches d'état via HQ.store.
   Expose HQ.renderChat = { wire(toast) }
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var D = HQ.dom;
  var el = D.el;

  /* ---- état local ------------------------------------------ */
  var _history   = [];   /* [{role, content}] */
  var _streaming = false;
  var _listEl    = null;
  var _inputEl   = null;
  var _sendBtn   = null;
  var _welcomeEl = null;
  var _toast     = null;

  /* ---- ajouter une bulle ------------------------------------ */
  function appendBubble(role, text, streaming) {
    var inner  = el('div.chat-bubble__inner', {});
    var bubble = el('div.chat-bubble.chat-bubble--' + role, {}, [inner]);

    if (text)      inner.textContent = text;
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

  /* ---- envoyer un message ----------------------------------- */
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
        inner.textContent = fullText;
        _listEl.scrollTop = _listEl.scrollHeight;
      },

      /* onDone */ function () {
        inner.classList.remove('is-streaming');
        setStreaming(false);

        var parsed = HQ.prompt.parseResponse(fullText);
        inner.textContent = parsed.text;

        _history.push({ role: 'assistant', content: parsed.text });

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
        _history.pop(); /* retirer le message utilisateur de l'historique */
      }
    );
  }

  /* ---- construire l'UI du panneau -------------------------- */
  function buildPane(toast) {
    _toast = toast;

    var pane = D.byId('pane-chat');
    if (!pane) return;
    D.clear(pane);

    /* Conteneur défilant de messages */
    _listEl = el('div.chat-list', {});

    /* Message de bienvenue */
    _welcomeEl = el('div.chat-bubble.chat-bubble--system', {}, [
      el('div.chat-bubble__inner', {
        text: 'Décrivez votre extraction PMSI, posez une question, ou utilisez « 8 étapes » pour suivre la méthode du CLAUDE.md.'
      })
    ]);
    _listEl.appendChild(_welcomeEl);

    /* Textarea de saisie */
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

    /* Bouton envoyer */
    _sendBtn = el('button.btn.chat-send', {
      type: 'button', text: '→', 'aria-label': 'Envoyer'
    });
    _sendBtn.addEventListener('click', function () {
      sendMessage(_inputEl.value);
    });

    /* Bouton 8 étapes */
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

    /* Bouton effacer la conversation */
    var clearBtn = el('button.btn.btn--ghost.chat-clear', {
      type: 'button', text: '↺',
      title: 'Effacer la conversation', 'aria-label': 'Effacer la conversation'
    });
    clearBtn.addEventListener('click', function () {
      _history = [];
      D.clear(_listEl);
      _listEl.appendChild(_welcomeEl);
    });

    var inputRow = el('div.chat-input-row', {}, [_inputEl, _sendBtn]);
    var toolbar  = el('div.chat-toolbar',  {}, [eightBtn, clearBtn]);
    var footer   = el('div.chat-footer',   {}, [toolbar, inputRow]);

    pane.appendChild(_listEl);
    pane.appendChild(footer);
  }

  /* ---- branchement principal ------------------------------- */
  function wire(toast) {
    buildPane(toast);
  }

  HQ.renderChat = { wire: wire };
})();
