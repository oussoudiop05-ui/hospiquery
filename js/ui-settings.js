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

    /* ---- section endpoint ---- */
    var endpointDirect = document.createElement('input');
    endpointDirect.type = 'radio';
    endpointDirect.name = 'hq-endpoint';
    endpointDirect.id   = 'ep-direct';
    endpointDirect.value = 'direct';

    var endpointLocal = document.createElement('input');
    endpointLocal.type = 'radio';
    endpointLocal.name = 'hq-endpoint';
    endpointLocal.id   = 'ep-local';
    endpointLocal.value = 'local';

    var curEp = api.getEndpoint();
    if (curEp === 'local') endpointLocal.checked = true;
    else endpointDirect.checked = true;

    var labelDirect = document.createElement('label');
    labelDirect.setAttribute('for', 'ep-direct');
    labelDirect.textContent = 'Direct Anthropic';

    var labelLocal = document.createElement('label');
    labelLocal.setAttribute('for', 'ep-local');
    labelLocal.textContent = 'Passerelle locale (OmniRoute port 20128)';

    var endpointRow = el('div.settings-radio-group', {}, [
      el('div.settings-radio', {}, [endpointDirect, labelDirect]),
      el('div.settings-radio', {}, [endpointLocal, labelLocal])
    ]);

    /* ---- test de connexion ---- */
    var testBtn = el('button.btn.btn--sm', { type: 'button', text: 'Tester la connexion' });
    var testResult = el('p.settings-test-result', {});

    testBtn.addEventListener('click', function () {
      var key = keyInput.value.trim();
      if (!key) {
        testResult.className = 'settings-test-result settings-test-result--err';
        testResult.textContent = 'Renseignez une clé avant de tester.';
        return;
      }
      /* Sauvegarder provisoirement pour que api.call() puisse lire la clé */
      var prevKey = api.getKey();
      api.setKey(key);
      var isLocal = document.querySelector('input[name="hq-endpoint"]:checked').value === 'local';
      var prevEp  = api.getEndpoint();
      api.setEndpoint(isLocal ? 'local' : 'direct');

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
        api.setEndpoint(prevEp);
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
        el('h3.settings-heading', { text: 'Point d\'accès' }),
        endpointRow
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
      var checked = body && body.querySelector('input[name="hq-endpoint"]:checked');
      if (!keyEl) return;

      var key = keyEl.value.trim();
      var ep  = checked ? checked.value : 'direct';
      var smEl = body && body.querySelector('#settings-sonnet-model');

      HQ.api.setKey(key);
      HQ.api.setEndpoint(ep);
      if (smEl) HQ.api.setSonnetModel(smEl.value);

      /* mettre à jour le chip #val-settings si présent */
      var valEl = document.getElementById('val-settings');
      if (valEl) valEl.textContent = key ? '✓' : 'non configuré';

      if (toast) toast(key ? 'Réglages enregistrés' : 'Clé effacée', 'ok');
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
