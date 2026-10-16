import {registerTextView,textViewFor} from '../rendering/text-view.js';
import {readableFormScale} from './form-space.js';
import {parseCalendarDate,calendarMove,calendarISO} from './pickers.js';
import {paintTextView} from './text-view.js';
import {TUI_APPEARANCE,tuiAttribute,partitionTracks} from './appearance.js';
import {FrameCellRenderer} from './frame.js';
import {paintShape} from './shapes.js';
import {CellBuffer,CanvasCellRenderer,CellGlyphAtlas,EGA,TUI_PROFILES,normalizeDOSSettings} from './cells.js';
import {TuiControlRegistry,TUI_CONTROL_CAPABILITIES,paintControl} from './controls.js';
import {layoutText,paintText} from './text-layout.js';
import {TuiImageProjector,projectPixels,nearestEGA} from './graphics.js';
import {CP437,serializeScreen,deserializeScreen,serializeANSI,serializeB800,composeCellLayers} from './screen.js';
/** The reusable core does not acquire browser/global resources at import time.
 * DOM ownership remains with ApplicationHost / the optional IDE installer. */
export const TUI=Object.freeze({registerTextView,textViewFor,readableFormScale,parseCalendarDate,calendarMove,calendarISO,paintTextView,TUI_APPEARANCE,tuiAttribute,partitionTracks,FrameCellRenderer,paintShape,CellBuffer,CanvasCellRenderer,CellGlyphAtlas,EGA,TUI_PROFILES,normalizeDOSSettings,
  TuiControlRegistry,TUI_CONTROL_CAPABILITIES,paintControl,layoutText,paintText,TuiImageProjector,projectPixels,nearestEGA,
  CP437,serializeScreen,deserializeScreen,serializeANSI,serializeB800,composeCellLayers});
