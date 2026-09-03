/**
 * The live online connection, kept outside React/zustand state (it holds
 * sockets and closures). The store mirrors only serialisable status.
 */
export const net = {
  role: null, // 'host' | 'guest' | null
  transport: null,
  session: null,
  /** The host's authoritative engine (replaced on rematch). */
  match: null,
  code: "",
};

export function resetNet() {
  try { net.session?.leave?.(); } catch { /* ignore */ }
  try { net.transport?.close?.(); } catch { /* ignore */ }
  net.role = null;
  net.transport = null;
  net.session = null;
  net.match = null;
  net.code = "";
}
