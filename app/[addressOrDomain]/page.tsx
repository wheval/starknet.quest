"use client";
import React, { useCallback, useContext, useEffect, useState } from "react";
import styles from "@styles/dashboard.module.css";
import ProfileCard from "@components/UI/profileCard/profileCard";
import {
  fetchLeaderboardRankings,
  fetchLeaderboardToppers,
  getBoosts,
  getCompletedQuests,
} from "@services/apiService";
import { useAccount } from "@starknet-react/core";
import Blur from "@components/shapes/blur";
import { utils } from "starknetid.js";
import { StarknetIdJsContext } from "@context/StarknetIdJsProvider";
import { hexToDecimal, tokenToDecimal } from "@utils/feltService";
import { isHexString, minifyAddress } from "@utils/stringService";
import ProfileCardSkeleton from "@components/skeletons/profileCardSkeleton";
import { getDataFromId } from "@services/starknetIdService";
import { usePathname, useRouter } from "next/navigation";
import ErrorScreen from "@components/UI/screens/errorScreen";
import {
  ArgentDappMap,
  ArgentTokenMap,
  ArgentUserDapp,
  ArgentUserToken,
  CompletedQuests,
} from "../../types/backTypes";
import QuestSkeleton from "@components/skeletons/questsSkeleton";
import QuestCardCustomised from "@components/dashboard/CustomisedQuestCard";
import QuestStyles from "@styles/Home.module.css";
import { Tab, Tabs } from "@mui/material";
import { MILLISECONDS_PER_WEEK } from "@constants/common";
import useBoost from "@hooks/useBoost";
import BoostCard from "@components/quest-boost/boostCard";
import Typography from "@components/UI/typography/typography";
import { TEXT_TYPE } from "@constants/typography";
import { a11yProps } from "@components/UI/tabs/a11y";
import { CustomTabPanel } from "@components/UI/tabs/customTab";
import SuggestedQuests from "@components/dashboard/SuggestedQuests";
import PortfolioSummary from "@components/dashboard/PortfolioSummary";
import { useNotification } from "@context/NotificationProvider";
import {
  calculateTokenPrice,
  fetchDapps,
  fetchTokens,
  fetchUserDapps,
  fetchUserTokens,
} from "@services/argentPortfolioService";
import PortfolioSummarySkeleton from "@components/skeletons/portfolioSummarySkeleton";

type AddressOrDomainProps = {
  params: {
    addressOrDomain: string;
  };
};

type ChartItemMap = {
  [dappId: string]: ChartItem;
};

type DebtStatus = {
  hasDebt: boolean;
  tokens: {
    dappId: string;
    tokenAddress: string;
    tokenBalance: number;
  }[];
};

