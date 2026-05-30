import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { useTheme } from "../theme";
import { endpoints } from "../api/client";
import { logger } from "../lib/logger";
import { formatCurrency, safeName } from "../lib/format";
import type {
  PortfolioOverview,
  PortfolioHoldingSummary,
} from "../../../shared/types";

function pctLabel(pct: number | null): string {
  if (pct == null) return "";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default function PortfolioScreen() {
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [overview, setOverview] = useState<PortfolioOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await endpoints.getPortfolioOverview();
      if (res.success) {
        setOverview(res.data);
        setError(null);
      } else {
        logger.warn("portfolio", "fetch failed", { error: res.error });
        setError(res.error);
      }
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logger.error("portfolio", "fetch threw", { detail });
      setError("Cannot connect to server");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) fetchOverview();
  }, [isFocused, fetchOverview]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const currency = overview?.displayCurrency ?? "CAD";
  const summary = overview?.summary;
  const holdings = overview?.byHolding ?? [];
  const gain = summary?.totalUnrealizedGainDisplay ?? 0;
  const gainColor = gain > 0 ? colors.pos : gain < 0 ? colors.neg : colors.foreground;

  const renderHolding = ({ item }: { item: PortfolioHoldingSummary }) => {
    const g = item.unrealizedGainDisplay;
    const gColor = g > 0 ? colors.pos : g < 0 ? colors.neg : colors.mutedForeground;
    const pct = Math.max(0, Math.min(item.pctOfPortfolio ?? 0, 100));
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.holdingTop}>
          <View style={styles.holdingLeft}>
            <Text style={[styles.symbol, { color: colors.foreground }]} numberOfLines={1}>
              {safeName(item.symbol || item.name, "—")}
            </Text>
            <Text style={[styles.holdingName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {safeName(item.name)} · {item.totalQty} units
            </Text>
          </View>
          <View style={styles.holdingRight}>
            <Text style={[styles.holdingValue, { color: colors.foreground }]}>
              {formatCurrency(item.marketValueDisplay, currency, { decimals: 0 })}
            </Text>
            <Text style={[styles.holdingGain, { color: gColor }]}>
              {formatCurrency(g, currency, { decimals: 0 })} ({pctLabel(item.unrealizedGainPct)})
            </Text>
          </View>
        </View>
        {/* Allocation bar */}
        <View style={[styles.allocTrack, { backgroundColor: colors.secondary }]}>
          <View style={[styles.allocFill, { backgroundColor: colors.primary, width: `${pct}%` }]} />
        </View>
        <Text style={[styles.allocLabel, { color: colors.mutedForeground }]}>
          {(item.pctOfPortfolio ?? 0).toFixed(1)}% of portfolio
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={[styles.header, { color: colors.foreground }]}>Portfolio</Text>
      </View>

      <FlatList
        data={holdings}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchOverview(true)} />
        }
        renderItem={renderHolding}
        ListHeaderComponent={
          <>
            <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>Total Value</Text>
              <Text style={[styles.heroValue, { color: colors.foreground }]}>
                {formatCurrency(summary?.totalValueDisplay ?? 0, currency, { decimals: 0 })}
              </Text>
              <View style={styles.heroStatsRow}>
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatLabel, { color: colors.mutedForeground }]}>
                    Unrealized
                  </Text>
                  <Text style={[styles.heroStatValue, { color: gainColor }]}>
                    {formatCurrency(gain, currency, { decimals: 0 })} (
                    {pctLabel(summary?.totalUnrealizedGainPct ?? null)})
                  </Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatLabel, { color: colors.mutedForeground }]}>
                    Day change
                  </Text>
                  <Text
                    style={[
                      styles.heroStatValue,
                      {
                        color:
                          (summary?.dayChangeDisplay ?? 0) >= 0 ? colors.pos : colors.neg,
                      },
                    ]}
                  >
                    {formatCurrency(summary?.dayChangeDisplay ?? 0, currency, { decimals: 0 })} (
                    {pctLabel(summary?.dayChangePct ?? null)})
                  </Text>
                </View>
              </View>
            </View>
            <Text style={[styles.readonlyHint, { color: colors.mutedForeground }]}>
              Read-only — record buys, sells & dividends on the web app.
            </Text>
          </>
        }
        ListEmptyComponent={
          error ? (
            <Text style={[styles.empty, { color: colors.destructive }]}>{error}</Text>
          ) : (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No holdings yet
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  header: { fontSize: 28, fontWeight: "800" },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  hero: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 8,
  },
  heroLabel: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  heroValue: { fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  heroStatsRow: { flexDirection: "row", gap: 16, marginTop: 12 },
  heroStat: { flex: 1 },
  heroStatLabel: { fontSize: 12, marginBottom: 2 },
  heroStatValue: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  readonlyHint: { fontSize: 12, marginBottom: 12, paddingHorizontal: 4 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 8,
  },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  holdingLeft: { flex: 1, marginRight: 12 },
  symbol: { fontSize: 15, fontWeight: "700" },
  holdingName: { fontSize: 12, marginTop: 2 },
  holdingRight: { alignItems: "flex-end" },
  holdingValue: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  holdingGain: { fontSize: 12, fontWeight: "600", marginTop: 2, fontVariant: ["tabular-nums"] },
  allocTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  allocFill: { height: 6, borderRadius: 3 },
  allocLabel: { fontSize: 11, marginTop: 4 },
  empty: { textAlign: "center", paddingVertical: 32, fontSize: 14 },
});
