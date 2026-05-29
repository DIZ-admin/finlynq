import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet } from "react-native";
import { useTheme } from "../theme";
import { Icon, type IconName } from "../components/icon";
import DashboardScreen from "../screens/DashboardScreen";
import AccountsStack from "./AccountsStack";
import PortfolioScreen from "../screens/PortfolioScreen";
import TransactionsStack from "./TransactionsStack";
import MoreStack from "./MoreStack";

// Option B — "Wealth-led" IA: Home · Accounts · Portfolio · Transactions · More.
export type TabParamList = {
  Home: undefined;
  Accounts: undefined;
  Portfolio: undefined;
  Transactions: undefined;
  More: undefined;
};

const ICON_BY_ROUTE: Record<keyof TabParamList, IconName> = {
  Home: "dashboard",
  Accounts: "accounts",
  Portfolio: "portfolio",
  Transactions: "transactions",
  More: "more",
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function TabNavigator() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        // The tab bar is always dark in both light and dark mode (mirrors the
        // web sidebar) — uses the sidebar* token set.
        tabBarStyle: {
          backgroundColor: colors.sidebar,
          borderTopColor: colors.sidebarBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.sidebarPrimary,
        tabBarInactiveTintColor: colors.sidebarMutedForeground,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color }) => (
          <Icon name={ICON_BY_ROUTE[route.name]} size={22} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Accounts" component={AccountsStack} />
      <Tab.Screen name="Portfolio" component={PortfolioScreen} />
      <Tab.Screen name="Transactions" component={TransactionsStack} />
      <Tab.Screen name="More" component={MoreStack} />
    </Tab.Navigator>
  );
}
