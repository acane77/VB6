import {VERSION} from '../core/core.js';
import {RUNTIME_SOURCE, RUNTIME_CSS} from './runtime-payload.js';
import {createApplicationExporter} from './application-exporter.js';
import {jsonForHTML} from './serialization.js';
import {ApplicationExportError} from './diagnostics.js';
import {verifyApplicationBundle} from './deployment.js';

// The full runtime is included once. No feature tree-shaking can accidentally
// remove dynamic controls, Declare adapters, source OCXs or late-bound services.
const exporter = createApplicationExporter({runtimeSource: RUNTIME_SOURCE, runtimeCSS: RUNTIME_CSS});

/** Backwards-compatible single-file HTML API used by the IDE and desktop host. */
export function exportApplication(project, options = {}, document = {}) { return exporter.html(project, options, document); }
/** Deployable local files, without inline executable JavaScript or JSON fetches. */
export function exportApplicationFiles(project, options = {}, document = {}) { return exporter.files(project, options, document); }
/** Structured diagnostics and dependency inventory without generating HTML. */
export function inspectApplicationExport(project, options = {}, document = {}) { return exporter.inspect(project, options, document); }
export const RUNTIME_VERSION = VERSION;
export {jsonForHTML, createApplicationExporter, ApplicationExportError};

/** Async SHA-256 release packaging, with optional offline installation. */
export function exportApplicationBundle(project, options = {}, document = {}, deployment = {}) { return exporter.bundle(project, options, document, deployment); }
/** Deterministic STORE ZIP plus the verified deployment and its manifest. */
export function exportApplicationArchive(project, options = {}, document = {}, deployment = {}) { return exporter.archive(project, options, document, deployment); }
export {verifyApplicationBundle};
