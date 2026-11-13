/* ============================================================
   ui-dictionary.js — interface de chargement du dictionnaire.
   Expose HQ.uiDictionary = { wire(openModal, closeModal, toast) }
   Dépendances : dom.js, dictionary.js (chargés avant ce fichier)
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  /* ---- fichier → index ------------------------------------- */
  function loadFile(file, toast) {
    var valEl = document.getElementById('val-dictionary');
    if (valEl) valEl.textContent = '…';   /* … */

    var reader = new FileReader();

    reader.onload = function (e) {
      try {
        var data   = JSON.parse(e.target.result);
        var report = HQ.dictionary.load(data);

        if (valEl) valEl.textContent = report.total + ' tables';

        /* rafraîchir le schéma pour les badges de fiabilité */
        if (HQ.renderSchema) HQ.renderSchema.render();
        if (HQ.renderFinal)  HQ.renderFinal.render();

        if (HQ.ui) HQ.ui.closeModal();

        var msg = report.total + ' tables indexées · ' + report.linkCount + ' liens extraits';
        if (report.confirmed.length)    msg += ' · ' + report.confirmed.length    + ' table(s) du schéma confirmée(s)';
        if (report.stillSupposed.length) msg += ' · ' + report.stillSupposed.length + ' encore supposée(s)';
        if (toast) toast(msg, 'ok', 5200);

      } catch (err) {
        if (valEl) valEl.textContent = 'erreur';
        if (toast) toast('Erreur de lecture : ' + err.message, 'err');
      }
    };

    reader.onerror = function () {
      if (valEl) valEl.textContent = 'erreur';
      if (toast) toast('Impossible de lire le fichier', 'err');
    };

    reader.readAsText(file, 'utf-8');
  }

  /* ---- zone de glisser-déposer + input file ---------------- */
  function buildDropZone(toast) {
    var el = HQ.dom.el;

    var input = document.createElement('input');
    input.type    = 'file';
    input.accept  = '.json';
    input.id      = 'dict-file-input';
    input.style.display = 'none';

    var label = document.createElement('label');
    label.className = 'btn';
    label.setAttribute('for', 'dict-file-input');
    label.textContent = 'Choisir le fichier JSON';

    var zone = el('div.dict-dropzone', {
      tabindex: '0',
      role: 'button',
      'aria-label': 'Zone de chargement du dictionnaire JSON — glisser-déposer ou cliquer'
    }, [
      el('p', { text: 'Glisser-déposer le dictionnaire ici' }),
      el('p.dict-or', { text: 'ou' }),
      label,
      input
    ]);

    zone.addEventListener('click', function (e) {
      if (e.target !== input && e.target !== label) input.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { input.click(); e.preventDefault(); }
    });
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('dict-dropzone--over');
    });
    zone.addEventListener('dragleave', function () {
      zone.classList.remove('dict-dropzone--over');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('dict-dropzone--over');
      var file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) loadFile(file, toast);
    });
    input.addEventListener('change', function () {
      if (input.files[0]) loadFile(input.files[0], toast);
    });

    return zone;
  }

  /* ---- corps de la modale ---------------------------------- */
  function buildModalBody(toast) {
    var el = HQ.dom.el;

    if (HQ.dictionary && HQ.dictionary.isLoaded()) {
      var stats  = HQ.dictionary.getStats();
      var report = HQ.dictionary.getReport();
      var items  = [
        el('p.dict-summary', { text: stats.total + ' tables indexées · ' + stats.linkCount + ' liens extraits' })
      ];
      if (report.confirmed.length) {
        items.push(el('p.dict-ok', {
          text: '✓ Confirmées dans le schéma : ' + report.confirmed.join(', ')
        }));
      }
      if (report.stillSupposed.length) {
        items.push(el('p.dict-warn', {
          text: '❓ Encore supposées : ' + report.stillSupposed.join(', ')
        }));
      }
      items.push(el('p.dict-hint', { text: 'Pour recharger un autre dictionnaire :' }));
      items.push(buildDropZone(toast));
      return el('div.dict-report', {}, items);
    }

    return buildDropZone(toast);
  }

  /* ---- branchement principal ------------------------------- */
  function wire(openModal, closeModal, toast) {
    var btn = document.getElementById('btn-dictionary');
    if (!btn) return;

    btn.addEventListener('click', function () {
      openModal(
        'Dictionnaire de données',
        buildModalBody(toast),
        (function () {
          var el  = HQ.dom.el;
          var btn = el('button.btn', { type: 'button', 'data-close': '1', text: 'Fermer' });
          return btn;
        })()
      );
    });
  }

  HQ.uiDictionary = { wire: wire };
})();
