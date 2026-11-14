/* ============================================================
   ui-pont.js — échange manuel de plan avec Claude Code.
   Aucun appel réseau.
   Expose HQ.uiPont
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var el = HQ.dom.el;
  var _openModal = null;
  var _closeModal = null;
  var _toast = null;

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', 'readonly');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      var copied = document.execCommand('copy');
      document.body.removeChild(field);
      if (copied) resolve();
      else reject(new Error('Le navigateur a refusé la copie. Copiez le prompt manuellement.'));
    });
  }

  function parseResponse(text) {
    var json = String(text || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    var result = JSON.parse(json);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('La réponse doit être un objet JSON.');
    }
    return result;
  }

  function demarrer(request, answers, candidates, callbacks) {
    if (!_openModal || !_closeModal) throw new Error('Le pont Claude Code n’est pas initialisé.');
    var prompt = HQ.prompt.construirePromptCompact(request, answers, candidates);
    var promptField = el('textarea.input.pont-prompt', {
      rows: '12',
      readonly: 'readonly',
      'aria-label': 'Prompt à copier dans Claude Code'
    });
    promptField.value = prompt;

    var copyBtn = el('button.btn.btn--sm', { type: 'button', text: '⎘ Copier le prompt' });
    var copyStatus = el('span.field-hint', { role: 'status' });
    copyBtn.addEventListener('click', function () {
      copyBtn.disabled = true;
      copyText(prompt).then(function () {
        copyStatus.textContent = 'Prompt copié — collez-le dans Claude Code.';
        if (_toast) _toast('Prompt copié — collez-le dans Claude Code.', 'ok');
      }).catch(function (err) {
        copyStatus.textContent = err.message;
        if (_toast) _toast(err.message, 'err');
      }).finally(function () { copyBtn.disabled = false; });
    });

    var responseField = el('textarea.input.pont-response', {
      rows: '8',
      placeholder: 'Collez ici le JSON retourné par Claude Code…',
      'aria-label': 'Réponse JSON de Claude Code'
    });
    var error = el('p.cadrage-error', { role: 'alert', hidden: true });
    var body = el('div.pont-dialog', {}, [
      el('p.cadrage-intro', {
        text: 'Aucun appel réseau : copiez le prompt dans Claude Code, puis collez uniquement le JSON de son plan.'
      }),
      el('label.cadrage-field', {}, [
        el('span.cadrage-field__label', { text: 'Prompt compact' }),
        promptField
      ]),
      el('div.pont-actions', {}, [copyBtn, copyStatus]),
      el('label.cadrage-field', {}, [
        el('span.cadrage-field__label', { text: 'Réponse JSON' }),
        responseField
      ]),
      error
    ]);

    var cancel = el('button.btn.btn--ghost', {
      type: 'button', text: 'Annuler', 'data-close': '1'
    });
    var apply = el('button.btn.btn--primary', {
      type: 'button', text: 'Construire le plan'
    });
    apply.addEventListener('click', function () {
      error.textContent = '';
      error.hidden = true;
      try {
        var response = parseResponse(responseField.value);
        var plan = HQ.planner.construirePlan(response, answers, request);
        if (callbacks && callbacks.onApply) callbacks.onApply(plan);
        _closeModal();
      } catch (e) {
        error.textContent = 'Réponse non appliquée : ' + (e.message || 'JSON invalide.');
        error.hidden = false;
        responseField.focus();
        if (callbacks && callbacks.onError) callbacks.onError(e);
      }
    });
    cancel.addEventListener('click', function () {
      if (callbacks && callbacks.onCancel) callbacks.onCancel();
    });
    _openModal('Pont Claude Code', body, [cancel, apply]);
  }

  function wire(openModal, closeModal, toast) {
    _openModal = openModal;
    _closeModal = closeModal;
    _toast = toast;
  }

  HQ.uiPont = { wire: wire, demarrer: demarrer };
})();
