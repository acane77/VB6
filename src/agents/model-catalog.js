const invalid = () => { throw new Error('Invalid or incomplete provider model catalog. Previous choices are unchanged; no partial catalog was accepted.'); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[\w.-]{1,150}$/.test(value);
/** Bounded discovery. Never silently label a cyclic/truncated catalog as complete. */
export async function collectModelCatalog(transport, provider, signal, {details = false} = {}) {
  const ids = new Set(), cursors = new Set(['']); let cursor = '', records = 0;
  for (let page = 0; page < 20; page++) {
    signal?.throwIfAborted();
    let result, packets = 0, invalidPacket = false;
    await transport(null, {models: true, cursor, signal, receive: data => {
      if (++packets !== 1 || !record(data)) { invalidPacket = true; invalid(); } result = structuredClone(data);
    }});
    signal?.throwIfAborted();
    if (invalidPacket || !result || result.error) invalid();
    const chatgpt = result.chatgpt === true, list = provider === 'google' ? result.models : result.data;
    if (!Array.isArray(list) || (records += list.length) > 10000 || chatgpt && (provider !== 'openai' || page !== 0)) invalid();
    const labelled = [];
    for (const item of list) {
      if (!record(item)) invalid();
      if (provider === 'google') {
        if (typeof item.name !== 'string' || !item.name.startsWith('models/') || !Array.isArray(item.supportedGenerationMethods)
          || !item.supportedGenerationMethods.every(value => typeof value === 'string')) invalid();
      }
      const id = provider === 'google' ? item.name.slice(7) : item.id;
      if (!validId(id)) invalid();
      if (provider === 'google' && !item.supportedGenerationMethods.includes('generateContent')) continue;
      if (chatgpt && (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 300)) invalid();
      if (!ids.has(id)) { ids.add(id); labelled.push({id, label: chatgpt ? item.label : id}); }
    }
    if (chatgpt) return details ? labelled : labelled.map(item => item.id); // Relay owns account-specific order/labels.
    if (result.has_more != null && typeof result.has_more !== 'boolean') invalid();
    const next = provider === 'google' ? result.nextPageToken : result.has_more ? result.last_id : '';
    if (provider !== 'google' && result.has_more && (provider === 'openai' || !next)) invalid();
    if (next == null || next === '') {
      const sorted = [...ids].sort(); return details ? sorted.map(id => ({id, label: id})) : sorted;
    }
    if (typeof next !== 'string' || next.length > 8192 || cursors.has(next)) invalid();
    cursors.add(next); cursor = next;
  }
  invalid();
}
