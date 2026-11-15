/* ============================================================
   ui-recipes.js — détection visuelle et formulaire local des recettes.
   Expose HQ.uiRecipes
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  var el = HQ.dom.el;
  var _openModal = null;
  var _closeModal = null;

  function readParameters(form, recipe) {
    var values = {};
    recipe.parametres.forEach(function (parameter) {
      if (parameter.type === 'multi') {
        values[parameter.nom] = Array.prototype.map.call(
          form.querySelectorAll('[name="recipe-' + parameter.nom + '"]:checked'),
          function (input) { return input.value; }
        );
      } else {
        values[parameter.nom] = form.elements['recipe-' + parameter.nom].value.trim();
      }
    });
    return values;
  }

  function parameterField(parameter, request) {
    var name = 'recipe-' + parameter.nom;
    if (parameter.type === 'multi') {
      return el('fieldset.cadrage-question', {}, [
        el('legend.cadrage-question__legend', { text: parameter.libelle })
      ].concat(parameter.options.map(function (option) {
        var input = el('input', { type: 'checkbox', name: name, value: option });
        input.checked = (parameter.defaut || []).indexOf(option) >= 0;
        return el('label.cadrage-choice', {}, [input, el('span', { text: option })]);
      })));
    }

    if (parameter.type === 'select') {
      var select = el('select.input', { name: name, 'aria-label': parameter.libelle });
      (parameter.options || []).forEach(function (option) {
        var optionEl = el('option', { value: option, text: option });
        optionEl.selected = option === parameter.defaut;
        select.appendChild(optionEl);
      });
      return el('label.cadrage-field', {}, [
        el('span.cadrage-field__label', { text: parameter.libelle }),
        select
      ]);
    }

    var inputType = parameter.type === 'nombre' ? 'number' : 'text';
    var defaultValue = parameter.defaut || '';
    if (parameter.extraireCIM) {
      var codes = String(request || '').toUpperCase().match(/\b[A-Z]\d{2}(?:\.\d{1,2})?\b/g) || [];
      if (codes.length) defaultValue = Array.from(new Set(codes)).join(',');
    }
    var input = el('input.input', {
      type: inputType,
      name: name,
      value: defaultValue,
      placeholder: parameter.type === 'date' ? 'AAAAMMJJ' : '',
      'aria-label': parameter.libelle
    });
    if (parameter.type === 'nombre') input.min = '1';
    return el('label.cadrage-field', {}, [
      el('span.cadrage-field__label', { text: parameter.libelle }),
      input
    ]);
  }

  function open(match, request, callbacks) {
    if (!match || !match.recette || !_openModal || !_closeModal) {
      throw new Error('Le module de recettes n’est pas initialisé.');
    }
    var recipe = match.recette;
    var cadrageForm = HQ.cadrage.renderForm(request);
    if (recipe.granularite === 'acte' && HQ.planner.detecterGrain(request) === 'sejour' &&
        !/\bsejours?\b/i.test(String(request || ''))) {
      var grainSelect = cadrageForm.querySelector('select[name="granularite"]');
      if (grainSelect) grainSelect.value = 'acte';
    }
    var parameterForm = el('form.recipe-params', {
      'aria-label': 'Paramètres de la recette ' + recipe.libelle
    }, recipe.parametres.map(function (parameter) { return parameterField(parameter, request); }));
    var error = el('p.cadrage-error', { role: 'alert', hidden: true });
    var body = el('div.recipe-dialog', {}, [
      el('p.cadrage-intro', {
        text: 'Recette locale détectée (' + Math.round(match.score * 100) + ' %). Aucun appel API ne sera effectué.'
      }),
      cadrageForm,
      parameterForm,
      error
    ]);
    var cancel = el('button.btn.btn--ghost', {
      type: 'button', text: 'Annuler', 'data-close': '1'
    });
    var submit = el('button.btn.btn--primary', {
      type: 'button', text: 'Construire le plan local'
    });

    submit.addEventListener('click', function () {
      error.textContent = '';
      error.hidden = true;
      HQ.cadrage.clearError(cadrageForm);
      var cadrage = HQ.cadrage.validate(cadrageForm);
      if (!cadrage.valid) {
        HQ.cadrage.showError(cadrageForm, cadrage.message);
        cadrageForm.querySelector('.cadrage-error').scrollIntoView({ block: 'nearest' });
        return;
      }
      try {
        var parameters = readParameters(parameterForm, recipe);
        if (parameters.seuil && (!/^\d+$/.test(parameters.seuil) || Number(parameters.seuil) < 1)) {
          throw new Error('Le seuil de durée doit être un nombre positif.');
        }
        if (parameters.date && !/^\d{8}$/.test(parameters.date)) {
          throw new Error('La date doit respecter le format AAAAMMJJ.');
        }
        var output = recipe.construire(parameters, cadrage.values, request);
        if (!output.aggregation) output.granularite = cadrage.values.granularite;
        _closeModal();
        if (callbacks && callbacks.onSubmit) callbacks.onSubmit(recipe, output, cadrage.values);
      } catch (e) {
        error.textContent = e.message || 'Impossible de construire cette recette.';
        error.hidden = false;
        if (callbacks && callbacks.onError) callbacks.onError(e);
      }
    });

    _openModal('Recette — ' + recipe.libelle, body, [cancel, submit]);
  }

  function wire(openModal, closeModal) {
    _openModal = openModal;
    _closeModal = closeModal;
  }

  HQ.uiRecipes = { wire: wire, open: open };
})();
