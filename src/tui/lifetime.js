/** One removal observer per document, shared by scoped presentation roots.
 * A root-local observer cannot see removal of the root itself. */
const documents = new WeakMap();

export function observeRootLifetime(root, retired) {
  const document = root.ownerDocument;
  let record = documents.get(document);
  if (!record) {
    record = {roots: new Set(), observer: null};
    record.observer = new document.defaultView.MutationObserver(() => {
      for (const entry of [...record.roots]) {
        if (entry.root.ownerDocument !== document || (entry.connected && !entry.root.isConnected)) {
          record.roots.delete(entry);
          entry.retired();
        } else entry.connected ||= entry.root.isConnected;
      }
      if (!record.roots.size) {
        record.observer.disconnect();
        if (documents.get(document) === record) documents.delete(document);
      }
    });
    record.observer.observe(document, {subtree: true, childList: true});
    documents.set(document, record);
  }
  const entry = {root, retired, connected: root.isConnected};
  record.roots.add(entry);
  return () => {
    record.roots.delete(entry);
    if (!record.roots.size) {
      record.observer.disconnect();
      if (documents.get(document) === record) documents.delete(document);
    }
  };
}
