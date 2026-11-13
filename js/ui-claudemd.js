/* ============================================================
   ui-claudemd.js — modale d'édition du CLAUDE.md
   Expose HQ.uiClaudemd = { wire(openFn, closeFn, toast), updateChip() }
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  var D   = HQ.dom;
  var KEY = 'hq.claudemd';

  function getStoredText() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  function storeText(text) {
    try { localStorage.setItem(KEY, text || ''); } catch (e) {}
  }

  function updateChip() {
    var chip = D.byId('val-claudemd');
    if (!chip) return;
    var text = getStoredText();
    if (!text) { chip.textContent = 'non chargé'; return; }
    var kb = Math.round(text.length / 100) / 10;
    chip.textContent = kb + ' ko';
  }

  function openEditor(openFn, closeFn, toast) {
    var currentText = getStoredText();

    var textarea = document.createElement('textarea');
    textarea.className   = 'claudemd-editor';
    textarea.value       = currentText;
    textarea.placeholder = 'Collez votre CLAUDE.md ici, ou chargez un fichier…';
    textarea.rows        = 18;
    textarea.setAttribute('aria-label', 'Contenu du CLAUDE.md');

    var info = D.el('p.claudemd-info', {
      text: currentText
        ? currentText.length + ' car. · ' + currentText.split('\n').length + ' lignes'
        : 'Aucun contenu — collez ou chargez votre CLAUDE.md'
    });

    textarea.addEventListener('input', function () {
      var n = textarea.value.length;
      info.textContent = n > 0
        ? n + ' car. · ' + textarea.value.split('\n').length + ' lignes'
        : 'Aucun contenu';
    });

    /* Charger un fichier */
    var loadBtn = D.el('button.btn.btn--ghost', { type: 'button', text: '↑ Charger un .md' });
    loadBtn.addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type   = 'file';
      inp.accept = '.md,.txt';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          textarea.value = e.target.result;
          textarea.dispatchEvent(new Event('input'));
        };
        reader.readAsText(f, 'UTF-8');
      });
      inp.click();
    });

    /* Exporter */
    var exportBtn = D.el('button.btn.btn--ghost', { type: 'button', text: '↓ Exporter' });
    exportBtn.addEventListener('click', function () {
      var text = textarea.value;
      if (!text) { toast('Aucun contenu à exporter', 'warn'); return; }
      var blob = new Blob([text], { type: 'text/markdown' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = 'CLAUDE.md';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    /* Effacer */
    var clearBtn = D.el('button.btn.btn--ghost', { type: 'button', text: 'Effacer' });
    clearBtn.addEventListener('click', function () {
      if (!window.confirm('Supprimer le CLAUDE.md chargé ?')) return;
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
    });

    /* Fermer */
    var closeBtn = D.el('button.btn.btn--ghost', {
      type: 'button', text: 'Fermer', 'data-close': '1'
    });

    /* Enregistrer */
    var saveBtn = D.el('button.btn', { type: 'button', text: 'Enregistrer' });
    saveBtn.addEventListener('click', function () {
      var text = textarea.value;
      storeText(text);
      if (HQ.prompt && HQ.prompt.setClaudemdText) HQ.prompt.setClaudemdText(text);
      updateChip();
      toast('CLAUDE.md enregistré', 'ok');
      closeFn();
    });

    var body = D.el('div', {}, [info, textarea]);
    var foot = D.el('div.claudemd-foot', {}, [loadBtn, exportBtn, clearBtn, closeBtn, saveBtn]);
    openFn('CLAUDE.md', body, foot);
  }

  function wire(openFn, closeFn, toast) {
    updateChip();
    var btn = D.byId('btn-claudemd');
    if (!btn) return;
    D.on(btn, 'click', function () { openEditor(openFn, closeFn, toast); });
  }

  HQ.uiClaudemd = { wire: wire, updateChip: updateChip };
})();
