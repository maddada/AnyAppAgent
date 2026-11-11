// The chat timeline's logic lives in shared/chat (the same for the phone and the desktop); this
// file only re-exports what the phone's chat screen uses.
export { buildRows, duration, seconds, summarizeTools, toolActive, type Row } from "@shared/chat/index";
