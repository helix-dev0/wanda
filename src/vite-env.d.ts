/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Live-bridge flag: "1"/"true" connects to the bridge WebSocket instead of
   *  loading the recorded fixtures. Fixtures are the default (flag unset). */
  readonly VITE_LIVE?: string
}