export default function Page({ params }: AddressOrDomainProps) {
  const router = useRouter();
  const addressOrDomain = params.addressOrDomain;
  const { showNotification } = useNotification();
  const { address } = useAccount();
  const { starknetIdNavigator } = useContext(StarknetIdJsContext);
  const [initProfile, setInitProfile] = useState(false);
  const { getBoostClaimStatus } = useBoost();
  const [leaderboardData, setLeaderboardData] =
    useState<LeaderboardToppersData>({
      best_users: [],
      total_users: -1,
    });
  const [identity, setIdentity] = useState<Identity>();
  const [notFound, setNotFound] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [completedQuests, setCompletedQuests] = useState<CompletedQuests>([]);
  const [userRanking, setUserRanking] = useState<RankingData>({
    first_elt_position: -1,
    ranking: [],
  });
  const dynamicRoute = usePathname();
  const [questsLoading, setQuestsLoading] = useState(true);
  const [tabIndex, setTabIndex] = React.useState(0);
  const [claimableQuests, setClaimableQuests] = useState<Boost[]>([]);
  const [portfolioAssets, setPortfolioAssets] = useState<ChartItem[]>([]);
  const [portfolioProtocols, setPortfolioProtocols] = useState<ChartItem[]>([]);
  const [loadingProtocols, setLoadingProtocols] = useState(true);

  const handleChangeTab = useCallback(
    (event: React.SyntheticEvent, newValue: number) => {
      setTabIndex(newValue);
    },
    []
  );

  useEffect(() => {
    if (!address) setIsOwner(false);
  }, [address]);

  const fetchCompletedQuests = useCallback(
    async (addr: string) => {
      try {
        if (!addr) return;
        const res = await getCompletedQuests(addr);
        if (!res || "error" in res) return;
        setCompletedQuests(res);
      } catch (err) {
        console.log("Error while fetching quests", err);
      }
    },
    [address, identity]
  );

  const fetchBoosts = useCallback(async () => {
    if (!address) return;
    try {
      const boosts = await getBoosts();
      if (
        !boosts ||
        !completedQuests ||
        boosts.length === 0 ||
        completedQuests.length === 0
      )
        return;

      const filteredBoosts = boosts.filter((boost) => {
        const userBoostCompletionCheck = boost.quests.every((quest) =>
          completedQuests.includes(quest)
        );
        const userBoostCheckStatus = getBoostClaimStatus(address, boost.id);
        const isBoostExpired =
          (new Date().getTime() - boost.expiry) / MILLISECONDS_PER_WEEK <= 3 &&
          boost.expiry < Date.now();

        return (
          userBoostCompletionCheck &&
          !userBoostCheckStatus &&
          isBoostExpired &&
          boost.winner != null
        );
      });

      if (filteredBoosts.length > 0) {
        setClaimableQuests(filteredBoosts);
      }
    } catch (err) {
      console.log("Error while fetching boosts", err);
    }
  }, [address, completedQuests]);

  useEffect(() => {
    fetchBoosts();
  }, [address, completedQuests]);

  const fetchRanking = useCallback(
    async (addr: string) => {
      if (!addr) return;
      const res = await fetchLeaderboardRankings({
        addr: hexToDecimal(addr),
        page_size: 10,
        shift: 0,
        duration: "all",
      });
      if (!res) return;
      setUserRanking(res);
    },
    [address]
  );

  const fetchLeaderboardData = useCallback(
    async (addr: string) => {
      if (!addr) return;
      const res = await fetchLeaderboardToppers({
        addr: hexToDecimal(addr),
        duration: "all",
      });
      if (!res) return;
      setLeaderboardData(res);
    },
    [address]
  );

  const fetchPageData = useCallback(async (addr: string) => {
    await fetchRanking(addr);
    await fetchLeaderboardData(addr);
  }, []);

  const fetchQuestData = useCallback(async (addr: string) => {
    setQuestsLoading(true);
    await fetchCompletedQuests(addr);
    setQuestsLoading(false);
  }, []);

  const calculateAssetPercentages = async (
    userTokens: ArgentUserToken[],
    tokens: ArgentTokenMap,
    dapps: ArgentDappMap,
    userDapps: ArgentUserDapp[],
  ) => {
    let totalValue = 0;
    const assetValues: { [symbol: string]: number } = {};

    // Process user tokens in parallel
    const userTokenPromises = userTokens.map(async (token) => {
      const tokenInfo = tokens[token.tokenAddress];
      if (!tokenInfo || token.tokenBalance === "0") return null;

      // Skip protocol tokens (like LPT pair tokens, staking, etc.)
      if (tokenInfo.dappId) {
        return null;
      }

      try {
        const value = await calculateTokenPrice(
          token.tokenAddress,
          tokenToDecimal(token.tokenBalance, tokenInfo.decimals),
          "USD"
        );
        return {
          value,
          symbol: tokenInfo.symbol || "Unknown",
          isProtocolToken: !!tokenInfo.dappId
        };
      } catch (err) {
        console.log(`Error calculating price for token ${token.tokenAddress}:`, err);
        return null;
      }
    });

    // Flatten userDapps into an array of token balances
    const dappBalances = userDapps.flatMap(dapp =>
      dapp.products[0]?.positions.flatMap(position =>
        Object.entries(position.totalBalances).map(([tokenAddress, balance]) => ({
          tokenAddress,
          balance,
          dappId: dapp.dappId
        }))
      ) ?? []
    );

    // Process all balances in parallel
    const balancePromises = dappBalances.map(async ({ tokenAddress, balance, dappId }) => {
      const tokenInfo = tokens[tokenAddress];
      if (!tokenInfo || balance === "0") return null;

      try {
        const value = await calculateTokenPrice(
          tokenAddress,
          tokenToDecimal(balance, tokenInfo.decimals),
          "USD"
        );

        return {
          value,
          symbol: tokenInfo.symbol || "Unknown",
          isProtocolToken: !!tokenInfo.dappId,
        };
      } catch (err) {
        console.log(`Error calculating price for token ${tokenAddress}:`, err);
        return null;
      }
    });

    // Process results
    const results = (await Promise.all([
      ...balancePromises,
      ...userTokenPromises
    ])).filter(Boolean);

    results.forEach(result => {
      if (!result) return;
      const { value, symbol, isProtocolToken } = result;

      if (value < 0) return; // Skip negative balances

      totalValue += value;

      if (!isProtocolToken) {
        assetValues[symbol] = (assetValues[symbol] || 0) + value;
      }
    });
    // Convert to percentages and format
    const sortedAssets = Object.entries(assetValues)
      .sort(([, a], [, b]) => b - a)
      .map(([symbol, value]) => ({
        itemLabel: symbol,
        itemValue: ((value / totalValue) * 100).toFixed(2),
        itemValueSymbol: "%",
        color: "" // Colors will be assigned later
      }));

    // Handle "Others" category if needed
    if (sortedAssets.length > 4) {
      const others = sortedAssets.slice(4).reduce(
        (sum, asset) => sum + parseFloat(asset.itemValue),
        0
      );
      sortedAssets.splice(4);
      sortedAssets.push({
        itemLabel: "Others",
        itemValue: others.toFixed(2),
        itemValueSymbol: "%",
        color: ""
      });
    }

    // Assign colors
    const colors = ["#1E2097", "#637DEB", "#2775CA", "#5CE3FE", "#F4FAFF"];
    sortedAssets.forEach((asset, index) => {
      asset.color = colors[index % colors.length]; // Use modulo to recycle colors if needed
    });
    return sortedAssets;
  };

  const fetchPortfolioAssets = useCallback(async (data: {
    dapps: ArgentDappMap,
    tokens: ArgentTokenMap,
    userTokens: ArgentUserToken[],
    userDapps: ArgentUserDapp[]
  }) => {
    const { dapps, tokens, userTokens, userDapps } = data;
    try {
      if (!tokens || !userTokens || !dapps || !userDapps) {
        console.warn('Missing required data for portfolio calculation');
        return;
      }
      const assets = await calculateAssetPercentages(userTokens, tokens, dapps, userDapps);
      setPortfolioAssets(assets);
    } catch (error) {
      showNotification("Error while fetching portfolio assets", "error");
      console.log("Error while fetching portfolio assets", error);
    }
  }, []);

  const userHasDebt = (userDapps: ArgentUserDapp[]) => {
    let debt: DebtStatus = { hasDebt: false, tokens: [] };

    for (const dapp of userDapps) {
      if (!dapp.products[0]) {
        continue;
      }
      for (const position of dapp.products[0].positions) {
        for (const tokenAddress of Object.keys(position.totalBalances)) {
          const tokenBalance = Number(position.totalBalances[tokenAddress]);
          if (tokenBalance < 0) {
            debt.hasDebt = true;
            debt.tokens.push({
              dappId: dapp.dappId,
              tokenAddress,
              tokenBalance,
            });
          }
        }
      }
    }
    return debt;
  };

  const handleDebt = async (
    protocolsMap: ChartItemMap,
    userDapps: ArgentUserDapp[],
    tokens: ArgentTokenMap,
  ) => {
    const debtStatus = userHasDebt(userDapps);
    if (!debtStatus || !debtStatus.hasDebt) {
      return;
    }

    for await (const debt of debtStatus.tokens) {
      let value = Number(protocolsMap[debt.dappId].itemValue);
      value += await calculateTokenPrice(
        debt.tokenAddress,
        tokenToDecimal(
          debt.tokenBalance.toString(),
          tokens[debt.tokenAddress].decimals
        ),
        "USD"
      );

      protocolsMap[debt.dappId].itemValue = value.toFixed(2);
    }
  };

  const getProtocolsFromTokens = async (
    protocolsMap: ChartItemMap,
    userTokens: ArgentUserToken[],
    tokens: ArgentTokenMap,
    dapps: ArgentDappMap,
  ) => {
    for await (const token of userTokens) {
      const tokenInfo = tokens[token.tokenAddress];
      if (tokenInfo.dappId && token.tokenBalance != "0") {
        let itemValue = 0;
        const currentTokenBalance = await calculateTokenPrice(
          token.tokenAddress,
          tokenToDecimal(token.tokenBalance, tokenInfo.decimals),
          "USD"
        );

        if (protocolsMap[tokenInfo.dappId]?.itemValue) {
          itemValue =
            Number(protocolsMap[tokenInfo.dappId].itemValue) +
            currentTokenBalance;
        } else {
          itemValue = currentTokenBalance;
        }

        protocolsMap[tokenInfo.dappId] = {
          color: "",
          itemLabel: dapps[tokenInfo.dappId].name,
          itemValueSymbol: "$",
          itemValue: itemValue.toFixed(2),
        };
      }
    }
  };

  const getProtocolsFromDapps = async (
    protocolsMap: ChartItemMap,
    userDapps: ArgentUserDapp[],
    tokens: ArgentTokenMap,
    dapps: ArgentDappMap,
  ) => {
    for await (const userDapp of userDapps) {
      if (protocolsMap[userDapp.dappId]) {
        continue;
      } // Ignore entry if already present in the map

      let protocolBalance = 0;
      if (!userDapp.products[0]) {
        return;
      }
      for await (const position of userDapp.products[0].positions) {
        for await (const tokenAddress of Object.keys(position.totalBalances)) {
          protocolBalance += await calculateTokenPrice(
            tokenAddress,
            tokenToDecimal(
              position.totalBalances[tokenAddress],
              tokens[tokenAddress].decimals
            ),
            "USD"
          );
        }
      }

      protocolsMap[userDapp.dappId] = {
        color: "",
        itemLabel: dapps[userDapp.dappId].name,
        itemValueSymbol: "$",
        itemValue: protocolBalance.toFixed(2),
      };
    }
  };

  const sortProtocols = (protocolsMap: ChartItemMap) => {
    return Object.values(protocolsMap).sort(
      (a, b) => parseFloat(b.itemValue) - parseFloat(a.itemValue)
    );
  };

  const handleExtraProtocols = (sortedProtocols: ChartItem[]) => {
    let otherProtocols =
      sortedProtocols.length > 5 ? sortedProtocols.splice(4) : [];
    if (otherProtocols.length === 0) {
      return;
    }
    sortedProtocols.push({
      itemLabel: "Others",
      itemValue: otherProtocols
        .reduce(
          (valueSum, protocol) => valueSum + Number(protocol.itemValue),
          0
        )
        .toFixed(2),
      itemValueSymbol: "$",
      color: "",
    });
  };

  const assignProtocolColors = (sortedProtocols: ChartItem[]) => {
    const portfolioProtocolColors = [
      "#278015",
      "#23F51F",
      "#DEFE5C",
      "#9EFABB",
      "#F4FAFF",
    ];
    sortedProtocols.forEach((protocol, index) => {
      protocol.color = portfolioProtocolColors[index];
    });
  };

  const fetchPortfolioProtocols = useCallback(async (data: {
    dapps: ArgentDappMap, 
    tokens: ArgentTokenMap, 
    userTokens: ArgentUserToken[], 
    userDapps: ArgentUserDapp[]
  }) => {
    const { dapps, tokens, userTokens, userDapps } = data;

    if (!dapps || !tokens || (!userTokens && !userDapps)) return;
    let protocolsMap: ChartItemMap = {};

    try {
      await getProtocolsFromTokens(protocolsMap, userTokens, tokens, dapps);
      await handleDebt(protocolsMap, userDapps, tokens); // Tokens show debt as balance 0, so need to handle it manually
      await getProtocolsFromDapps(protocolsMap, userDapps, tokens, dapps);

      let sortedProtocols = sortProtocols(protocolsMap);
      handleExtraProtocols(sortedProtocols);
      assignProtocolColors(sortedProtocols);

      setPortfolioProtocols(sortedProtocols);
    } catch (error) {
      showNotification(
        "Error while calculating address portfolio stats",
        "error"
      );
      console.log("Error while calculating address portfolio stats", error);
    }
  }, [address]);

  const fetchPortfolioData = useCallback(async (addr: string, abortController: AbortController) => {
    setLoadingProtocols(true);
    try {
      // Argent API requires lowercase address
      const normalizedAddr = addr.toLowerCase();
      const [dappsData, tokensData, userTokensData, userDappsData] =
        await Promise.all([
          fetchDapps({ signal: abortController.signal }),
          fetchTokens({ signal: abortController.signal }),
          fetchUserTokens(normalizedAddr, { signal: abortController.signal }),
          fetchUserDapps(normalizedAddr, { signal: abortController.signal }),
        ]);

      const data = {
        dapps: dappsData,
        tokens: tokensData,
        userTokens: userTokensData,
        userDapps: userDappsData,
      };

      await Promise.all([
        fetchPortfolioProtocols(data),
        fetchPortfolioAssets(data),
      ]);
    } catch (error) {
      console.log("Error while fetching address portfolio", error);
      if (error instanceof Error && error.name === 'AbortError') {
        // Do not show notification for AbortError
        return;
      }

      showNotification("Error while fetching address portfolio", "error");

    } finally {
      setLoadingProtocols(false);
    }
  }, [fetchPortfolioProtocols, fetchPortfolioAssets]);

  useEffect(() => {
    const abortController = new AbortController();

    if (!identity) return;
    fetchQuestData(identity.owner);
    fetchPageData(identity.owner);
    fetchPortfolioData(identity.owner, abortController);

    return () => abortController.abort();
  }, [identity]);

  useEffect(() => setNotFound(false), [dynamicRoute]);

  useEffect(() => {
    setInitProfile(false);
  }, [address, addressOrDomain]);

  useEffect(() => {
    if (
      typeof addressOrDomain === "string" &&
      addressOrDomain?.toString().toLowerCase().endsWith(".stark")
    ) {
      if (
        !utils.isBraavosSubdomain(addressOrDomain) &&
        !utils.isXplorerSubdomain(addressOrDomain)
      ) {
        starknetIdNavigator
          ?.getStarknetId(addressOrDomain)
          .then((id) => {
            getDataFromId(id).then((data: Identity) => {
              if (data.error) {
                setNotFound(true);
                return;
              }
              setIdentity({
                ...data,
                id: id.toString(),
              });
              if (hexToDecimal(address) === hexToDecimal(data.owner))
                setIsOwner(true);
              setInitProfile(true);
            });
          })
          .catch(() => {
            return;
          });
      } else {
        starknetIdNavigator
          ?.getAddressFromStarkName(addressOrDomain)
          .then((addr) => {
            setIdentity({
              id: "0",
              owner: addr,
              domain: { domain: addressOrDomain },
              main: false,
            });
            setInitProfile(true);
            if (hexToDecimal(address) === hexToDecimal(addr)) setIsOwner(true);
          })
          .catch(() => {
            return;
          });
      }
    } else if (
      typeof addressOrDomain === "string" &&
      isHexString(addressOrDomain)
    ) {
      starknetIdNavigator
        ?.getStarkName(hexToDecimal(addressOrDomain))
        .then((name) => {
          if (name) {
            if (
              !utils.isBraavosSubdomain(name) &&
              !utils.isXplorerSubdomain(name)
            ) {
              starknetIdNavigator
                ?.getStarknetId(name)
                .then((id) => {
                  getDataFromId(id).then((data: Identity) => {
                    if (data.error) return;
                    setIdentity({
                      ...data,
                      id: id.toString(),
                    });
                    if (hexToDecimal(address) === hexToDecimal(data.owner))
                      setIsOwner(true);
                    setInitProfile(true);
                  });
                })
                .catch(() => {
                  return;
                });
            } else {
              setIdentity({
                id: "0",
                owner: addressOrDomain,
                domain: { domain: name },
                main: false,
              });
              setInitProfile(true);
              if (hexToDecimal(addressOrDomain) === hexToDecimal(address))
                setIsOwner(true);
            }
          } else {
            setIdentity({
              id: "0",
              owner: addressOrDomain,
              domain: { domain: minifyAddress(addressOrDomain) },
              main: false,
            });
            setIsOwner(false);
            setInitProfile(true);
          }
        })
        .catch(() => {
          setIdentity({
            id: "0",
            owner: addressOrDomain,
            domain: { domain: minifyAddress(addressOrDomain) },
            main: false,
          });
          setInitProfile(true);
          if (hexToDecimal(addressOrDomain) === hexToDecimal(address))
            setIsOwner(true);
        });
    } else {
      setNotFound(true);
    }
  }, [addressOrDomain, address, dynamicRoute]);

  if (notFound) {
    return (
      <ErrorScreen
        errorMessage="Profile or Page not found"
        buttonText="Go back to quests"
        onClick={() => router.push("/")}
      />
    );
  }

  return (
    <div className={styles.dashboard_container}>
      <div className={styles.dashboard_wrapper}>
        <div className={styles.blur1}>
          <Blur green />
        </div>
        <div className={styles.blur2}>
          <Blur green />
        </div>
        {initProfile && identity ? (
          <ProfileCard
            identity={identity}
            rankingData={userRanking}
            leaderboardData={leaderboardData}
            isOwner={isOwner}
          />
        ) : (
          <ProfileCardSkeleton />
        )}
      </div>

      {/* Portfolio charts */}
      <div className={styles.dashboard_portfolio_summary_container}>
        {loadingProtocols ? ( // Change for corresponding state
          <PortfolioSummarySkeleton />
        ) : (
          <PortfolioSummary
            title="Portfolio by assets type"
            data={portfolioAssets}
            totalBalance={portfolioAssets.reduce(
              (sum, item) => sum + Number(item.itemValue),
              0
            )}
            isProtocol={false}
          />
        )}
        {loadingProtocols ? (
          <PortfolioSummarySkeleton />
        ) : (
          <PortfolioSummary
            title="Portfolio by protocol usage"
            data={portfolioProtocols}
            totalBalance={portfolioProtocols.reduce(
              (sum, item) => sum + Number(item.itemValue),
              0
            )}
            isProtocol={true}
          />
        )}
      </div>

      {/* Completed Quests */}
      <div className={styles.dashboard_completed_tasks_container}>
        <div>
          <Tabs
            style={{
              borderBottom: "0.5px solid rgba(224, 224, 224, 0.3)",
            }}
            className="pb-6"
            value={tabIndex}
            onChange={handleChangeTab}
            aria-label="quests and collectons tabs"
            indicatorColor="secondary"
          >
            <Tab
              disableRipple
              sx={{
                borderRadius: "10px",
                padding: "0px 12px 0px 12px",
                textTransform: "none",
                fontWeight: "600",
                fontSize: "12px",
                fontFamily: "Sora",
                minHeight: "32px",
              }}
              label={`Completed (${completedQuests.length})`}
              {...a11yProps(0)}
            />
            {claimableQuests.length > 0 ? (
              <Tab
                disableRipple
                sx={{
                  borderRadius: "10px",
                  padding: "0px 12px 0px 12px",
                  textTransform: "none",
                  fontWeight: "600",
                  fontSize: "12px",
                  fontFamily: "Sora",
                  minHeight: "32px",
                }}
                label={`To claim (${claimableQuests})`}
                {...a11yProps(1)}
              />
            ) : null}
          </Tabs>
        </div>
        <CustomTabPanel value={tabIndex} index={0}>
          <div className={styles.quests_container}>
            {questsLoading ? (
              <QuestSkeleton />
            ) : completedQuests?.length === 0 ? (
              isOwner ? (
                <SuggestedQuests />
              ) : (
                <Typography type={TEXT_TYPE.H2} className={styles.noBoosts}>
                  User has not completed any quests at the moment
                </Typography>
              )
            ) : (
              <section className={QuestStyles.section}>
                <div className={QuestStyles.questContainer}>
                  {completedQuests?.length > 0 &&
                    completedQuests?.map((quest) => (
                      <QuestCardCustomised key={quest} id={quest} />
                    ))}
                </div>
              </section>
            )}
          </div>
        </CustomTabPanel>

        <CustomTabPanel value={tabIndex} index={1}>
          {questsLoading ? (
            <QuestSkeleton />
          ) : (
            <div className="flex flex-wrap gap-10 justify-center lg:justify-start">
              {claimableQuests &&
                claimableQuests.map((quest) => (
                  <BoostCard
                    key={quest.id}
                    boost={quest}
                    completedQuests={completedQuests}
                  />
                ))}
            </div>
          )}
        </CustomTabPanel>
      </div>
    </div>
  );
}
