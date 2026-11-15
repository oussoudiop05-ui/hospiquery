/* ============================================================
   cadrage.js — formulaire local des huit questions PMSI.
   Aucun appel réseau.
   Expose HQ.cadrage
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var D = HQ.dom;
  var el = D.el;

  var MOIS = {
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
    juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12
  };

  function normalizeQuery(value) {
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ');
  }

  function dateStamp(year, month, day) {
    return String(year) + String(month).padStart(2, '0') + String(day).padStart(2, '0');
  }

  function parseYearFromQuery(query) {
    var q = normalizeQuery(query);
    var currentYear = new Date().getFullYear();
    var match;

    if (/\bl annee derniere\b|\bl an dernier\b/.test(q)) {
      return { dateDebut: dateStamp(currentYear - 1, 1, 1), dateFin: dateStamp(currentYear - 1, 12, 31) };
    }
    if (/\bcette annee\b|\ben cours\b/.test(q)) {
      return { dateDebut: dateStamp(currentYear, 1, 1), dateFin: dateStamp(currentYear, 12, 31) };
    }
    if (/\b12 derniers? mois\b/.test(q)) {
      var end = new Date();
      var start = new Date(end.getTime());
      start.setFullYear(start.getFullYear() - 1);
      return {
        dateDebut: dateStamp(start.getFullYear(), start.getMonth() + 1, start.getDate()),
        dateFin: dateStamp(end.getFullYear(), end.getMonth() + 1, end.getDate())
      };
    }

    match = q.match(/\b(?:au|durant le|durant|pendant le|pendant|de|entre)\s+(?:premier|1er|1e|1)\s+trimestre\s+(20\d{2})\b/);
    if (match) return { dateDebut: match[1] + '0101', dateFin: match[1] + '0331' };
    match = q.match(/\b(?:au|durant|pendant)\s+(?:deuxieme|2e|2eme|2)\s+trimestre\s+(20\d{2})\b/);
    if (match) return { dateDebut: match[1] + '0401', dateFin: match[1] + '0630' };
    match = q.match(/\b(?:au|durant|pendant)\s+(?:troisieme|3e|3eme|3)\s+trimestre\s+(20\d{2})\b/);
    if (match) return { dateDebut: match[1] + '0701', dateFin: match[1] + '0930' };
    match = q.match(/\b(?:au|durant|pendant)\s+(?:quatrieme|4e|4eme|4)\s+trimestre\s+(20\d{2})\b/);
    if (match) return { dateDebut: match[1] + '1001', dateFin: match[1] + '1231' };

    var monthNames = Object.keys(MOIS).join('|');
    match = q.match(new RegExp('\\bentre\\s+(' + monthNames + ')\\s+et\\s+(' + monthNames + ')\\s+(20\\d{2})\\b'));
    if (match) {
      var firstMonth = MOIS[match[1]], lastMonth = MOIS[match[2]], year = Number(match[3]);
      if (firstMonth <= lastMonth) {
        return {
          dateDebut: dateStamp(year, firstMonth, 1),
          dateFin: dateStamp(year, lastMonth, new Date(year, lastMonth, 0).getDate())
        };
      }
    }

    match = q.match(/\b(?:entre|de|en)\s+(20\d{2})\s*(?:et|a|-)\s*(20\d{2})\b/);
    if (match && Number(match[1]) <= Number(match[2])) {
      return { dateDebut: match[1] + '0101', dateFin: match[2] + '1231' };
    }

    match = q.match(/\b(?:en|annee)\s*(20\d{2})\b/) || q.match(/\b(20\d{2})\b/);
    if (match) {
      var singleYear = match[1] || match[0];
      return { dateDebut: singleYear + '0101', dateFin: singleYear + '1231' };
    }
    return null;
  }

  var QUESTIONS = [
    {
      id: 'bornes',
      libelle: 'Borner la période sur…',
      type: 'radio',
      options: [
        { value: 'entree', label: 'Date d’entrée' },
        { value: 'sortie', label: 'Date de sortie' },
        { value: 'acte', label: 'Date de l’acte / intervention' }
      ],
      defaut: 'sortie'
    },
    {
      id: 'periode',
      libelle: 'Période',
      type: 'dates',
      defaut: { debut: '', fin: '' }
    },
    {
      id: 'champ',
      libelle: 'Champ PMSI',
      type: 'checkboxes',
      options: [
        { value: 'MCO', label: 'MCO' },
        { value: 'SSR', label: 'SSR' },
        { value: 'HAD', label: 'HAD' },
        { value: 'PSY', label: 'PSY' }
      ],
      defaut: ['MCO']
    },
    {
      id: 'typePassage',
      libelle: 'Type de passage',
      type: 'checkboxes',
      options: [
        { value: '2', label: 'Hospitalisations' },
        { value: '1', label: 'Urgences' },
        { value: '3', label: 'Consultations' },
        { value: '4', label: 'Séances' }
      ],
      defaut: ['2']
    },
    {
      id: 'granularite',
      libelle: 'Une ligne du résultat =',
      type: 'select',
      options: [
        { value: 'sejour', label: '1 séjour' },
        { value: 'rss', label: '1 RSS' },
        { value: 'rum', label: '1 RUM' },
        { value: 'diagnostic', label: '1 diagnostic' },
        { value: 'acte', label: '1 acte' },
        { value: 'patient', label: '1 patient' }
      ],
      defaut: 'sejour'
    },
    {
      id: 'enCours',
      libelle: 'Séjours en cours (sans date de sortie)',
      type: 'radio',
      options: [
        { value: 'exclure', label: 'Exclure' },
        { value: 'inclure', label: 'Inclure' }
      ],
      defaut: 'exclure'
    },
    {
      id: 'perimetre',
      libelle: 'Périmètre structurel',
      type: 'text',
      defaut: '',
      aide: 'Laisser vide pour tout l’établissement ; sinon indiquer les codes UF, pôle ou service.'
    },
    {
      id: 'mutations',
      libelle: 'Mutations internes (MODE_ENTREE 6x)',
      type: 'radio',
      options: [
        { value: 'inclure', label: 'Inclure' },
        { value: 'exclure', label: 'Exclure' }
      ],
      defaut: 'inclure'
    }
  ];

  function makeFieldset(question, children) {
    return el('fieldset.cadrage-question', {}, [
      el('legend.cadrage-question__legend', { text: question.libelle })
    ].concat(children));
  }

  function choice(question, option, type) {
    var input = el('input', {
      type: type,
      name: question.id,
      value: option.value
    });
    input.checked = type === 'checkbox'
      ? question.defaut.indexOf(option.value) >= 0
      : question.defaut === option.value;
    return el('label.cadrage-choice', {}, [
      input,
      el('span', { text: option.label })
    ]);
  }

  function renderQuestion(question) {
    if (question.type === 'radio' || question.type === 'checkboxes') {
      var type = question.type === 'radio' ? 'radio' : 'checkbox';
      return makeFieldset(question, [
        el('div.cadrage-choices', {}, question.options.map(function (option) {
          return choice(question, option, type);
        }))
      ]);
    }

    if (question.type === 'dates') {
      var start = el('input.cadrage-input.input', {
        type: 'text', name: 'debut', maxlength: '8', inputmode: 'numeric',
        autocomplete: 'off', 'aria-label': 'Date de début au format AAAAMMJJ'
      });
      start.value = question.defaut.debut;
      var end = el('input.cadrage-input.input', {
        type: 'text', name: 'fin', maxlength: '8', inputmode: 'numeric',
        autocomplete: 'off', 'aria-label': 'Date de fin au format AAAAMMJJ'
      });
      end.value = question.defaut.fin;
      return makeFieldset(question, [
        el('div.cadrage-date-range', {}, [
          el('label.cadrage-field', {}, [
            el('span.cadrage-field__label', { text: 'Du' }),
            start
          ]),
          el('label.cadrage-field', {}, [
            el('span.cadrage-field__label', { text: 'Au' }),
            end
          ])
        ]),
        el('p.cadrage-help', { text: 'Format attendu : AAAAMMJJ (ex. 20230101).' })
      ]);
    }

    if (question.type === 'select') {
      var select = el('select.cadrage-input.input', { name: question.id }, question.options.map(function (option) {
        return el('option', { value: option.value, text: option.label });
      }));
      select.value = question.defaut;
      return makeFieldset(question, [select]);
    }

    var text = el('input.cadrage-input.input', {
      type: 'text', name: question.id, value: question.defaut,
      autocomplete: 'off'
    });
    var children = [text];
    if (question.aide) children.push(el('p.cadrage-help', { text: question.aide }));
    return makeFieldset(question, children);
  }

  function renderForm(request) {
    var detectedPeriod = parseYearFromQuery(request);
    var questions = QUESTIONS.map(function (question) {
      var copy = Object.assign({}, question);
      if (question.id === 'periode' && detectedPeriod) {
        copy.defaut = { debut: detectedPeriod.dateDebut, fin: detectedPeriod.dateFin };
      }
      if (question.id === 'granularite' && HQ.planner && HQ.planner.detecterGrain) {
        copy.defaut = HQ.planner.detecterGrain(request);
      }
      if (question.id === 'bornes' && /\b(acte|actes|ccam|chirurg\w*|intervention|oper\w*)\b/.test(normalizeQuery(request))) {
        copy.defaut = 'acte';
      }
      return copy;
    });
    var requestInput = el('textarea.cadrage-request.input', {
      name: 'request', rows: '2', required: true,
      'aria-label': 'Demande d’extraction'
    });
    requestInput.value = request || '';

    var form = el('form#cadrage-form.cadrage-form', {
      'aria-label': 'Questions de cadrage de l’extraction'
    }, [
      el('p.cadrage-intro', {
        text: 'Ces réponses sont traitées localement. Aucun appel à l’API n’est fait avant votre validation.'
      }),
      el('label.cadrage-field', {}, [
        el('span.cadrage-field__label', { text: 'Demande d’extraction' }),
        requestInput
      ])
    ].concat(questions.map(renderQuestion)).concat([
      el('p.cadrage-error', { role: 'alert', hidden: true })
    ]));
    form.noValidate = true;
    return form;
  }

  function checkedValues(form, name) {
    return Array.prototype.map.call(
      form.querySelectorAll('input[name="' + name + '"]:checked'),
      function (input) { return input.value; }
    );
  }

  function readForm(form) {
    return {
      request: form.elements.request.value.trim(),
      bornes: form.querySelector('input[name="bornes"]:checked').value,
      periode: {
        debut: form.elements.debut.value.trim(),
        fin: form.elements.fin.value.trim()
      },
      champ: checkedValues(form, 'champ'),
      typePassage: checkedValues(form, 'typePassage'),
      granularite: form.elements.granularite.value,
      enCours: form.querySelector('input[name="enCours"]:checked').value,
      perimetre: form.elements.perimetre.value.trim(),
      mutations: form.querySelector('input[name="mutations"]:checked').value
    };
  }

  function isValidDate(value) {
    if (!/^\d{8}$/.test(value)) return false;
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(4, 6));
    var day = Number(value.slice(6, 8));
    if (month < 1 || month > 12 || day < 1) return false;
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  function validate(form) {
    var values = readForm(form);
    if (!values.request) return { valid: false, message: 'Décrivez la demande d’extraction.' };
    if (!isValidDate(values.periode.debut) || !isValidDate(values.periode.fin)) {
      return { valid: false, message: 'Les deux dates doivent être valides au format AAAAMMJJ.' };
    }
    if (values.periode.debut > values.periode.fin) {
      return { valid: false, message: 'La date de début doit précéder ou égaler la date de fin.' };
    }
    if (!values.champ.length) return { valid: false, message: 'Sélectionnez au moins un champ PMSI.' };
    if (!values.typePassage.length) return { valid: false, message: 'Sélectionnez au moins un type de passage.' };
    return { valid: true, values: values };
  }

  function showError(form, message) {
    var error = form.querySelector('.cadrage-error');
    error.textContent = message;
    error.hidden = false;
  }

  function clearError(form) {
    var error = form.querySelector('.cadrage-error');
    error.textContent = '';
    error.hidden = true;
  }

  function enTexte(reponses) {
    var granularite = {
      sejour: 'séjour',
      rss: 'RSS',
      rum: 'RUM',
      diagnostic: 'diagnostic',
      acte: 'acte',
      patient: 'patient'
    };
    return [
      'CADRAGE (réponses de l’utilisateur) :',
      '- Bornes : ' + (reponses.bornes === 'acte' ? 'date de l’acte / intervention'
        : 'date de ' + (reponses.bornes === 'sortie' ? 'sortie' : 'entrée')) +
        ', du ' + reponses.periode.debut + ' au ' + reponses.periode.fin,
      '- Champ PMSI : ' + reponses.champ.join(', '),
      '- Type de passage : ' + reponses.typePassage.join(', '),
      '- Granularité : 1 ligne = 1 ' + (granularite[reponses.granularite] || reponses.granularite),
      '- Séjours en cours : ' + reponses.enCours,
      '- Périmètre structurel : ' + (reponses.perimetre || 'tout l’établissement'),
      '- Mutations internes : ' + reponses.mutations
    ].join('\n');
  }

  HQ.cadrage = {
    QUESTIONS: QUESTIONS,
    parseYearFromQuery: parseYearFromQuery,
    renderForm: renderForm,
    validate: validate,
    showError: showError,
    clearError: clearError,
    enTexte: enTexte
  };
})();
