// noVNC 1.7 ships no types and exports only its root. @types/novnc__novnc
// describes the same RFB class under its old lib/ path.
declare module "@novnc/novnc" {
  export { default } from "@novnc/novnc/lib/rfb";
}
