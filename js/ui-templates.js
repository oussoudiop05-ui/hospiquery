/* ============================================================
   ui-templates.js — Modèles prêts-à-l'emploi & historique (LOT 10)
   Ouvre une modale depuis le chip "Modèles" en topbar.
   Expose HQ.uiTemplates = { wire }
   ============================================================ */
(function () {
  'use strict';
  window.HQ = window.HQ || {};

  var D = HQ.dom;
  var HIST_KEY  = 'hq.history';
  var HIST_MAX  = 10;
  var saveTimer = null;
  var lastSaved = '';

  /* ============================================================
     MODÈLES PRÉDÉFINIS — 3 extractions PMSI standard
     ============================================================ */
  var TEMPLATES = [
    {
      key:       'mco-sejours',
      title:     'Séjours MCO hospitalisés',
      desc:      'TB_SEJOUR + TB_SYNTH_RSS + TB_PATIENT — extraction standard hospitalisations',
      state: {
        request:     'Séjours MCO hospitalisés',
        granularity: '1 ligne = 1 séjour (RSS terminé)',
        nodes: [
          {
            id: 'ns1', name: 'TB_SEJOUR', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 séjour',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_SEJOUR',   type: 'int',      checked: true,  isKey: true,  filter: '', alias: '', label: 'clé technique du séjour' },
              { name: 'NO_SEJOUR',   type: 'varchar',  checked: true,  isKey: false, filter: '', alias: '', label: 'n° de séjour officiel' },
              { name: 'ID_PATIENT',  type: 'int',      checked: false, isKey: true,  filter: '', alias: '', label: 'lien obligatoire vers TB_PATIENT' },
              { name: 'IPP_PATIENT', type: 'varchar',  checked: true,  isKey: false, filter: '', alias: '', label: 'IPP (redondant avec TB_PATIENT.IPP_PATIENT)' },
              { name: 'DATE_ENTREE', type: 'date',     checked: true,  isKey: false, filter: '', alias: '', label: 'date d\'entrée (obligatoire)' },
              { name: 'DATE_SORTIE', type: 'date',     checked: true,  isKey: false, filter: '', alias: '', label: 'date de sortie' },
              { name: 'MODE_ENTREE', type: 'char(1)',  checked: true,  isKey: false, filter: '', alias: '', label: '0/6/7/8 — 6=mutation, 8=domicile' },
              { name: 'MODE_SORTIE', type: 'char(1)',  checked: true,  isKey: false, filter: '', alias: '', label: '0/6/7/8/9 — 9=décès' },
              { name: 'CODE_POSTAL', type: 'varchar',  checked: false, isKey: false, filter: '', alias: '', label: 'code postal au moment du séjour' }
            ]
          },
          {
            id: 'ns2', name: 'TB_SYNTH_RSS', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 RSS',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_RSS',       type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'clé RSS' },
              { name: 'ID_SEJOUR',    type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'lien obligatoire vers TB_SEJOUR' },
              { name: 'CODE_CMD',     type: 'char(2)', checked: true,  isKey: false, filter: '', alias: '', label: 'catégorie majeure de diagnostics' },
              { name: 'CODE_GHM',     type: 'char(4)', checked: true,  isKey: false, filter: '', alias: '', label: 'code GHM (4 car.)' },
              { name: 'CODE_GHS',     type: 'char(4)', checked: true,  isKey: false, filter: '', alias: '', label: 'code GHS (4 car.)' },
              { name: 'DP_RETENU',    type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'code DP retenu par le groupeur' },
              { name: 'DUREE_SEJOUR', type: 'int',     checked: true,  isKey: false, filter: '', alias: '', label: 'durée du RSS en jours' },
              { name: 'AGE_ENTREE',   type: 'int',     checked: true,  isKey: false, filter: '', alias: '', label: 'âge à l\'entrée (calculé par le groupeur)' },
              { name: 'MONTANT_GHS',  type: 'decimal', checked: false, isKey: false, filter: '', alias: '', label: 'montant GHS de base' },
              { name: 'STATUT',       type: 'char(1)', checked: false, isKey: false, filter: 'RAW:STATUT = \'T\'', alias: '', label: 'T = terminé et groupé' },
              { name: 'VALID_DIM',    type: 'char(1)', checked: false, isKey: false, filter: '', alias: '', label: 'O = validé par le DIM' }
            ]
          },
          {
            id: 'ns3', name: 'TB_PATIENT', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'book', grain: '1 ligne = 1 patient',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_PATIENT',  type: 'int',      checked: false, isKey: true,  filter: '', alias: '', label: 'clé technique patient' },
              { name: 'SEXE',        type: 'char(1)',  checked: true,  isKey: false, filter: '', alias: '', label: 'M/H/1 = masc, F/2 = fém — toujours normaliser' },
              { name: 'DATE_NAIS',   type: 'datetime', checked: true,  isKey: false, filter: '', alias: '', label: 'date + heure de naissance' },
              { name: 'DATE_DECES',  type: 'date',     checked: false, isKey: false, filter: '', alias: '', label: 'date de décès' }
            ]
          }
        ],
        joins: [
          { id: 'nj1', from: 'ns1', to: 'ns2', type: 'left', on: [['ID_SEJOUR', 'ID_SEJOUR']], reliability: 'ok',   note: 'Clé technique séjour ✅', copy_to: null },
          { id: 'nj2', from: 'ns1', to: 'ns3', type: 'left', on: [['ID_PATIENT', 'ID_PATIENT']], reliability: 'book', note: 'ID_PATIENT = clé technique patient 📖', copy_to: null }
        ],
        derived: [], finalOrder: [], warnings: []
      }
    },

    {
      key:   'cohorte-diags',
      title: 'Cohorte avec diagnostics',
      desc:  'TB_SEJOUR + TB_SYNTH_RSS + TB_DIAG — cohorte sur un code CIM-10',
      state: {
        request:     'Cohorte diagnostics CIM-10',
        granularity: '1 ligne = 1 diagnostic (⚠ multiplicateur TB_DIAG)',
        nodes: [
          {
            id: 'nd1', name: 'TB_SEJOUR', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 séjour',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_SEJOUR',   type: 'int',     checked: true,  isKey: true,  filter: '', alias: '', label: 'clé technique du séjour' },
              { name: 'NO_SEJOUR',   type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'n° de séjour officiel' },
              { name: 'IPP_PATIENT', type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'IPP' },
              { name: 'DATE_ENTREE', type: 'date',    checked: true,  isKey: false, filter: '', alias: '', label: 'date d\'entrée' },
              { name: 'DATE_SORTIE', type: 'date',    checked: true,  isKey: false, filter: '', alias: '', label: 'date de sortie' }
            ]
          },
          {
            id: 'nd2', name: 'TB_SYNTH_RSS', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 RSS',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_SEJOUR',   type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'lien obligatoire vers TB_SEJOUR' },
              { name: 'CODE_GHM',    type: 'char(4)', checked: true,  isKey: false, filter: '', alias: '', label: 'code GHM' },
              { name: 'DP_RETENU',   type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'DP retenu par le groupeur' },
              { name: 'DUREE_SEJOUR',type: 'int',     checked: true,  isKey: false, filter: '', alias: '', label: 'durée en jours' },
              { name: 'STATUT',      type: 'char(1)', checked: false, isKey: false, filter: 'RAW:STATUT = \'T\'', alias: '', label: 'T = terminé' }
            ]
          },
          {
            id: 'nd3', name: 'TB_DIAG', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 diagnostic (par mouvement)',
            multiplier: { factor: '×nb_diags ×nb_mvts', reason: 'granularité réelle = le mouvement (ID_MVT lien principal)', workaround: 'distinct(ID_SEJOUR, CODE_DIAG, TYPE_DIAG) puis group_by(ID_SEJOUR)' },
            branchOf: null,
            columns: [
              { name: 'ID_DIAG',   type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'clé du diagnostic' },
              { name: 'ID_SEJOUR', type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'lien non principal (lien principal = ID_MVT)' },
              { name: 'CODE_DIAG', type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'code CIM-10' },
              { name: 'TYPE_DIAG', type: 'char(1)', checked: true,  isKey: false, filter: 'IN (\'P\', \'S\', \'R\')', alias: '', label: 'P=Principal S=Significatif R=Relié' },
              { name: 'VERSION_CIM',type:'char(1)', checked: false, isKey: false, filter: 'RAW:(VERSION_CIM IS NULL OR VERSION_CIM <> \'9\')', alias: '', label: '9 = code CIM-9 (récupération) — exclure' }
            ]
          }
        ],
        joins: [
          { id: 'ndj1', from: 'nd1', to: 'nd2', type: 'left', on: [['ID_SEJOUR', 'ID_SEJOUR']], reliability: 'ok',   note: 'Clé technique séjour ✅', copy_to: null },
          { id: 'ndj2', from: 'nd1', to: 'nd3', type: 'left', on: [['ID_SEJOUR', 'ID_SEJOUR']], reliability: 'ok',   note: 'Via ID_SEJOUR (lien non principal) ✅', copy_to: null }
        ],
        derived: [], finalOrder: [], warnings: []
      }
    },

    {
      key:   'actes-ccam',
      title: 'Actes CCAM par UF',
      desc:  'TB_SEJOUR + TB_ACTE + TB_UNITE — extraction des actes CCAM par unité fonctionnelle',
      state: {
        request:     'Actes CCAM par unité fonctionnelle',
        granularity: '1 ligne = 1 acte (⚠ multiplicateur TB_ACTE)',
        nodes: [
          {
            id: 'na1', name: 'TB_SEJOUR', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 séjour',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_SEJOUR',   type: 'int',     checked: true,  isKey: true,  filter: '', alias: '', label: 'clé technique du séjour' },
              { name: 'NO_SEJOUR',   type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'n° de séjour officiel' },
              { name: 'IPP_PATIENT', type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'IPP' },
              { name: 'DATE_ENTREE', type: 'date',    checked: true,  isKey: false, filter: '', alias: '', label: 'date d\'entrée' },
              { name: 'DATE_SORTIE', type: 'date',    checked: false, isKey: false, filter: '', alias: '', label: 'date de sortie' }
            ]
          },
          {
            id: 'na2', name: 'TB_ACTE', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 acte CCAM',
            multiplier: { factor: '×nb_actes', reason: 'N actes CCAM par séjour', workaround: 'filtrer sur CODE_ACTE ou agréger avant de joindre' },
            branchOf: null,
            columns: [
              { name: 'ID_SEJOUR',      type: 'int',       checked: false, isKey: true,  filter: '', alias: '', label: 'lien vers TB_SEJOUR ✅' },
              { name: 'ID_PATIENT',     type: 'int',       checked: false, isKey: true,  filter: '', alias: '', label: 'lien vers TB_PATIENT (ID technique ≠ IPP)' },
              { name: 'CODE_ACTE',      type: 'varchar',   checked: true,  isKey: false, filter: '', alias: '', label: 'code CCAM (4 lettres + 3 chiffres)' },
              { name: 'EXTENSION_ATIH', type: 'char(1)',   checked: true,  isKey: false, filter: '', alias: '', label: 'extension ATIH pour tarification' },
              { name: 'DATE_ACTE',      type: 'varchar',   checked: true,  isKey: false, filter: '', alias: '', label: 'date acte format DD/MM/YYYY avec slashs' },
              { name: 'ID_UNITE_EXEC',  type: 'int',       checked: true,  isKey: true,  filter: '', alias: '', label: 'clé de l\'UF exécutante → TB_UNITE.ID_UNITE ✅' }
            ]
          },
          {
            id: 'na3', name: 'TB_UNITE', schema: 'dbo',
            source: 'CORA RECUEIL (con2)', conn: 'con2',
            reliability: 'ok', grain: '1 ligne = 1 UF',
            multiplier: null, branchOf: null,
            columns: [
              { name: 'ID_UNITE',       type: 'int',     checked: false, isKey: true,  filter: '', alias: '', label: 'clé technique de l\'UF' },
              { name: 'CODE_UNITE',     type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'code UF (5 car.)' },
              { name: 'LIBELLE_UNITE',  type: 'varchar', checked: true,  isKey: false, filter: '', alias: '', label: 'libellé de l\'UF' }
            ]
          }
        ],
        joins: [
          { id: 'naj1', from: 'na1', to: 'na2', type: 'left', on: [['ID_SEJOUR', 'ID_SEJOUR']], reliability: 'ok', note: 'Clé technique séjour ✅ — ⚠ multiplicateur', copy_to: null },
          { id: 'naj2', from: 'na2', to: 'na3', type: 'left', on: [['ID_UNITE_EXEC', 'ID_UNITE']], reliability: 'ok', note: 'UF exécutante → TB_UNITE ✅', copy_to: null }
        ],
        derived: [], finalOrder: [], warnings: []
      }
    }
  ];

  /* ============================================================
     HISTORIQUE — sauvegarde dans localStorage
     ============================================================ */
  function loadHistory() {
    try {
      var h = localStorage.getItem(HIST_KEY);
      return h ? JSON.parse(h) : [];
    } catch (e) { return []; }
  }

  function saveToHistory(state) {
    if (!state.nodes || !state.nodes.length) return;
    var snap = JSON.stringify(state);
    if (snap === lastSaved) return;
    lastSaved = snap;
    var entry = {
      ts:    Date.now(),
      title: state.request || 'Sans titre',
      count: state.nodes.length,
      state: snap
    };
    var history = loadHistory();
    history.unshift(entry);
    if (history.length > HIST_MAX) history = history.slice(0, HIST_MAX);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e) { /* full */ }
  }

  function debounceSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveToHistory(HQ.store.getState());
    }, 2500);
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ============================================================
     MODALE MODÈLES
     ============================================================ */
  function buildModalContent(openModal, closeModal, toast) {
    var body = D.el('div.tpl-modal-body', {});

    /* -- Section 1 : modèles prédéfinis -- */
    var sec1 = D.el('div.tpl-section', {}, [
      D.el('h3.tpl-section-title', { text: 'Démarrer depuis un modèle' })
    ]);
    var btnGroup = D.el('div.tpl-btn-group', {});
    TEMPLATES.forEach(function (tpl) {
      var btn = D.el('button.tpl-btn', { type: 'button' }, [
        D.el('span.tpl-btn__title', { text: tpl.title }),
        D.el('span.tpl-btn__desc',  { text: tpl.desc })
      ]);
      btn.onclick = function () {
        HQ.store.patch(function (s) {
          return Object.assign({}, s, {
            request:     tpl.state.request,
            granularity: tpl.state.granularity,
            nodes:       JSON.parse(JSON.stringify(tpl.state.nodes)),
            joins:       JSON.parse(JSON.stringify(tpl.state.joins)),
            derived:     [],
            finalOrder:  [],
            warnings:    []
          });
        });
        closeModal();
        toast('Modèle « ' + tpl.title + ' » chargé.', 'ok');
      };
      btnGroup.appendChild(btn);
    });
    sec1.appendChild(btnGroup);
    body.appendChild(sec1);

    /* -- Section 2 : historique -- */
    var history = loadHistory();
    var sec2 = D.el('div.tpl-section', {}, [
      D.el('h3.tpl-section-title', { text: 'Historique des extractions' })
    ]);
    if (!history.length) {
      sec2.appendChild(D.el('p.empty-note', { text: 'Aucune extraction sauvegardée pour l\'instant.' }));
    } else {
      var list = D.el('div.hist-list', {});
      history.forEach(function (entry, idx) {
        var info = D.el('div.hist-item__info', {}, [
          D.el('span.hist-item__title', { text: entry.title }),
          D.el('span.hist-item__ts',    { text: fmtDate(entry.ts) + ' — ' + entry.count + ' tables' })
        ]);
        var restoreBtn = D.el('button.btn.btn--sm', { type: 'button', text: 'Restaurer' });
        var delBtn     = D.el('button.btn.btn--sm.btn--ghost', { type: 'button', text: '✕', 'aria-label': 'Supprimer de l\'historique' });
        var item = D.el('div.hist-item', {}, [info, restoreBtn, delBtn]);

        restoreBtn.onclick = function () {
          try {
            var restored = JSON.parse(entry.state);
            HQ.store.patch(function (s) { return Object.assign({}, s, restored); });
            closeModal();
            toast('Extraction « ' + entry.title + ' » restaurée.', 'ok');
          } catch (e) { toast('Erreur lors de la restauration.', 'err'); }
        };
        delBtn.onclick = function () {
          var h = loadHistory();
          h.splice(idx, 1);
          try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) { /* */ }
          item.remove();
          if (!list.children.length) {
            list.remove();
            sec2.appendChild(D.el('p.empty-note', { text: 'Historique vidé.' }));
          }
        };
        list.appendChild(item);
      });
      sec2.appendChild(list);

      /* Bouton vider tout */
      var clearBtn = D.el('button.btn.btn--sm.btn--ghost', { type: 'button', text: 'Vider l\'historique' });
      clearBtn.style.marginTop = 'var(--sp-3)';
      clearBtn.onclick = function () {
        try { localStorage.removeItem(HIST_KEY); } catch (e) { /* */ }
        lastSaved = '';
        closeModal();
        toast('Historique vidé.', 'ok');
      };
      sec2.appendChild(clearBtn);
    }
    body.appendChild(sec2);

    return body;
  }

  /* ============================================================
     CÂBLAGE
     ============================================================ */
  function wire(openModal, closeModal, toast) {
    /* Chip "Modèles" dans la topbar */
    var chip = D.byId('btn-models');
    if (chip) {
      D.on(chip, 'click', function () {
        openModal(
          'Modèles & Historique',
          buildModalContent(openModal, closeModal, toast),
          null
        );
      });
    }

    /* Sauvegarder l'état dans l'historique à chaque modification */
    HQ.store.subscribe(function (what) {
      if (!what || what === 'state') debounceSave();
    });
  }

  HQ.uiTemplates = { wire: wire };
})();
