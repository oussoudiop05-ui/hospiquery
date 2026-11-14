/* ============================================================
   ui-settings.js — modale Réglages : clé API, endpoint, stats.
   Expose HQ.uiSettings = { wire(openModal, closeModal, toast) }
   Dépendances : dom.js, api.js (chargés avant ce fichier)
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var D = HQ.dom;
  var el = D.el;

  /* ---- construction du corps de la modale ------------------ */
  function buildBody(toast) {
    var api = HQ.api;

    /* ---- section clé API ---- */
    var keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id   = 'settings-key';
    keyInput.className = 'input';
    keyInput.placeholder = 'sk-ant-…';
    keyInput.autocomplete = 'off';
    keyInput.spellcheck = false;
    var saved = api.getKey();
    if (saved) keyInput.value = saved;

    var keyLabel = document.createElement('label');
    keyLabel.setAttribute('for', 'settings-key');
    keyLabel.className = 'field-label';
    keyLabel.textContent = 'Clé API Anthropic';

    var keyHint = el('p.field-hint', {
      text: 'La clé est stockée dans votre navigateur (localStorage). Elle ne quitte jamais votre machine.'
    });

    keyLabel.textContent = 'Clé API (Anthropic ou OmniRoute)';
    keyHint.textContent = 'La clé est stockée dans ce navigateur. Facultative en mode Local, Pont Claude Code et pour une passerelle OmniRoute sans authentification.';

    var modeSelect = document.createElement('select');
    modeSelect.id = 'settings-mode';
    modeSelect.className = 'field-input';
    [
      { value: 'local', label: 'Local — recettes uniquement, hors réseau' },
      { value: 'omniroute', label: 'OmniRoute — passerelle locale, modèle gratuit' },
      { value: 'pont', label: 'Pont Claude Code — copier/coller, sans API' },
      { value: 'api', label: 'API — Anthropic' }
    ].forEach(function (option) {
      var item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      item.selected = option.value === api.getMode();
      modeSelect.appendChild(item);
    });

    var modeHint = el('p.field-hint', {
      text: 'Les recettes locales sont toujours proposées sans appel réseau. Les autres demandes suivent le mode choisi.'
    });
    modeSelect.setAttribute('aria-label', 'Mode de fonctionnement');
    var modeRow = el('label.cadrage-field', {}, [
      el('span.cadrage-field__label', { text: 'Mode de fonctionnement' }),
      modeSelect,
      modeHint
    ]);

    var localModel = document.createElement('input');
    localModel.type = 'text';
    localModel.id = 'settings-local-model';
    localModel.className = 'input';
    localModel.value = api.getLocalModel();
    localModel.autocomplete = 'off';
    var localModelRow = el('label.cadrage-field', {}, [
      el('span.cadrage-field__label', { text: 'Modèle OmniRoute' }),
      localModel,
      el('p.field-hint', {
        text: 'Par défaut : groq/openai/gpt-oss-120b. L’URL locale est http://localhost:20128.'
      })
    ]);

    /* ---- test de connexion ---- */
    var testBtn = el('button.btn.btn--sm', { type: 'button', text: 'Tester la connexion' });
    var testResult = el('p.settings-test-result', {});

    testBtn.addEventListener('click', function () {
      var key = keyInput.value.trim();
      var mode = modeSelect.value;
      if (mode === 'local' || mode === 'pont') {
        testResult.className = 'settings-test-result settings-test-result--ok';
        testResult.textContent = 'Ce mode ne fait aucun appel réseau.';
        return;
      }
      if (mode === 'api' && !key) {
        testResult.className = 'settings-test-result settings-test-result--err';
        testResult.textContent = 'Renseignez une clé avant de tester.';
        return;
      }
      /* Sauvegarder provisoirement pour que api.call() puisse lire la clé */
      var prevKey = api.getKey();
      var prevMode = api.getMode();
      api.setKey(key);
      api.setMode(mode);

      testResult.className = 'settings-test-result';
      testResult.textContent = '…';
      testBtn.disabled = true;

      api.call('dict.index', {
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        maxTokens: 10
      }).then(function (data) {
        testResult.className = 'settings-test-result settings-test-result--ok';
        var text = data.content && data.content[0] && data.content[0].text;
        if (!text && data.choices) text = data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        testResult.textContent = '✓ Connexion OK — modèle : ' + (data.model || api.modelFor('dict.index'));
      }).catch(function (e) {
        testResult.className = 'settings-test-result settings-test-result--err';
        testResult.textContent = '✗ ' + e.message;
        /* Restaurer les valeurs précédentes si le test échoue */
        api.setKey(prevKey);
        api.setMode(prevMode);
      }).finally(function () {
        testBtn.disabled = false;
      });
    });

    /* ---- statistiques d'usage ---- */
    var stats = api.getStats();
    var cost  = stats.costUSD.toFixed(4);
    var statsEl = el('dl.settings-stats', {}, [
      el('dt', { text: 'Appels' }),
      el('dd', { text: String(stats.calls) }),
      el('dt', { text: 'Tokens entrée' }),
      el('dd', { text: stats.inputTokens.toLocaleString('fr-FR') }),
      el('dt', { text: 'Tokens sortie' }),
      el('dd', { text: stats.outputTokens.toLocaleString('fr-FR') }),
      el('dt', { text: 'Coût estimé' }),
      el('dd', { text: '$' + cost })
    ]);
    var resetBtn = el('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Réinitialiser' });
    resetBtn.addEventListener('click', function () {
      api.resetStats();
      /* rafraîchir les chiffres */
      statsEl.querySelectorAll('dd').forEach(function (dd, i) {
        var s = api.getStats();
        var vals = [String(s.calls), s.inputTokens.toLocaleString('fr-FR'),
                    s.outputTokens.toLocaleString('fr-FR'), '$' + s.costUSD.toFixed(4)];
        dd.textContent = vals[i] || '';
      });
      toast && toast('Compteurs remis à zéro', 'ok');
    });

    /* ---- tableau de routage (informatif) ---- */
    var routeRows = Object.keys(api.ROUTES).map(function (task) {
      var model = api.ROUTES[task];
      var badge = model.indexOf('haiku') >= 0 ? 'haiku' : 'sonnet';
      return el('tr', {}, [
        el('td.route-task', { text: task }),
        el('td', {}, [el('span.route-badge.route-badge--' + badge, { text: badge })])
      ]);
    });
    var routeTable = el('table.settings-routes', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Tâche' }), el('th', { text: 'Modèle' })])]),
      el('tbody', {}, routeRows)
    ]);

    return el('div.settings-body', {}, [
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Clé API' }),
        keyLabel,
        keyInput,
        keyHint
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Mode de fonctionnement' }),
        modeRow,
        localModelRow
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Test de connexion' }),
        testBtn,
        testResult
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Consommation de cette session' }),
        statsEl,
        resetBtn
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Modèle Sonnet' }),
        el('p.field-hint', { text: 'Utilisé pour le raisonnement (plan, jointures, chat). Haiku reste toujours sur les tâches mécaniques.' }),
        (function () {
          var sel = document.createElement('select');
          sel.id = 'settings-sonnet-model';
          sel.className = 'field-input';
          [
            { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (actuel)' },
            { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (dernier)' }
          ].forEach(function (opt) {
            var o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === HQ.api.getSonnetModel()) o.selected = true;
            sel.appendChild(o);
          });
          return sel;
        })()
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Contexte PMSI envoyé à l\'API' }),
        (function () {
          var chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.id   = 'settings-full-claudemd';
          try { chk.checked = localStorage.getItem('hq.fullClaudemd') === '1'; } catch(e) {}
          var lbl = document.createElement('label');
          lbl.setAttribute('for', 'settings-full-claudemd');
          lbl.textContent = 'Envoyer le CLAUDE.md complet (coûteux)';
          return el('div.settings-checkbox', {}, [chk, lbl]);
        })(),
        el('p.field-hint', { text: 'Par défaut : noyau distillé (~3 500 tokens, −88 %). Mode complet : CLAUDE.md entier (~30 000 tokens). Ne change rien si le CLAUDE.md n\'est pas chargé.' })
      ]),
      el('section.settings-section', {}, [
        el('h3.settings-heading', { text: 'Routage des modèles' }),
        el('p.field-hint', { text: 'Opus n\'est jamais utilisé. Haiku pour les tâches mécaniques, Sonnet pour le raisonnement.' }),
        routeTable
      ])
    ]);
  }

  /* ---- pied de modale : Enregistrer + Fermer -------------- */
  function buildFoot(openModal, closeModal, toast) {
    var saveBtn  = el('button.btn', { type: 'button', text: 'Enregistrer' });
    var closeBtn = el('button.btn.btn--ghost', { type: 'button', 'data-close': '1', text: 'Fermer' });

    saveBtn.addEventListener('click', function () {
      var body    = document.getElementById('modal-body');
      var keyEl   = body && body.querySelector('#settings-key');
      var modeEl  = body && body.querySelector('#settings-mode');
      if (!keyEl) return;

      var key = keyEl.value.trim();
      var mode = modeEl ? modeEl.value : 'api';
      var smEl = body && body.querySelector('#settings-sonnet-model');
      var localModelEl = body && body.querySelector('#settings-local-model');
      if (localModelEl && !localModelEl.value.trim()) {
        toast && toast('Renseignez le nom du modèle OmniRoute.', 'warn');
        localModelEl.focus();
        return;
      }

      HQ.api.setKey(key);
      HQ.api.setMode(mode);
      if (smEl) HQ.api.setSonnetModel(smEl.value);
      if (localModelEl) HQ.api.setLocalModel(localModelEl.value);

      var fullModeEl = body && body.querySelector('#settings-full-claudemd');
      if (fullModeEl) {
        try {
          if (fullModeEl.checked) localStorage.setItem('hq.fullClaudemd', '1');
          else localStorage.removeItem('hq.fullClaudemd');
        } catch(e) {}
      }

      /* mettre à jour le chip #val-settings si présent */
      var valEl = document.getElementById('val-settings');
      if (valEl) valEl.textContent = key ? '✓' : 'non configuré';

      if (toast) toast('Réglages enregistrés — mode ' + mode + '.', 'ok');
      closeModal();
    });

    return el('div.modal-foot-row', {}, [saveBtn, closeBtn]);
  }

  /* ---- branchement principal ------------------------------- */
  function wire(openModal, closeModal, toast) {
    var btn = document.getElementById('btn-settings');
    if (!btn) return;

    btn.addEventListener('click', function () {
      openModal(
        'Réglages',
        buildBody(toast),
        buildFoot(openModal, closeModal, toast)
      );
    });
  }

  HQ.uiSettings = { wire: wire };
})();
