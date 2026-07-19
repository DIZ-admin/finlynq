/** Regression contracts for FINLYNQ-131 account/portfolio safety boundaries. */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const accountsSource = readFileSync(
  resolve(__dirname, "../../mcp-server/tools/accounts.ts"),
  "utf8",
);
const portfolioSource = readFileSync(
  resolve(__dirname, "../../mcp-server/tools/portfolio.ts"),
  "utf8",
);

describe("investment account safety boundaries", () => {
  it("blocks account deletion when either holdings ownership path is populated", () => {
    expect(accountsSource).toContain("FROM portfolio_holdings");
    expect(accountsSource).toContain("FROM holding_accounts");
    expect(accountsSource).toContain("Cannot delete account #${acctId} while it owns portfolio holdings");
    expect(accountsSource).toContain("Remove or transfer the holdings first.");
  });

  it("loads and enforces is_investment for holding creation and portfolio entries", () => {
    expect(portfolioSource).toContain("SELECT id, currency, is_investment, name_ct, alias_ct FROM accounts");
    expect(portfolioSource).toContain("const investmentAccountError = (acct: Row): string | null");
    expect(portfolioSource).toContain("Set isInvestment=true before using portfolio operations.");
    expect(portfolioSource.match(/investmentAccountError\(a\.acct\)/g)?.length).toBe(5);
    expect(portfolioSource).toContain("const investmentError = investmentAccountError(acct);");
  });
});
