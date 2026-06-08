"use client";

import { useMemo } from "react";

export interface AccountRow {
  id: number;
  name: string | null;
  currency: string;
  alias?: string | null;
  type?: string | null;
  isInvestment?: boolean;
}

export interface HoldingRow {
  id: number;
  accountId: number;
  name: string | null;
  symbol: string | null;
  currency: string;
  isCrypto?: boolean | number;
  isCash: boolean | number;
  currentShares?: number;
  accountName?: string | null;
}

export function useAccountHoldingSelection(
  accounts: AccountRow[],
  holdings: HoldingRow[],
  accountId: string,
) {
  const investmentAccounts = useMemo(
    () => accounts.filter((a) => a.isInvestment === true),
    [accounts],
  );

  const selectedAccount = useMemo(
    () =>
      accountId
        ? investmentAccounts.find((a) => String(a.id) === accountId) ?? null
        : null,
    [accountId, investmentAccounts],
  );

  const accountHoldings = useMemo(
    () =>
      selectedAccount
        ? holdings.filter(
            (h) => h.accountId === selectedAccount.id && !h.isCash,
          )
        : [],
    [holdings, selectedAccount],
  );

  return { investmentAccounts, selectedAccount, accountHoldings };
}
