/** Only server-owned addresses are cached. Request headers are checked every time. */
export function createLocalOriginMatcher() {
  let previousPort: number | undefined;
  let allowed: {origin: string; host: string}[] | undefined;
  return (port: number | undefined, host: string | undefined): string | undefined => {
    if (!allowed || port !== previousPort) {
      // Preserve URL normalization, including omission of the default HTTP port.
      allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
        .map(origin => ({origin, host: new URL(origin).host}));
      previousPort = port;
    }
    return allowed.find(candidate => candidate.host === host)?.origin;
  };
}
