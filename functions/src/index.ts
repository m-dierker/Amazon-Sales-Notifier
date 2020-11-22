// Require dotenv before anything else
require("dotenv").config();

import {
  HttpClient,
  amazonMarketplaces,
  MWS,
  Order,
  OrderStatusEnum,
} from "@scaleleap/amazon-mws-api-sdk";
import { Client } from "discord.js";
import * as functions from "firebase-functions";
import moment = require("moment");

const admin = require("firebase-admin");
admin.initializeApp();
const db: FirebaseFirestore.Firestore = admin.firestore();

const DATA_COLLECTION = "data";
const DATA_DOC = "data";
/** Discord has a message size limit that can happen if the app breaks and there are lots of updates. */
const DISCORD_CHARACTER_LIMIT = 2000;

let mws_: MWS;
let discordClient_: Client;

export const checkForOrders = functions.https.onRequest(async (req, res) => {
  const mws = getMws();
  const data: SaveData =
    ((await (
      await db.collection(DATA_COLLECTION).doc(DATA_DOC).get()
    ).data()) as SaveData) || {};
  // Let the code below assume this exists.
  if (!data.deletedOrders) {
    data.deletedOrders = {};
  }

  // Arbitrarily fetch the last few days of data.
  const now = moment();
  const threeDaysAgo = now.subtract(3, "days");

  const [mwsOrders] = await mws.orders.listOrders({
    MarketplaceId: [amazonMarketplaces.US.id],
    LastUpdatedAfter: threeDaysAgo.toDate(),
  });

  const diff = getOrderDiffs(data.savedOrders || [], mwsOrders.Orders);

  // Deleted orders get stored in the DB for a while since Amazon sometimes
  // "deletes" legitimate orders before shipping.
  for (const deletedOrder of diff.removed) {
    if (data.deletedOrders[deletedOrder.AmazonOrderId]) {
      console.warn(`Duplicate deleted order: ${deletedOrder.AmazonOrderId}`);
      continue;
    }
    data.deletedOrders[deletedOrder.AmazonOrderId] = deletedOrder;
    console.log(
      `Adding deleted order ${deletedOrder.AmazonOrderId} to database`
    );
  }
  // Deleted orders are no longer logged for now.
  diff.removed = [];

  // Silently cancel any "new" orders that were just deleted.
  let filteredNewOrders: Order[] = [];
  for (const newOrder of diff.added) {
    if (data.deletedOrders[newOrder.AmazonOrderId]) {
      console.log(
        `Muting order that was deleted and came back ${newOrder.AmazonOrderId}`
      );
      delete data.deletedOrders[newOrder.AmazonOrderId];
      continue;
    }
    filteredNewOrders.push(newOrder);
  }
  diff.added = filteredNewOrders;

  // Remove any deleted orders that were subsequently shipped.
  for (const shippedOrder of diff.shipped) {
    if (data.deletedOrders[shippedOrder.AmazonOrderId]) {
      console.log(
        `Removing deleted order that actually shipped ${shippedOrder.AmazonOrderId}`
      );
      delete data.deletedOrders[shippedOrder.AmazonOrderId];
    }
  }

  // TODO(mdierker): Potentially purge old deleted orders. data.deletedOrders is unbounded
  // for orders that are actually deleted.

  const msg = await getOrderMsg(diff);
  await sendDiscordMsg(msg);

  const newData: SaveData = {
    lastUpdateTime: now.toDate(),
    savedOrders: mwsOrders.Orders,
    deletedOrders: data.deletedOrders,
  };
  await db.collection(DATA_COLLECTION).doc(DATA_DOC).set(newData);

  res.send(msg);
});

function getMws(): MWS {
  if (mws_) {
    return mws_;
  }
  mws_ = new MWS(
    new HttpClient({
      marketplace: amazonMarketplaces.US,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      mwsAuthToken: process.env.MWS_ACCOUNT_AUTH_TOKEN!,
      secretKey: process.env.MWS_SECRET!,
      sellerId: process.env.MWS_SELLER_ID!,
    })
  );
  return mws_;
}

