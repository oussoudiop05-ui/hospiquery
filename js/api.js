/* ============================================================
   api.js — client Anthropic + routage des modèles.
   AUCUN accès au DOM dans ce fichier.
   Expose HQ.api
   ============================================================ */
(function () {
  'use strict';

  window.HQ = window.HQ || {};

  /* ---- table de routage ------------------------------------ */
  var ROUTES = {
    'dict.index':        'claude-haiku-5-5',
    'dict.describe':     'claude-haiku-5-5',
    'file.headers':      'claude-haiku-5-5',
    'col.labels':        'claude-haiku-5-5',
    'script.comment':    'claude-haiku-5-5',
    'plan.design':       'sonnet',
    'joins.resolve':     'sonnet',
    'pieges.detect':     'sonnet',
    'chat.reply':        'sonnet',
    'claudemd.enrich':   'sonnet',
    'dict.full_analyze': 'sonnet'
  };

  /* coût approx. en $ / million tokens (input / output) */
  var PRICING = {
    'claude-haiku-5-5':  { in: 0.80,  out: 4.00  },
    'claude-sonnet-4-6': { in: 3.00,  out: 15.00 },
    'claude-sonnet-5-5': { in: 3.00,  out: 15.00 }
  };

  var ANTHROPIC_VERSION = '2023-06-01';
  var DIRECT_URL = 'https://api.anthropic.com/v1/messages';
  var LOCAL_URL  = 'http://localhost:20128/v1/chat/completions';

  /* ---- préférences (localStorage) -------------------------- */
  function getKey()         { try { return localStorage.getItem('hq.apiKey')      || ''; } catch(e) { return ''; } }
  function getEndpoint()    { try { return localStorage.getItem('hq.endpoint')    || 'direct'; } catch(e) { return 'direct'; } }
  function getSonnetModel() { try { return localStorage.getItem('hq.sonnetModel') || 'claude-sonnet-4-6'; } catch(e) { return 'claude-sonnet-4-6'; } }
  function setKey(v)        { try { localStorage.setItem('hq.apiKey',   v); } catch(e) {} }
  function setEndpoint(v)   { try { localStorage.setItem('hq.endpoint', v); } catch(e) {} }
  function setSonnetModel(v){ try { localStorage.setItem('hq.sonnetModel', v); } catch(e) {} }

  /* ---- stats cumulées ------------------------------------- */
  var _stats = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };

  function _addUsage(model, inp, out) {
    _stats.calls++;
    _stats.inputTokens  += inp;
    _stats.outputTokens += out;
    var p = PRICING[model];
    if (p) _stats.costUSD += (inp * p.in + out * p.out) / 1e6;
  }

  /* ---- sélection du modèle -------------------------------- */
  function modelFor(task) {
    var m = ROUTES[task] || 'sonnet';
    if (m === 'sonnet') m = getSonnetModel();
    /* garde-fou : jamais Opus */
    if (m.indexOf('opus') !== -1) m = getSonnetModel();
    return m;
  }

  /* ---- message d'erreur lisible --------------------------- */
  function _errMsg(status, body) {
    if (status === 401) return 'Clé API invalide ou absente.';
    if (status === 429) return 'Quota dépassé — réessayez dans quelques instants.';
    var msg = body && body.error && body.error.message;
    return msg || ('Erreur ' + status);
  }

  /* ---- pause exponentielle -------------------------------- */
  function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  /* ---- appel direct (sans stream) ------------------------- */
  function call(task, opts) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('Clé API manquante. Renseignez-la dans les réglages.'));

    var model    = modelFor(task);
    var isLocal  = getEndpoint() === 'local';
    var endpoint = isLocal ? LOCAL_URL : DIRECT_URL;

    var hdrs = isLocal
      ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      : { 'Content-Type': 'application/json', 'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true' };

    var body = isLocal
      ? { model: model, max_tokens: opts.maxTokens || 1024,
          messages: _toOpenAI(opts.system, opts.messages), stream: false }
      : { model: model, max_tokens: opts.maxTokens || 1024,
          messages: opts.messages, stream: false };
    if (!isLocal && opts.system) body.system = opts.system;

    var attempt = 0;
    function tryOnce() {
      attempt++;
      return fetch(endpoint, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
        .then(function(r) {
          return r.json().then(function(data) {
            if (!r.ok) {
              if ((r.status === 429 || r.status >= 500) && attempt < 3) {
                return _sleep(Math.pow(2, attempt) * 800).then(tryOnce);
              }
              throw new Error(_errMsg(r.status, data));
            }
            var inp = isLocal
              ? (data.usage && data.usage.prompt_tokens)     || 0
              : (data.usage && data.usage.input_tokens)      || 0;
            var out = isLocal
              ? (data.usage && data.usage.completion_tokens) || 0
              : (data.usage && data.usage.output_tokens)     || 0;
            _addUsage(model, inp, out);
            return data;
          });
        })
        .catch(function(e) {
          if (attempt < 3 && e.name === 'TypeError') {
            return _sleep(Math.pow(2, attempt) * 800).then(tryOnce);
          }
          throw e;
        });
    }
    return tryOnce();
  }

  /* ---- appel en streaming --------------------------------- */
  function stream(task, opts, onChunk, onDone, onError) {
    var key = getKey();
    if (!key) {
      if (onError) onError(new Error('Clé API manquante. Renseignez-la dans les réglages.'));
      return;
    }

    var model    = modelFor(task);
    var isLocal  = getEndpoint() === 'local';
    var endpoint = isLocal ? LOCAL_URL : DIRECT_URL;

    var hdrs = isLocal
      ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      : { 'Content-Type': 'application/json', 'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true' };

    var body = isLocal
      ? { model: model, max_tokens: opts.maxTokens || 2048,
          messages: _toOpenAI(opts.system, opts.messages), stream: true }
      : { model: model, max_tokens: opts.maxTokens || 2048,
          messages: opts.messages, stream: true };
    if (!isLocal && opts.system) body.system = opts.system;

    fetch(endpoint, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
      .then(function(r) {
        if (!r.ok) {
          return r.json().catch(function() { return {}; }).then(function(d) {
            throw new Error(_errMsg(r.status, d));
          });
        }
        var reader  = r.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var inp = 0, out = 0;

        function read() {
          return reader.read().then(function(result) {
            if (result.done) {
              _addUsage(model, inp, out);
              if (onDone) onDone();
              return;
            }
            var text = decoder.decode(result.value, { stream: true });
            text.split('\n').forEach(function(line) {
              if (!line.startsWith('data: ')) return;
              var json = line.slice(6).trim();
              if (json === '[DONE]') return;
              try {
                var ev = JSON.parse(json);
                if (isLocal) {
                  /* format OpenAI */
                  var delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
                  if (delta && delta.content) onChunk && onChunk(delta.content);
                  if (ev.usage) {
                    inp = ev.usage.prompt_tokens     || 0;
                    out = ev.usage.completion_tokens || 0;
                  }
                } else {
                  /* format Anthropic */
                  if (ev.type === 'content_block_delta' && ev.delta && ev.delta.text) {
                    onChunk && onChunk(ev.delta.text);
                  }
                  if (ev.type === 'message_start' && ev.message && ev.message.usage) {
                    inp = ev.message.usage.input_tokens || 0;
                  }
                  if (ev.type === 'message_delta' && ev.usage) {
                    out = ev.usage.output_tokens || 0;
                  }
                }
              } catch(e) { /* ligne SSE malformée — ignorer */ }
            });
            return read();
          });
        }
        return read();
      })
      .catch(function(e) { if (onError) onError(e); });
  }

  /* ---- conversion system+messages → format OpenAI --------- */
  function _toOpenAI(system, messages) {
    var out = [];
    if (system) out.push({ role: 'system', content: system });
    (messages || []).forEach(function(m) { out.push(m); });
    return out;
  }

  /* ---- API publique ---------------------------------------- */
  HQ.api = {
    modelFor:       modelFor,
    call:           call,
    stream:         stream,
    getKey:         getKey,
    setKey:         setKey,
    getEndpoint:    getEndpoint,
    setEndpoint:    setEndpoint,
    getSonnetModel: getSonnetModel,
    setSonnetModel: setSonnetModel,
    getStats:       function() { return Object.assign({}, _stats); },
    resetStats:     function() { _stats = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 }; },
    ROUTES:         ROUTES
  };
})();
