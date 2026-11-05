// How the owner's UI proves itself to the local server (server main.ts, desktop main.ts). No dependencies: the
// desktop's main process imports it too.
export const SESSION_HEADER = "x-zorel-token" // the desktop app adds it to the window's requests
export const SESSION_COOKIE = "zorel" // a browser gets it from the login link
export const SESSION_ENV = "ZOREL_SESSION" // the desktop app hands its secret to the server this way (then dropped)
export const SESSION_BYTES = 32 // random bytes in a secret (hex: twice as many characters)
export const LOGIN_PATH = "/api/login" // ?t=<secret>: sets the cookie