async function sendDiscordMsg(msg: string) {
  if (msg.length === 0) {
    return;
  }
  const discord = await getDiscord();
  const user = await discord.users.fetch(process.env.DISCORD_OWNER_ID!);

  // Discord blocks messages larger than 2000 characters.
  for (
    let batch = 0;
    batch < Math.ceil(msg.length / DISCORD_CHARACTER_LIMIT);
    batch++
  ) {
    const subMsg = msg.substr(
      batch * DISCORD_CHARACTER_LIMIT,
      DISCORD_CHARACTER_LIMIT
    );
    await user.send(subMsg);
  }
}

async function getDiscord(): Promise<Client> {
  if (discordClient_) {
    return discordClient_;
  }
  discordClient_ = new Client();
  await discordClient_.login(process.env.DISCORD_TOKEN);
  return discordClient_;
}

function getOrderDiffs(oldOrders: Order[], newOrders: Order[]) {
  const oldOrdersById = new Map(
    oldOrders.map((order) => [order.AmazonOrderId, order])
  );
  const newOrdersById = new Map(
    newOrders.map((order) => [order.AmazonOrderId, order])
  );

  const diff: OrderDiff = {
    added: [],
    removed: [],
    shipped: [],
  };

  for (const [orderId, newOrder] of newOrdersById.entries()) {
    if (!oldOrdersById.has(orderId)) {
      diff.added.push(newOrder);
    } else {
      const oldOrder = oldOrdersById.get(orderId)!;
      if (
        newOrder.OrderStatus === OrderStatusEnum.Shipped &&
        oldOrder.OrderStatus !== OrderStatusEnum.Shipped
      ) {
        diff.shipped.push(newOrder);
      }
    }
  }

  for (const [orderId, oldOrder] of oldOrdersById.entries()) {
    if (!newOrdersById.has(orderId)) {
      diff.removed.push(oldOrder);
    }
  }

  return diff;
}

async function getOrderMsg(diff: OrderDiff): Promise<string> {
  let msg = "";
  if (diff.added.length) {
    msg += "🎊 New Orders 🎉\n";
    for (const order of diff.added) {
      const orderStr = await getOrderString(order);
      msg += `- ${orderStr}\n`;
    }
    msg += "\n";
  }

  if (diff.removed.length) {
    msg += "🛑 Deleted Orders 🗑\n";
    for (const order of diff.removed) {
      const orderStr = await getOrderString(order);
      msg += `- ${orderStr}\n`;
    }
    msg += "\n";
  }

  if (diff.shipped.length) {
    msg += "📦 Shipped Orders 🛫\n";
    for (const order of diff.shipped) {
      const orderStr = await getOrderString(order);
      msg += `- ${orderStr}\n`;
    }
    msg += "\n";
  }

  return msg;
}

async function getOrderString(order: Order): Promise<string> {
  const mws = await getMws();
  const [items] = await mws.orders.listOrderItems({
    AmazonOrderId: order.AmazonOrderId,
  });
  const itemsStr = items.OrderItems.map((item) => item.Title).join(", ");
  // const itemsStr = "order";
  let orderStr = "";
  if (order.OrderTotal) {
    orderStr += `\$${order.OrderTotal.Amount}: `;
  }
  orderStr += itemsStr;
  if (order.ShippingAddress?.City) {
    orderStr += ` in ${order.ShippingAddress.City}, ${order.ShippingAddress.StateOrRegion}`;
    if (order.ShippingAddress.CountryCode !== "US") {
      orderStr += `, ${order.ShippingAddress.CountryCode}`;
    }
  }
  return orderStr;
}

export interface OrderDiff {
  added: Order[];
  removed: Order[];
  shipped: Order[];
}

export interface SaveData {
  savedOrders: Order[];
  lastUpdateTime: Date;
  deletedOrders: { [key: string]: Order };
}
