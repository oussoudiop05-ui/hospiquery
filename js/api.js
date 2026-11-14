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
  var LOCAL_URL  = '/_omniroute/v1/chat/completions';

  /* ---- préférences (localStorage) -------------------------- */
  function getKey()         { try { return localStorage.getItem('hq.apiKey')      || ''; } catch(e) { return ''; } }
  function getEndpoint()    { try { return localStorage.getItem('hq.endpoint')    || 'direct'; } catch(e) { return 'direct'; } }
  function getMode() {
    try {
      var saved = localStorage.getItem('hq.mode');
      return saved || (getEndpoint() === 'local' ? 'omniroute' : 'api');
    } catch(e) { return 'api'; }
  }
  function getSonnetModel() { try { return localStorage.getItem('hq.sonnetModel') || 'claude-sonnet-4-6'; } catch(e) { return 'claude-sonnet-4-6'; } }
  function getLocalModel()  { try { return localStorage.getItem('hq.localModel')  || 'groq/openai/gpt-oss-120b'; } catch(e) { return 'groq/openai/gpt-oss-120b'; } }
  function setKey(v)        { try { localStorage.setItem('hq.apiKey',   v); } catch(e) {} }
  function setEndpoint(v)   { try { localStorage.setItem('hq.endpoint', v); } catch(e) {} }
  function setMode(v) {
    if (['local', 'omniroute', 'pont', 'api'].indexOf(v) < 0) {
      throw new Error('Mode HospiQuery inconnu : ' + v);
    }
    try { localStorage.setItem('hq.mode', v); } catch(e) {}
    if (v === 'omniroute') setEndpoint('local');
    else setEndpoint('direct');
  }
  function setSonnetModel(v){ try { localStorage.setItem('hq.sonnetModel', v); } catch(e) {} }
  function setLocalModel(v) {
    if (!v || !String(v).trim()) throw new Error('Le nom du modèle OmniRoute est requis.');
    try { localStorage.setItem('hq.localModel', String(v).trim()); } catch(e) {}
  }

  /* ---- stats cumulées ------------------------------------- */
  var _stats = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0 };

  function _addUsage(model, inp, out, cacheRead, cacheWrite) {
    _stats.calls++;
    _stats.inputTokens      += inp;
    _stats.outputTokens     += out;
    _stats.cacheReadTokens  += (cacheRead  || 0);
    _stats.cacheWriteTokens += (cacheWrite || 0);
    var p = PRICING[model];
    if (p) {
      _stats.costUSD += (inp * p.in + out * p.out) / 1e6;
      /* cache read = 0.1× input, cache write = 1.25× input */
      _stats.costUSD += ((cacheRead || 0) * p.in * 0.1 + (cacheWrite || 0) * p.in * 1.25) / 1e6;
    }
  }

  /* ---- bloc système avec cache_control (Anthropic uniquement) */
  function _buildSystemBlocks(system) {
    if (typeof system === 'string') return system;
    return [
      { type: 'text', text: system.stable,   cache_control: { type: 'ephemeral' } },
      { type: 'text', text: system.variable }
    ];
  }

  function _toolChoiceName(opts) {
    if (opts.forceTool) return opts.forceTool;
    var choice = opts.tool_choice || opts.toolChoice;
    if (typeof choice === 'string') return choice;
    return choice && choice.name || '';
  }

  function _addAnthropicTools(body, opts) {
    if (!opts.tools || !opts.tools.length) return;
    body.tools = opts.tools;
    var name = _toolChoiceName(opts);
    if (name) body.tool_choice = { type: 'tool', name: name };
  }

  function _openAITools(tools) {
    return tools.map(function (tool) {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      };
    });
  }

  function _addOpenAITools(body, opts) {
    if (!opts.tools || !opts.tools.length) return;
    body.tools = _openAITools(opts.tools);
    var name = _toolChoiceName(opts);
    if (name) body.tool_choice = { type: 'function', function: { name: name } };
  }

  function _anthropicBody(model, opts, streaming) {
    var body = {
      model: model,
      max_tokens: opts.maxTokens || (streaming ? 2048 : 1024),
      messages: opts.messages,
      stream: !!streaming
    };
    if (opts.system) body.system = _buildSystemBlocks(opts.system);
    _addAnthropicTools(body, opts);
    return body;
  }

  function _openAIBody(model, opts, streaming) {
    var body = {
      model: model,
      max_tokens: opts.maxTokens || (streaming ? 2048 : 1024),
      messages: _toOpenAI(opts.system, opts.messages),
      stream: !!streaming
    };
    _addOpenAITools(body, opts);
    return body;
  }

  function lireToolCall(data, nomOutil) {
    var choices = data && data.choices;
    var message = choices && choices[0] && choices[0].message;
    var calls = message && message.tool_calls || [];
    for (var i = 0; i < calls.length; i++) {
      var fn = calls[i].function || {};
      if (fn.name === nomOutil) return _parseToolInput(fn.arguments);
    }
    if (message && message.function_call && message.function_call.name === nomOutil) {
      return _parseToolInput(message.function_call.arguments);
    }

    var blocks = data && data.content || [];
    for (var j = 0; j < blocks.length; j++) {
      if (blocks[j].type === 'tool_use' && blocks[j].name === nomOutil) {
        return blocks[j].input;
      }
    }
    return null;
  }

  function _parseToolInput(input) {
    if (typeof input !== 'string') return input;
    try {
      return JSON.parse(input);
    } catch (e) {
      throw new Error('Arguments JSON invalides dans la réponse du tool call.');
    }
  }

  /* ---- sélection du modèle -------------------------------- */
  function modelFor(task) {
    if (getEndpoint() === 'local') return getLocalModel();
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
    var isLocal = getEndpoint() === 'local';
    if (!key && !isLocal) return Promise.reject(new Error('Clé API manquante. Renseignez-la dans les réglages.'));

    var model    = modelFor(task);
    var endpoint = isLocal ? LOCAL_URL : DIRECT_URL;

    var hdrs = isLocal
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json', 'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'anthropic-dangerous-direct-browser-access': 'true' };
    if (isLocal && key) hdrs.Authorization = 'Bearer ' + key;

    var body = isLocal
      ? _openAIBody(model, opts, false)
      : _anthropicBody(model, opts, false);

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
            var cacheRead  = isLocal ? 0 : (data.usage && data.usage.cache_read_input_tokens)    || 0;
            var cacheWrite = isLocal ? 0 : (data.usage && data.usage.cache_creation_input_tokens) || 0;
            _addUsage(model, inp, out, cacheRead, cacheWrite);
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
    var isLocal = getEndpoint() === 'local';
    if (!key && !isLocal) {
      if (onError) onError(new Error('Clé API manquante. Renseignez-la dans les réglages.'));
      return;
    }

    var model    = modelFor(task);
    var endpoint = isLocal ? LOCAL_URL : DIRECT_URL;

    var hdrs = isLocal
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json', 'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'anthropic-dangerous-direct-browser-access': 'true' };
    if (isLocal && key) hdrs.Authorization = 'Bearer ' + key;

    var body = isLocal
      ? _openAIBody(model, opts, true)
      : _anthropicBody(model, opts, true);

    fetch(endpoint, { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
      .then(function(r) {
        if (!r.ok) {
          return r.json().catch(function() { return {}; }).then(function(d) {
            throw new Error(_errMsg(r.status, d));
          });
        }
        var reader  = r.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var inp = 0, out = 0, cacheRead = 0, cacheWrite = 0;

        function read() {
          return reader.read().then(function(result) {
            if (result.done) {
              _addUsage(model, inp, out, cacheRead, cacheWrite);
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
                    inp        = ev.message.usage.input_tokens                  || 0;
                    cacheRead  = ev.message.usage.cache_read_input_tokens       || 0;
                    cacheWrite = ev.message.usage.cache_creation_input_tokens   || 0;
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
    var sysText = !system ? ''
      : typeof system === 'string' ? system
      : (system.stable || '') + '\n\n---\n\n' + (system.variable || '');
    var out = [];
    if (sysText) out.push({ role: 'system', content: sysText });
    (messages || []).forEach(function(m) { out.push(m); });
    return out;
  }

  /* ---- API publique ---------------------------------------- */
  HQ.api = {
    modelFor:       modelFor,
    call:           call,
    stream:         stream,
    lireToolCall:   lireToolCall,
    getKey:         getKey,
    setKey:         setKey,
    getEndpoint:    getEndpoint,
    setEndpoint:    setEndpoint,
    getMode:        getMode,
    setMode:        setMode,
    getSonnetModel: getSonnetModel,
    setSonnetModel: setSonnetModel,
    getLocalModel:  getLocalModel,
    setLocalModel:  setLocalModel,
    getStats:       function() { return Object.assign({}, _stats); },
    resetStats:     function() { _stats = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0 }; },
    ROUTES:         ROUTES
  };
})();
