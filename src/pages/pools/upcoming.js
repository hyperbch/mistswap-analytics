import { AppShell, UpcomingPoolTable, AlmostUpcomingPoolTable } from "app/components";
import {
  getApollo,
  getUpcomingFarmPairs,
  farmReweightingPairsQuery,
  formatCurrency,
  useInterval,
} from "app/core";
import { FIRST_REWEIGHT_TIME, REWEIGHTING_PERIOD } from "app/core/constants";

import Head from "next/head";
import React, { useEffect, useState } from "react";
import { useQuery } from "@apollo/client";

function UpcomingPoolsPage() {
  const {
    data
  } = useQuery(farmReweightingPairsQuery);

  console.log('pre-processed pairs', data.pairs)
  const pairs1 = [...data.pairs]
    // remove pairs containing naughty tokens
    .filter((v) => {
      const blacklist = {
        "0x124559e3b63a89125cab76ca2add07a335f89d57": "", // FRDG
        "0x84e3ae3135d79536e032ee36dacc15e676400638": "", // PSN
        "0x8803805547b4b7dd1e4d9492a43bf6418447fcb0": "", // LZD
      };
      return ! (blacklist.hasOwnProperty(v.token0.id) || blacklist.hasOwnProperty(v.token1.id));
    })
    // sort pairs by volume
    .map((v) => ({
      ...v,
      accVolume: v.dayData.reduce((a, v) => a+Number.parseFloat(v.volumeUSD), 0),
    }))
    .sort((a, b) => b.accVolume - a.accVolume)
    // remove pairs without sufficient dayData
    .filter((v) => v.dayData.length >= 2)
    // fix for pairs with limited dayData
    .map((v) => {
      if (v.dayData.length === 2) {
        return {
          ...v,
          dayData: [
            v.dayData[0],
            v.dayData[0],
            v.dayData[1],
            v.dayData[1],
          ],
        }
      }
      return v;
    })

  const pairs2 = pairs1
    // we choose top 30 by volume pairs
    .slice(0, 30)
    // calculate volatility of each pair
    .map((v) => {
      // TODO maybe we should multiply reserves by tokens price in usd?
      const priceClose = v.dayData.map((k) => {
        return Number.parseFloat(k.reserve0) / Number.parseFloat(k.reserve1);
      });

      const logReturns = priceClose.slice(1).map((k, i) => k / priceClose[i]);

      function standardDeviation(a) {
       const m = a.reduce((a, v) => a + v, 0) / a.length
       return (a.map(x => (x - m) ** 2).reduce((a, v) => a + v, 0) / a.length) ** 0.5;
      }

      const dayReturnsStd = standardDeviation(logReturns);
      const volatility = (dayReturnsStd * 365) ** 0.5;

      return {
        ...v,
        volatility,
      };
    });

  // calculate allocation of pairs
  const pairs = pairs2.map((v) => {
    const sp = pairs1.reduce((a, k) => a + (Number.parseFloat(k.accVolume) * v.volatility), 0);
    const w = Number.parseFloat(v.accVolume) * v.volatility / sp;

    const MIN_AMOUNT = 0.0025;
    const FIX_MIN = MIN_AMOUNT * (1 + (MIN_AMOUNT * (1 + (30 * MIN_AMOUNT)) * 30));
    const allocation = Math.floor(((w + FIX_MIN) / (1 + (FIX_MIN * 30))) * 1000000000);

    return {
      ...v,
      allocation,
    };
  });

  const almostPairs = pairs1.filter((v) => {
    for (let o of pairs) {
	  if (o.id === v.id) {
	    return false;
	  }
	}

	return true;
  })
  .slice(0, 10)
  .map((v) => ({
    ...v,
	reason: v.accVolume === 0
	  ? `Not enough liquidity (${formatCurrency(3000 - v.reserveUSD)} more)`
	  : v.dayData < 2
	    ? `Not enough liquidity (${formatCurrency(3000 - v.reserveUSD)} minimum) for a long enough time`
		: `Not enough volume (${formatCurrency(pairs[pairs.length - 1].accVolume - v.accVolume)} more)`,
  }));
  console.log('pairs', pairs)

  useInterval(() => Promise.all([getUpcomingFarmPairs]), 60000);

  function getTitle() {
    const timeUntilNextReweighting = REWEIGHTING_PERIOD - ((Date.now() - FIRST_REWEIGHT_TIME) % REWEIGHTING_PERIOD)

    const days = Math.floor(timeUntilNextReweighting / (24*60*60*1000));
    const hours = Math.floor((timeUntilNextReweighting % (24*60*60*1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((timeUntilNextReweighting % (60*60*1000)) / (60*1000));
    const seconds = Math.floor((timeUntilNextReweighting % (60*1000)) / (1000));

    return `Upcoming Pools (Reweighting in ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds)`;
  }

  const [ title, setTitle ] = useState(getTitle());
  useEffect(() => {
    const timer = setTimeout(() => {
      setTitle(getTitle());
    }, 1000);
  });

  return (
    <AppShell>
      <Head>
        <title>Upcoming Pools | MistSwap Analytics</title>
      </Head>
      <UpcomingPoolTable
        title={title}
        pairs={pairs}
        orderBy="newAllocation"
        order="desc"
        rowsPerPage={30}
      />
      <AlmostUpcomingPoolTable
        title="Pairs which are close to becoming Pools"
        pairs={almostPairs}
        rowsPerPage={30}
      />
    </AppShell>
  );
}

export async function getStaticProps() {
  const client = getApollo();
  await getUpcomingFarmPairs(client);
  return {
    props: {
      initialApolloState: client.cache.extract(),
    },
    revalidate: 1,
  };
}

export default UpcomingPoolsPage;