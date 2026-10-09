import { explorerTxUrl } from "@/lib/constants";

export function transactionNotice(signature: string, purpose: string) {
  return {
    shortSignature: `${signature.slice(0, 8)}…`,
    message: `${purpose} — ${signature.slice(0, 8)}…`,
    explorerUrl: explorerTxUrl(signature),
  };
}
