// Shared presentation types for the ported components. Money is USDC base units as bigint; an
// unread value is null or undefined and renders as an em dash, never as zero.

export type Usd = bigint;
export type Unread<T> = T | null;
export type SpenderKind = 'person' | 'agent';
export type SpenderStatus = 'active' | 'paused' | 'revoked' | 'expired';
export type Period = 'daily' | 'weekly' | 'monthly';
export type BlockReason = 'over-allowance' | 'over-payment-cap' | 'merchant-not-approved' | 'over-frequency' | 'policy-expired' | 'spender-paused';
