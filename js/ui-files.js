/* ============================================================
   ui-files.js — onglet Fichiers externes
   Permet de déclarer un fichier local (Excel/CSV/SAS) qui apparaît
   dans le schéma comme une carte en pointillés.
   Expose HQ.uiFiles = { wire(toast) }
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  var D = HQ.dom;

  var FILE_TYPES = {
    excel: 'Excel (.xlsx/.xls)',
    csv:   'CSV',
    sas:   'SAS (.sas7bdat)'
  };

  function fileNodes() {
    return (HQ.store.getState().nodes || []).filter(function (n) { return n.kind === 'file'; });
  }

  function updateChip() {
    var chip = D.byId('val-files');
    if (chip) chip.textContent = String(fileNodes().length);
  }

  function renderList(container, toast) {
    D.clear(container);
    var files = fileNodes();

    if (!files.length) {
      container.appendChild(D.el('p.empty-note', { text: 'Aucun fichier déclaré.' }));
      return;
    }

    files.forEach(function (node) {
      var cols  = (node.columns || []).length;
      var label = (FILE_TYPES[node.fileType] || node.fileType || '?')
                + (cols ? ' · ' + cols + ' col.' : '');

      var removeBtn = D.el('button.btn.btn--ghost.btn--sm', {
        type: 'button', text: '×',
        title: 'Retirer ' + node.name, 'aria-label': 'Retirer ' + node.name
      });
      removeBtn.addEventListener('click', function () {
        HQ.store.patch(function (copy) {
          copy.nodes = copy.nodes.filter(function (n) { return n.id !== node.id; });
          copy.joins = (copy.joins || []).filter(function (j) {
            return j.from !== node.id && j.to !== node.id;
          });
          return copy;
        });
        toast('Fichier « ' + node.name + ' » retiré', 'ok');
      });

      container.appendChild(D.el('div.files-item', {}, [
        D.el('span.files-item__name', { text: node.name }),
        D.el('span.files-item__type', { text: label }),
        removeBtn
      ]));
    });
  }

  function buildPane(toast) {
    var pane = D.byId('pane-files');
    if (!pane) return;
    D.clear(pane);

    /* Formulaire de déclaration */
    var nameInput = document.createElement('input');
    nameInput.type      = 'text';
    nameInput.className = 'form-input';
    nameInput.placeholder = 'Nom du fichier (ex: liste_IEP)';
    nameInput.setAttribute('aria-label', 'Nom du fichier');

    var typeSelect = document.createElement('select');
    typeSelect.className = 'form-input';
    typeSelect.setAttribute('aria-label', 'Type de fichier');
    Object.keys(FILE_TYPES).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k; opt.textContent = FILE_TYPES[k];
      typeSelect.appendChild(opt);
    });

    var headerInput = document.createElement('textarea');
    headerInput.className   = 'form-input files-headers';
    headerInput.placeholder = 'En-têtes (optionnel) : col1, col2, col3…';
    headerInput.rows        = 3;
    headerInput.setAttribute('aria-label', 'En-têtes du fichier');

    var addBtn = D.el('button.btn', { type: 'button', text: '+ Ajouter au schéma' });
    addBtn.addEventListener('click', function () {
      var name = (nameInput.value || '').trim();
      if (!name) { toast('Donnez un nom au fichier', 'warn'); nameInput.focus(); return; }

      /* Analyser les en-têtes collés */
      var headerText = (headerInput.value || '').trim();
      var cols = headerText
        ? headerText.split(/[\n,;\t]+/).map(function (c) { return c.trim(); }).filter(Boolean)
        : [];

      HQ.store.patch(function (copy) {
        copy.nodes = (copy.nodes || []).concat([{
          id:          'file_' + Date.now(),
          kind:        'file',
          name:        name,
          fileType:    typeSelect.value,
          schema:      'local',
          conn:        'local',
          source:      'Fichier local (' + (FILE_TYPES[typeSelect.value] || typeSelect.value) + ')',
          reliability: 'ok',
          grain:       '1 ligne = 1 enregistrement',
          multiplier:  null,
          branchOf:    null,
          columns:     cols.map(function (c) {
            return { name: c, type: 'varchar', label: c, checked: true,
                     filter: '', alias: '', isKey: false, note: '' };
          })
        }]);
        return copy;
      });

      nameInput.value   = '';
      headerInput.value = '';
      toast('Fichier « ' + name + ' » ajouté au schéma', 'ok');
    });

    /* Liste des fichiers déclarés */
    var list = D.el('div.files-list', {});
    renderList(list, toast);

    /* Mise à jour réactive */
    HQ.store.subscribe(function (what) {
      if (!what || what === 'state') { renderList(list, toast); updateChip(); }
    });

    pane.appendChild(D.el('div.files-form', {}, [
      D.el('label.files-label', { text: 'Nom du fichier' }, [nameInput]),
      D.el('label.files-label', { text: 'Type' },            [typeSelect]),
      D.el('label.files-label', { text: 'En-têtes (optionnel)' }, [headerInput]),
      addBtn
    ]));
    pane.appendChild(list);
  }

  function wire(toast) {
    buildPane(toast);
    updateChip();

    /* Le chip topbar « Fichiers » bascule vers l'onglet */
    var chip = D.byId('btn-files');
    if (chip) {
      D.on(chip, 'click', function () {
        HQ.store.setUI({ activeTab: 'files', dockCollapsed: false });
      });
    }
  }

  HQ.uiFiles = { wire: wire };
})();
